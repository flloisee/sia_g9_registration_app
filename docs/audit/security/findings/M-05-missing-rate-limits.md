# M-05 — No throttling on ticket QR, check-in, attendee, or token endpoints

| | |
| --- | --- |
| **Severity** | Medium |
| **CVSS 3.1** | 5.3 — `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:L` |
| **CWE** | CWE-770 (Allocation of Resources Without Limits or Throttling), CWE-307 |
| **Component** | Public ticket endpoint, authenticated check-in/list endpoints |
| **Affected code** | `server/src/index.js:216-222`, `server/src/index.js:224-270`, `server/src/index.js:272-306`, `server/src/admin.js:254-295` |
| **Status** | **Confirmed live** (no 429 under load) |

## Summary

Only four routes have a limiter: `/api/register` (10/10 min), `/api/telemetry/pageview` (300/min), `/api/admin/login` (10/10 min), and `/api/staff/signup` (10/10 min).

These do **not**:

- `GET /api/tickets/:code/qr.png` — public, no auth, no limit. It is a ticket-validity oracle: `200` for a real code, `404` for a well-formed but unknown code, `400` for a malformed one.
- `POST /api/checkin` — authenticated, no limit. A staff/organizer account can hammer it.
- `GET /api/attendees` — authenticated, no limit, returns up to 1,000 rows per call.
- `GET /api/admin/volunteers/confirm-email` — public, no limit, token guessing (256-bit, so not practically brute-forceable, but still an unthrottled secret endpoint).

The 8-character ticket alphabet is 32 symbols, so blind enumeration of the full 40-bit space is not practical. The practical risks are (a) targeted guessing when part of a code is known or leaked (see **M-01**), (b) resource exhaustion on QR generation (each request renders a 480×480 PNG with `qrcode`), and (c) high-volume scraping of the attendee list by any compromised staff/organizer account.

## Impact

- **DoS / cost:** unauthenticated clients can force continuous PNG generation and database lookups.
- **Oracle:** confirms whether a given ticket code exists, useful with partial knowledge or leaked codes.
- **Bulk exfiltration:** a single authenticated account can pull 1,000 attendee rows per request as fast as the server responds.
- **No lockout signal:** repeated failed check-ins or confirmations are not throttled or alerted.

## Preconditions

- QR oracle: none.
- Check-in/list abuse: any authenticated staff or organizer account.
- Confirm-email: knowledge of a token (impractical to guess; relevant if leaked).

## Reproduction

```bash
BASE=http://localhost:4000

# 1. Public QR endpoint: 200 requests, no 429.
for i in $(seq 1 200); do
  code=$(printf 'ABCDEFG%01d' $((i % 10)))
  curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/tickets/$code/qr.png"
done | sort | uniq -c
#   20 400
#  180 404
# (no 429)

# 2. Valid-code oracle: a real code returns 200 and the PNG.
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "$BASE/api/tickets/<REAL_CODE>/qr.png"
# 200 image/png

# 3. Authenticated endpoints: loop /api/attendees and /api/checkin with a session.
for i in $(seq 1 100); do
  curl -s -o /dev/null -w '%{http_code}\n' -b staff.jar "$BASE/api/attendees?eventId=2"
done | sort | uniq -c
# 100 200 — no 429
```

## Evidence

`server/src/index.js:216-222` — public QR route with no limiter:

```js
app.get('/api/tickets/:code/qr.png', async (req, res) => {
  const code = normalizeCode(req.params.code);
  if (!CODE_RE.test(code)) return res.status(400).end();
  const [rows] = await pool.execute('SELECT id FROM attendees WHERE code = ?', [code]);
  if (!rows.length) return res.status(404).end();
  res.type('png').set('Cache-Control', 'public, max-age=3600').send(await qrPng(code));
});
```

`server/src/index.js:224` and `:272` — authenticated routes with only `requireUser`/`requireApproved`:

```js
app.post('/api/checkin', requireUser, requireApproved, async (req, res) => { ... });
app.get('/api/attendees', requireUser, requireApproved, async (req, res) => { ... });
```

`server/src/admin.js:254` — token endpoint with no limiter:

```js
adminRouter.get('/volunteers/confirm-email', async (req, res) => { ... });
```

Compare with the limited routes: `index.js:139` (telemetry), `index.js:172` (register), `admin.js:25` (login), `staff.js:9` (signup).

## Root cause

Rate limiting was applied to account-creation and login flows but not to read/lookup endpoints. The ticket QR endpoint was treated as harmless static content, although it is an unauthenticated database lookup and a validity oracle.

## Remediation

1. Apply the existing `rateLimit` helper (or a stricter per-route variant) to:
   - `/api/tickets/:code/qr.png` — e.g. 60/min per IP, and cache the PNG (in-memory or disk) keyed by code.
   - `/api/checkin` — e.g. 30/min per account plus 120/min per IP.
   - `/api/attendees` — e.g. 30/min per account.
   - `/api/admin/volunteers/confirm-email` — e.g. 20/min per IP; return a generic 400 for invalid/expired tokens.
2. Return the same response for "malformed" and "unknown" codes (e.g. `404`), so the endpoint is not a validity oracle. Only return `200` for a valid code.
3. Add pagination to `/api/attendees` (`?limit=&cursor=`) and cap the page size; remove `LIMIT 1000` as the implicit export.
4. Use a shared rate-limit store if the app runs multiple processes; the current map is per-process and resets on restart.
5. Consider a global limiter plus alerting on bursts of `404` QR requests.

## Verification

Re-run the loops above; expect `429` after the configured threshold, and the same status for malformed vs. unknown codes.

## References

- OWASP ASVS 5.0 V2.2 / V11.1 — anti-automation and resource limits
- OWASP Denial of Service Cheat Sheet
- CWE-770, CWE-307
