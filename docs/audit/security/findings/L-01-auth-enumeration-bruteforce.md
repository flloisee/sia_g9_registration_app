# L-01 — Login timing/enumeration and weak brute-force posture

| | |
| --- | --- |
| **Severity** | Low |
| **CVSS 3.1** | 3.7 — `AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N` |
| **CWE** | CWE-208 (Observable Timing Discrepancy), CWE-204 (Observable Response Discrepancy), CWE-307 |
| **Component** | `POST /api/admin/login`, password policy |
| **Affected code** | `server/src/admin.js:92-120`, `server/src/auth.js:16-27`, `server/src/helpers.js:45-59`, `server/src/admin.js:442-444`, `server/src/staff.js:19-21` |
| **Status** | Code review |

## Summary

The login handler looks up the user first and only verifies the password if a row exists:

```js
const user = rows[0];
if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
  return res.status(401).json({ error: 'Email or password is incorrect.' });
}
```

For a non-existent (or disabled) account, no Argon2id work is done; for an existing account, ~19 MiB / 2 passes runs. That is a measurable timing difference, so an attacker can enumerate valid emails. The error message is correctly generic, but the clock is not.

Related hardening gaps:

- Only **8 characters** are required for staff and organizer passwords (`admin.js:442`, `staff.js:19`), with no maximum, no breach-list check, and no MFA.
- The login limiter is **10 attempts / 10 min per IP** (`admin.js:25`). Distributed credential stuffing is unaffected; behind a proxy the bucket is shared (see **M-03**).
- There is no per-account lockout or backoff, so a single account can be attacked slowly from many IPs.
- Registration returns a distinct `409` when an email is already registered for an event (`index.js:118-121`), which is an email-enumeration oracle for a known event.

## Impact

- Email enumeration enables targeted phishing and credential stuffing.
- Slow, distributed password guessing against the owner/organizer accounts is not blocked.
- Weak 8-character passwords are easier to crack offline if the database is exposed.

## Preconditions

- Network access to the login endpoint; for the timing attack, enough samples to separate the two distributions.

## Reproduction

Timing (illustrative; run many samples and compare medians):

```bash
BASE=http://localhost:4000
for i in $(seq 1 30); do
  curl -s -o /dev/null -w '%{time_total}\n' -X POST "$BASE/api/admin/login" \
    -H 'content-type: application/json' \
    -d '{"email":"definitely-not-a-user@example.com","password":"x"}'
done | sort -n | awk '{a[NR]=$1} END {print "median", a[int(NR/2)]}'

for i in $(seq 1 30); do
  curl -s -o /dev/null -w '%{time_total}\n' -X POST "$BASE/api/admin/login" \
    -H 'content-type: application/json' \
    -d '{"email":"owner@example.com","password":"wrong"}'
done | sort -n | awk '{a[NR]=$1} END {print "median", a[int(NR/2)]}'
```

The existing-account median is visibly higher because Argon2id runs. (Exact numbers depend on hardware; the point is the gap, not the absolute value.)

Email enumeration via registration (for an event that is open):

```bash
curl -sS -X POST "$BASE/api/register" -H 'content-type: application/json' \
  -d '{"eventId":2,"fullName":"Test User","email":"known@example.com","organization":"Org","phone":"+15551234567"}'
# 409 {"error":"That email is already registered for this event."}  vs. 201 for a new email
```

## Evidence

`server/src/admin.js:105-108`:

```js
const user = rows[0];
if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
  return res.status(401).json({ error: 'Email or password is incorrect.' });
}
```

`server/src/auth.js:16-27` — Argon2id only runs when a hash is present; legacy scrypt uses `scryptSync` (also CPU-heavy).

`server/src/admin.js:25` and `server/src/staff.js:9` — 10/10 min per IP.

## Root cause

The authentication flow short-circuits before the expensive hash for unknown users, and the password policy/throttling is minimal.

## Remediation

1. **Equalise timing:** always run a dummy Argon2id verification when the user is missing or inactive:

   ```js
   const DUMMY_HASH = await hashPassword('dummy-password-for-timing');
   const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
   if (!user || !user.is_active || !ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
   ```

   (Compute `DUMMY_HASH` once at startup; do not hash per request.)
2. **Per-account throttling:** track failures by email in addition to IP; exponential backoff or temporary lock after e.g. 10 failures.
3. **Password policy:** minimum 12 characters (or a passphrase), maximum 128, reject breached passwords (HIBP k-anonymity API or a local list), and offer MFA (TOTP) for owner/organizer.
4. **Generic registration response:** return the same success shape when an email is already registered (or send a "you're already registered" email and return 202), to remove the enumeration oracle. Keep the unique constraint.
5. Keep the generic login error message; it is already correct.

## Verification

- Repeat the timing loop; the medians should be close (within noise).
- Attempt 15 logins for one account from different IPs; the account should back off.
- Registration with an existing email should not reveal that fact in the HTTP response.

## References

- OWASP Authentication Cheat Sheet — timing attacks, lockout, password policy
- OWASP ASVS 5.0 V2.2 / V2.3 / V6.2
- CWE-208, CWE-204, CWE-307
