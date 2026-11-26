# M-02 — Missing browser security headers; admin panel is clickjackable

| | |
| --- | --- |
| **Severity** | Medium |
| **CVSS 3.1** | 4.3 — `AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N` |
| **CWE** | CWE-1021 (Improper Restriction of Rendered UI Layers / Clickjacking), CWE-693 (Protection Mechanism Failure) |
| **Component** | Express middleware / SPA shell |
| **Affected code** | `server/src/index.js:25-28` (no `helmet`), `server/src/index.js:311-318` (static/SPA) |
| **Status** | **Confirmed live** |

## Summary

The app sets no security headers. Responses from both the API and the SPA lack:

- `Content-Security-Policy`
- `X-Frame-Options` (or `frame-ancestors`)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`

`x-powered-by` is correctly disabled, and Express sets `nosniff` on its own `OPTIONS` responses, but not on normal responses.

The practical consequence is **clickjacking**: `/dev/admin` and `/staff` can be embedded in a third-party page. A logged-in owner or organizer can be tricked into clicking "Delete event", "Approve", or "Delete volunteer" inside an invisible frame. The admin UI has confirmation dialogs, but the attacker controls the overlay and can align clicks.

## Impact

- Clickjacking of destructive admin actions (delete event/registrations, approve/reject volunteers, disable organizers).
- No CSP as defense-in-depth against any future XSS or third-party script injection.
- Missing `nosniff` allows some older browsers to MIME-sniff responses.
- Missing `Referrer-Policy` can leak the admin URL (and any query string) to external sites.

## Preconditions

- Victim is signed in to the admin/staff panel.
- Victim visits an attacker-controlled page (or an attacker-controlled embed).

## Reproduction

```bash
BASE=http://localhost:4000
curl -sS -D- -o /dev/null "$BASE/" \
  | grep -iE 'content-security-policy|x-frame-options|x-content-type-options|referrer-policy|strict-transport-security'
# (no output)

curl -sS -D- -o /dev/null "$BASE/api/events" \
  | grep -iE 'content-security-policy|x-frame-options|x-content-type-options|referrer-policy'
# (no output)
```

Clickjacking proof of concept — save as `evil.html` and open it while signed in to the admin panel:

```html
<!doctype html>
<html>
  <body style="margin:0">
    <h1>You have won a prize — click to claim</h1>
    <iframe src="http://localhost:4000/dev/admin?tab=events"
            style="width:1200px;height:900px;opacity:0.0001;position:absolute;top:0;left:0"></iframe>
  </body>
</html>
```

The admin UI loads inside the frame. An attacker positions a decoy over the Delete button; the click reaches the framed app. (Modern browsers do not block this without `frame-ancestors`/`X-Frame-Options`.)

## Evidence

`server/src/index.js:25-28` — no security-header middleware:

```js
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use(express.json({ limit: '16kb' }));
```

`server/src/index.js:311-318` — the SPA is served without headers:

```js
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}
```

## Root cause

No `helmet` (or equivalent) and no manual header middleware. The app relies entirely on browser defaults.

## Remediation

1. Add `helmet` and configure CSP for the Vite/React build:

   ```js
   import helmet from 'helmet';

   app.use(helmet({
     contentSecurityPolicy: {
       directives: {
         defaultSrc: ["'self'"],
         scriptSrc: ["'self'"],
         styleSrc: ["'self'", "'unsafe-inline'"], // Radix/Tailwind inline styles
         imgSrc: ["'self'", 'data:'],
         connectSrc: ["'self'"],
         fontSrc: ["'self'"],
         objectSrc: ["'none'"],
         baseUri: ["'self'"],
         formAction: ["'self'"],
         frameAncestors: ["'none'"],
       },
     },
     frameguard: { action: 'deny' },
     referrerPolicy: { policy: 'no-referrer' },
   }));
   ```

   If adding a dependency is undesirable, set the same headers manually:

   ```js
   app.use((_req, res, next) => {
     res.set('X-Frame-Options', 'DENY');
     res.set('X-Content-Type-Options', 'nosniff');
     res.set('Referrer-Policy', 'no-referrer');
     res.set('Content-Security-Policy',
       "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
       "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
     next();
   });
   ```

2. Test the production build after enabling CSP — Vite may inline a small bootstrap script; if so, use a hash/nonce or keep `script-src 'self'` and verify the console is clean.
3. Do **not** add HSTS blindly; only enable it once the deployment is permanently HTTPS and all subdomains are ready.
4. Add a response-header regression test (e.g. a small `supertest` assertion).

## Verification

```bash
curl -sS -D- -o /dev/null http://localhost:4000/ \
  | grep -iE 'content-security-policy|x-frame-options|x-content-type-options|referrer-policy'
```

Expect all four headers. Then load the clickjacking PoC — the frame should be refused.

## References

- OWASP Clickjacking Defense Cheat Sheet
- OWASP Secure Headers Project
- Express security best practices — Helmet
- CWE-1021, CWE-693
