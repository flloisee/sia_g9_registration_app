# L-05 — No explicit CSRF or Origin defense (currently mitigated incidentally)

| | |
| --- | --- |
| **Severity** | Low (defense-in-depth) |
| **CVSS 3.1** | 3.0 — `AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:L/A:N` |
| **CWE** | CWE-352 (Cross-Site Request Forgery) |
| **Component** | All cookie-authenticated state-changing routes |
| **Affected code** | `server/src/auth.js:77-85`, `server/src/index.js:28`, `server/src/admin.js` (all POST/PATCH/DELETE), `server/src/index.js:224-270` |
| **Status** | Code review — not currently exploitable via a standard cross-site form |

## Summary

Every admin mutation and check-in is authenticated solely by the `sia_admin` cookie. There is no CSRF token, no `Origin`/`Referer` validation, and no `Fetch-Site` check.

Three incidental properties currently prevent a classic CSRF:

1. `SameSite=Lax` on the session cookie (`auth.js:80`), so cross-site POST/PATCH/DELETE requests do not carry the cookie.
2. `express.json({ limit: '16kb' })` parses only `application/json` (`index.js:28`). An HTML form cannot send `application/json` cross-origin without a CORS preflight, and the app sends no CORS headers.
3. There is no `express.urlencoded()` or `express.text()` parser, so a form-encoded or `text/plain` body is `undefined` and validation fails.

This is fragile. Any of the following would reopen a full CSRF:

- Adding `express.urlencoded()` for a future form.
- Adding `text/plain` parsing.
- Adding permissive CORS (`Access-Control-Allow-Origin` + credentials).
- Changing `SameSite` to `None` for an embedded widget.
- A same-site subdomain attacker if `loca.lt` is not treated as a public suffix (cookies are host-only today, which helps).

The audit confirmed that a form-encoded `POST /api/register` is rejected at validation (`400 "Enter your full name."`), and a cross-origin preflight gets no `Access-Control-Allow-*` headers.

## Impact

If the incidental protections are removed, an attacker page can:

- Delete events and their registrations.
- Approve/reject volunteers, change a volunteer's email/event, delete volunteers.
- Create organizer accounts (owner session).
- Check in attendees.

Low today, High if the parser/CORS/SameSite assumptions change.

## Preconditions

- Victim has an active admin/staff session.
- Victim visits an attacker page.
- One of the incidental mitigations is removed or bypassed.

## Reproduction (negative test — shows current mitigation)

```bash
BASE=http://localhost:4000

# Cross-site form shape: no JSON content type -> body is not parsed.
curl -sS -X POST "$BASE/api/register" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'eventId=2&fullName=Test'
# 400 {"error":"Enter your full name."} — the body was ignored.

# Cross-origin preflight: no CORS approval.
curl -sS -D- -o /dev/null -X OPTIONS "$BASE/api/admin/events" \
  -H 'Origin: https://evil.example' \
  -H 'Access-Control-Request-Method: DELETE'
# 200 with Allow: DELETE, but no Access-Control-Allow-Origin
```

To see the gap, imagine adding `app.use(express.urlencoded({ extended: true }))`. A cross-site form could then submit:

```html
<form action="http://localhost:4000/api/admin/events/2" method="POST">
  <input type="hidden" name="_method" value="DELETE">
</form>
```

or, with a permissive CORS policy, a `fetch(..., { credentials: 'include' })` from `evil.example`.

## Evidence

`server/src/auth.js:77-85`:

```js
res.cookie(SESSION_COOKIE, token, {
  httpOnly: true,
  sameSite: 'lax',
  secure: req.secure,
  path: '/',
  maxAge: SESSION_TTL_MS,
});
```

`server/src/index.js:28`:

```js
app.use(express.json({ limit: '16kb' }));
```

No `csrf`, `csurf`, `origin`, or `referer` checks exist in the server source.

## Root cause

CSRF protection is a side effect of the cookie policy and the JSON-only parser, not an explicit control.

## Remediation

1. Add an explicit Origin/Referer check for all state-changing requests:

   ```js
   app.use((req, res, next) => {
     if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
     const origin = req.get('origin');
     if (origin && !ALLOWED_ORIGINS.includes(origin)) {
       return res.status(403).json({ error: 'Cross-origin request blocked.' });
     }
     next();
   });
   ```

   `ALLOWED_ORIGINS` should come from configuration (e.g. `APP_ORIGIN`), not `req.get('host')`.
2. Keep the JSON-only parser; do not add `express.urlencoded()` unless needed, and if you do, add a CSRF token for those routes.
3. Add a double-submit CSRF cookie/token or a custom `X-Requested-With` header requirement for defense-in-depth.
4. Keep `SameSite=Lax`; use `Strict` where compatible. Never use `None` without a token.
5. Do not add permissive CORS; if cross-origin clients are needed, allowlist exact origins and methods.
6. Add tests that a cross-origin `POST`/`PATCH`/`DELETE` without a valid token is rejected.

## Verification

- A `POST` with `Origin: https://evil.example` should return `403`.
- A same-origin request with the app's own `Origin` should succeed.
- A form-encoded body should still be rejected.

## References

- OWASP CSRF Prevention Cheat Sheet
- OWASP ASVS 5.0 V4.2
- CWE-352
