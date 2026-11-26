# M-03 — Reverse-proxy trust is off by default: global rate-limit DoS and non-`Secure` cookies over TLS

| | |
| --- | --- |
| **Severity** | Medium |
| **CVSS 3.1** | 5.3 — `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:L` |
| **CWE** | CWE-307 (Improper Restriction of Excessive Authentication Attempts), CWE-614 (Sensitive Cookie in HTTPS Session Without 'Secure' Attribute), CWE-348 (Use of Less Trusted Source) |
| **Component** | Express `trust proxy`, session cookie, in-memory rate limiter |
| **Affected code** | `server/src/index.js:27`, `server/src/auth.js:77-85`, `server/src/helpers.js:45-59`, `README.md:55-63,76` |
| **Status** | **Confirmed live** (default configuration) |

## Summary

`trust proxy` is enabled only when `TRUST_PROXY=1`; the default is `false`:

```js
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
```

The documented sharing flow (`npm run share`) puts the app behind **localtunnel**, and production deployments normally sit behind a reverse proxy. With `trust proxy` false, every request appears to come from the proxy's address. That breaks two things:

1. **Rate limiting collapses to one global bucket.** `rateLimit()` keys on `req.ip` (`helpers.js:51`). Behind a proxy, all internet users share the proxy IP. One attacker can burn the 10-attempt login/registration budget and lock out everyone for 10 minutes.
2. **`Secure` is omitted from the session cookie over HTTPS.** `setSessionCookie` uses `secure: req.secure` (`auth.js:81`). With `trust proxy` false, `req.secure` is `false` even when the browser used HTTPS (the socket is HTTP from the proxy), so the cookie is set without `Secure`. If the same host is also reachable over plain HTTP, the cookie can be sent in cleartext.

If `TRUST_PROXY=1` is set but the proxy does **not** overwrite `X-Forwarded-For`, an attacker can spoof the header and get a fresh rate-limit bucket per request, defeating throttling entirely. Express only strips spoofed entries correctly when the hop count matches the real chain.

## Impact

- **Global denial of service:** an unauthenticated attacker can exhaust the shared login/registration/telemetry budget, blocking legitimate users.
- **Session confidentiality:** over a TLS-terminating proxy, the auth cookie lacks `Secure` and can be transmitted over HTTP if an HTTP route exists.
- **Rate-limit bypass:** misconfigured `TRUST_PROXY=1` plus a non-overwriting proxy allows spoofed client IPs.
- Logs also record the proxy IP for every user, reducing the value of incident response.

## Preconditions

- App behind a proxy/tunnel (the README's `npm run share` flow), with `TRUST_PROXY` unset (default) or misconfigured.
- For the cookie issue: TLS terminated upstream and an HTTP path to the same host.

## Reproduction

```bash
BASE=http://localhost:4000

# 1. Behind a proxy with TRUST_PROXY unset, all clients share req.ip.
#    Burn the login budget from one client:
for i in $(seq 1 12); do
  curl -s -o /dev/null -w '%{http_code} ' \
    -X POST "$BASE/api/admin/login" \
    -H 'content-type: application/json' \
    -d '{"email":"nobody@example.com","password":"x"}'
done; echo
# 401 401 401 401 401 401 401 401 401 429 429 429

# A second, legitimate user (same proxy IP) now gets 429 too.
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "$BASE/api/admin/login" \
  -H 'content-type: application/json' \
  -d '{"email":"real@example.com","password":"correct-horse"}'
# 429

# 2. X-Forwarded-For is ignored while trust proxy is false (same bucket):
for i in $(seq 1 12); do
  curl -s -o /dev/null -w '%{http_code} ' \
    -X POST "$BASE/api/admin/login" \
    -H "X-Forwarded-For: 10.0.0.$i" \
    -H 'content-type: application/json' \
    -d '{"email":"a@b.co","password":"x"}'
done; echo
# 401 x9 then 429 x3 — the spoofed IPs do not create new buckets

# 3. Cookie flags over a TLS-terminating proxy (illustrative):
curl -sS -D- -o /dev/null -X POST "$BASE/api/admin/login" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"<owner-password>"}' \
  | grep -i '^set-cookie:'
# Set-Cookie: sia_admin=...; Max-Age=...; Path=/; HttpOnly; SameSite=Lax
# No Secure flag because req.secure is false behind the proxy.
```

## Evidence

`server/src/index.js:27`:

```js
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
```

`server/src/auth.js:77-85`:

```js
export function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}
```

`server/src/helpers.js:45-59`:

```js
export function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) hits.clear();
    const recent = (hits.get(req.ip) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };
}
```

`README.md:55-63` documents `npm run share` via localtunnel; `README.md:76` documents `TRUST_PROXY` but it is absent from `.env.example`, so the default is easy to miss.

## Root cause

The default is "no proxy" while the primary deployment path is "behind a proxy." Rate limiting is keyed on a value that is only meaningful when proxy trust is correct, and the cookie's `Secure` flag depends on the same setting.

## Remediation

1. Make proxy trust explicit and fail closed:
   - Add `TRUST_PROXY` to `.env.example` with a comment.
   - In production (`NODE_ENV=production`), require `TRUST_PROXY` to be set (hop count or CIDR list), and log a startup warning if it is not.
   - Prefer an explicit hop count or subnet list over `true`.
2. Ensure the proxy **overwrites** `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` rather than appending untrusted values.
3. Set the cookie flag from the effective scheme, with an explicit override:

   ```js
   const secure = process.env.COOKIE_SECURE === 'true' || req.secure;
   res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_TTL_MS });
   ```

   Use `__Host-sia_admin` as the cookie name when `secure` is on (requires `Path=/`, no `Domain`, and `Secure`).
4. Add per-account throttling alongside per-IP, so a shared proxy IP cannot lock out everyone:

   ```js
   // e.g. key on `${req.ip}:${email}` for login, plus a looser per-IP cap
   ```

5. Do not rely on a single in-memory map for production; use a shared store (Redis) if you run more than one process, and do not wholesale `hits.clear()` (that resets all limits).
6. Document that localtunnel terminates TLS and must set `TRUST_PROXY=1` (and verify the forwarded headers it sends).

## Verification

Behind the real proxy:

```bash
# Different clients should get different buckets (not one global 429).
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/api/admin/login \
  -H 'content-type: application/json' -d '{"email":"a@b.co","password":"x"}'
# and from a second network:
# both should be 401, not 429 after a few attempts from the first.

# Cookie must include Secure over HTTPS:
curl -sS -D- -o /dev/null -X POST https://<host>/api/admin/login \
  -H 'content-type: application/json' -d '{"email":"...","password":"..."}' \
  | grep -i '^set-cookie:'
# ...; Secure; HttpOnly; SameSite=Lax
```

## References

- Express behind proxies — `trust proxy` semantics
- OWASP Session Management Cheat Sheet — `Secure`, `HttpOnly`, `SameSite`
- OWASP ASVS 5.0 V3.2 / V3.3
- CWE-307, CWE-614, CWE-348
