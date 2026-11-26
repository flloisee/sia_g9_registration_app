# M-06 — Migration accepts the example admin password

| | |
| --- | --- |
| **Severity** | Medium (deployment-dependent) |
| **CVSS 3.1** | 6.5 — `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N` (if deployed with example values) |
| **CWE** | CWE-1392 (Use of Default Credentials), CWE-521 (Weak Password Requirements) |
| **Component** | `.env.example` + `npm run db:migrate` |
| **Affected code** | `.env.example:10-12`, `server/src/migrate.js:114-141`, `README.md:35,70` |
| **Status** | Code review (current local `.env` has a non-default password) |

## Summary

`.env.example` ships a working default owner account:

```dotenv
ADMIN_NAME=Event Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
```

The README's setup step is `cp .env.example .env`, and `migrate.js` only checks that the password is at least 8 characters:

```js
if (password.length < 8) {
  throw new Error('Set ADMIN_PASSWORD (8+ characters) in .env before running the migration.');
}
```

`change-this-password` is 19 characters, so the migration accepts it, creates the `owner` account, and the documented login URL is `/dev/admin`. A deployment that skips editing the file exposes full owner access to anyone who reads the public example.

The current local `.env` has a changed password, so this is a **deployment risk**, not an active compromise. It is still Medium because the default is documented, predictable, and grants the highest privilege.

## Impact

- Full owner takeover: create/delete events (and all their registrations), approve/reject volunteers, create/disable organizers, read every attendee.
- The account cannot be disabled through the UI (by design), so recovery requires editing `.env` and re-running the migration.

## Preconditions

- The operator copied `.env.example` and ran `npm run db:migrate` without changing `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- The instance is reachable by the attacker.

## Reproduction

```bash
cp .env.example .env
npm run db:migrate
# "Admin admin@example.com created from .env."

# Attacker:
curl -sS -c owner.jar -X POST http://localhost:4000/api/admin/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"change-this-password"}'
# 200 {"user":{"role":"owner",...}}

curl -sS -b owner.jar http://localhost:4000/api/admin/users
# full owner view
```

## Evidence

`.env.example:10-12`:

```dotenv
ADMIN_NAME=Event Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
```

`server/src/migrate.js:114-123`:

```js
const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? '';
const adminName = (process.env.ADMIN_NAME ?? '').trim() || 'Event Admin';

if (!EMAIL_RE.test(email)) {
  throw new Error('Set ADMIN_EMAIL in .env before running the migration.');
}
if (password.length < 8) {
  throw new Error('Set ADMIN_PASSWORD (8+ characters) in .env before running the migration.');
}
```

`README.md:35` tells the operator to `cp .env.example .env`; `README.md:70` lists `ADMIN_*` as the owner credentials.

## Root cause

A functional default credential is shipped as documentation, and the only validation is length. There is no "is this a placeholder?" check and no forced rotation.

## Remediation

1. In `.env.example`, use an empty value with a comment:
   ```dotenv
   # Required. Use a unique, long passphrase (or let the migration generate one).
   ADMIN_PASSWORD=
   ```
2. In `migrate.js`, reject known placeholders and weak values:
   ```js
   const WEAK = new Set(['change-this-password', 'password', 'admin', 'changeme']);
   if (password.length < 12 || WEAK.has(password.toLowerCase())) {
     throw new Error('Set a strong ADMIN_PASSWORD (12+ characters, not a placeholder).');
   }
   ```
   Optionally generate a random passphrase and print it once if the variable is empty.
3. Force a password change on first owner login, or require an email confirmation before the owner account is usable.
4. Add a startup warning if the owner password matches the example.
5. Do not commit a real `.env`; the current `.gitignore` already excludes it, and `git ls-files` confirms it is untracked. Keep it that way.

## Verification

- `ADMIN_PASSWORD=change-this-password npm run db:migrate` should abort with a clear error.
- A strong unique password should migrate successfully.
- The example file should not contain a usable credential.

## References

- OWASP ASVS 5.0 V2.1 / V2.3 — password security and default credentials
- CWE-1392, CWE-521
