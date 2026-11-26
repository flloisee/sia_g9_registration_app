# L-06 — Minor information disclosure and unhandled input errors

| | |
| --- | --- |
| **Severity** | Low |
| **CVSS 3.1** | 2.0 — `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N` |
| **CWE** | CWE-200 (Exposure of Sensitive Information), CWE-755 (Improper Handling of Exceptional Conditions) |
| **Component** | `GET /api/health`, global error handler, cookie parser |
| **Affected code** | `server/src/index.js:129-136`, `server/src/index.js:320-327`, `server/src/auth.js:64-75` |
| **Status** | **Confirmed live** |

## Summary

Four small information/robustness leaks:

1. `/api/health` is unauthenticated and reports database state: `{"ok":true,"db":"up"}` or `{"ok":false,"db":"down"}`. Useful for reconnaissance and for timing an attack during an outage.
2. Malformed JSON returns a **500** instead of a 400, and the error handler logs the stack. A client can distinguish parser failures from other errors and generate noisy error logs.
3. A malformed session cookie (`sia_admin=%`) makes `decodeURIComponent` throw, producing a **500** on any authenticated route. An unauthenticated attacker can generate 500s and log noise at will.
4. Express `OPTIONS` responses include `Allow: POST` (or the relevant methods), which confirms route existence.

None of these expose data or credentials. They are low-value but easy to fix.

## Impact

- Confirms the app and database are alive, and when the database is down.
- 500s on bad input pollute error logs and can be used to measure error-handling behavior.
- Method enumeration helps map the API.

## Preconditions

- Network access to the API.

## Reproduction

```bash
BASE=http://localhost:4000

curl -sS "$BASE/api/health"
# {"ok":true,"db":"up"}

curl -sS -w ' [%{http_code}]\n' -X POST "$BASE/api/register" \
  -H 'content-type: application/json' -d '{'
# {"error":"Something went wrong on our side."} [500]

curl -sS -o /dev/null -w 'malformed cookie -> %{http_code}\n' \
  -H 'Cookie: sia_admin=%' "$BASE/api/attendees"
# malformed cookie -> 500

curl -sS -D- -o /dev/null -X OPTIONS "$BASE/api/admin/login" | grep -i '^allow:'
# Allow: POST
```

## Evidence

`server/src/index.js:129-136`:

```js
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});
```

`server/src/index.js:320-327`:

```js
app.use((err, req, res, _next) => {
  console.error(err);
  log.error('Server thread', `${req.method} ${req.originalUrl.slice(0, 300)} failed: ${err.message}`);
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our side.' });
});
```

`server/src/auth.js:64-75` — `decodeURIComponent` is unguarded:

```js
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim()); // throws on '%'
    }
  }
  return null;
}
```

## Root cause

No dedicated health scope, no `SyntaxError` handling for the JSON parser, no guarded cookie decoding, and Express's default `OPTIONS` behavior is left in place.

## Remediation

1. **Health:** return a bare `200 ok` without the DB detail to the public, or restrict `/api/health` to an internal network / a secret header. Keep the detailed check on a separate internal endpoint or in logs.
2. **Malformed JSON:** handle body-parser errors before the generic handler:

   ```js
   app.use((err, req, res, next) => {
     if (err?.type === 'entity.parse.failed') {
       return res.status(400).json({ error: 'Invalid JSON body.' });
     }
     // ... existing 500 handling
   });
   ```
3. **Malformed cookie:** treat an undecodable cookie as "no session":

   ```js
   try {
     return decodeURIComponent(part.slice(index + 1).trim());
   } catch {
     return null;
   }
   ```
4. **OPTIONS:** if method enumeration matters, return `405`/`404` consistently or disable automatic `OPTIONS` for `/api/*`.
5. Keep `x-powered-by` disabled and the generic 500 message — both are already correct.

## Verification

- `/api/health` should not reveal DB state to an unauthenticated caller.
- Malformed JSON should return `400`, not `500`.
- `Cookie: sia_admin=%` should return `401` (treated as no session), not `500`.
- Error logs should not grow on malformed input.

## References

- OWASP ASVS 5.0 V7.4 / V14.3
- CWE-200, CWE-755
