# Security Audit — Event Manager

**Date:** 2026-11-26
**Target:** `sia_g9_registration_app` (Express 5 API + React 19 SPA + MySQL)
**Audit type:** Black-box testing against the running instance, backed by source review for root cause and line references
**Test instance:** `http://127.0.0.1:4000` / `http://[::1]:4000` (built SPA + API, MySQL reachable)
**Scope:** all server routes, authentication/session handling, authorization, email flows, logging, static serving, and the React client

---

## Executive summary

The application is generally well built for its size: SQL is fully parameterized, passwords use Argon2id, session tokens are random 256-bit values stored only as SHA-256 hashes in `httpOnly` cookies, React output is escaped, and most admin mutations correctly enforce event ownership.

One **High** issue stands out. The attendee endpoint trusts a caller-supplied `eventId` and has no ownership check for the `organizer` role, so any approved organizer — including one who owns no events — can read the personal data and ticket codes of **every attendee at every event**, and can check attendees in across tenant boundaries. This was confirmed live: a temporary organizer account read all 5 attendees of an event it did not own, then was removed.

The remaining findings are Medium/Low and mostly concern operational hardening: credentials and tokens written to application logs, missing browser security headers, reverse-proxy/`Secure`-cookie misconfiguration behind the documented localtunnel setup, a Host-header-dependent email link, missing throttling on several endpoints, and a default admin password that the migration accepts unchanged.

No SQL injection, stored/reflected XSS, open redirect, SSRF, command injection, or known vulnerable dependencies were found. `npm audit --omit=dev` reported **0** advisories.

### Findings at a glance

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| [H-01](findings/H-01-attendee-idor.md) | **High** | Cross-tenant attendee read/write (broken object-level authorization) | Read confirmed live; write via code review |
| [M-01](findings/M-01-sensitive-data-in-logs.md) | Medium | Ticket codes and email-change tokens written to `docs/logs` | Confirmed in logs |
| [M-02](findings/M-02-missing-security-headers.md) | Medium | No CSP / anti-framing / `nosniff` headers; admin is clickjackable | Confirmed live |
| [M-03](findings/M-03-proxy-trust-and-cookie-secure.md) | Medium | `trust proxy` off by default → global rate-limit DoS, non-`Secure` cookie over TLS | Confirmed live |
| [M-04](findings/M-04-host-header-email-change.md) | Medium | Email-change link built from the `Host` header | Code review |
| [M-05](findings/M-05-missing-rate-limits.md) | Medium | No throttling on ticket QR, check-in, attendee, or token endpoints | Confirmed live |
| [M-06](findings/M-06-default-admin-password.md) | Medium | Migration accepts the example admin password | Code review |
| [L-01](findings/L-01-auth-enumeration-bruteforce.md) | Low | Login timing/enumeration and weak brute-force posture | Code review |
| [L-02](findings/L-02-registration-abuse.md) | Low | No email ownership check; ticket squatting and email bombing | Code review |
| [L-03](findings/L-03-staff-signup-closed-events.md) | Low | Volunteer signup allowed for closed/past-deadline events | Code review |
| [L-04](findings/L-04-checkin-race.md) | Low | Non-atomic check-in reports success twice | Code review |
| [L-05](findings/L-05-csrf-defense-in-depth.md) | Low | No explicit CSRF/Origin defense (currently mitigated incidentally) | Code review |
| [L-06](findings/L-06-information-disclosure.md) | Low | Health endpoint, 500s on bad JSON/cookies, method hints | Confirmed live |

### Remediation order

1. **H-01** — scope `/api/attendees` and `/api/checkin` to the caller's events; add regression tests.
2. **M-01** — stop logging query strings and ticket paths; rotate/expire any live tokens in logs.
3. **M-03 / M-06** — make proxy trust and admin credentials explicit and fail-closed.
4. **M-02 / M-04** — add `helmet`, an `APP_ORIGIN` setting, and Origin checks.
5. **M-05 / L-01 / L-02** — add per-account throttling and email verification.
6. **L-03 … L-06** — small correctness and defense-in-depth fixes.

---

## Methodology

1. **Reconnaissance** — mapped routes, middleware order, auth/session model, database schema, email flows, and the React client. Confirmed the stack and the built SPA on `:4000`.
2. **Unauthenticated probing** — `GET /api/health`, `/api/events`, `/api/tickets/:code/qr.png`, `/api/attendees`, `/api/checkin`, malformed JSON, CORS preflight, `TRACE`, path traversal attempts, security headers.
3. **Authenticated probing** — created a temporary organizer via the owner API, signed in as that organizer, exercised `GET /api/attendees` (the read path), then deleted the account. The `/api/checkin` write path was confirmed by code review, not executed against real attendee data. No attendee PII is reproduced in this report.
4. **Source review** — traced every finding to the exact route and line; checked the React client for DOM XSS sinks and client-only authorization.
5. **Dependency check** — `npm audit --omit=dev` (0 advisories at the time of testing).

### Test environment note

The running server had no `TRUST_PROXY` set, so `req.ip` was the socket address (`::ffff:127.0.0.1` for IPv4, `::1` for IPv6). This is itself part of finding **M-03**: the in-memory limiter treats all users behind a proxy as one client.

---

## Positive controls (verified)

These are working well and should be preserved:

- **SQL injection:** every query uses `pool.execute(..., [params])` or fixed `pool.query` strings. No string interpolation of user input.
- **XSS:** no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `document.write` in `web/src`. React escapes all event/attendee strings. Server-rendered email HTML and the confirm-email page escape interpolated values.
- **Passwords:** Argon2id at OWASP baseline (19 MiB, 2 passes, 1 lane); legacy scrypt hashes are rehashed on login.
- **Sessions:** 256-bit random tokens, SHA-256 hashed at rest, `httpOnly`, `SameSite=Lax`, 7-day expiry, revoked on disable/delete and on migration password change.
- **Authorization (most routes):** event update/delete, volunteer edit/delete, staff-request approval, and organizer management all enforce ownership/role correctly. The owner account cannot be disabled through the API.
- **IDs:** user IDs are UUIDs; ticket codes are 8 chars from a 32-symbol alphabet (40 bits) with unbiased modulo and no ambiguous characters.
- **Email-change tokens:** 256-bit, hashed at rest, 24-hour expiry, single-use.
- **Input limits:** `express.json({ limit: '16kb' })`, field length caps, `EMAIL_RE`/`PHONE_RE`, `CODE_RE`, UUID regex.
- **No CORS wildcard, no open redirects, no SSRF, no command execution, no file uploads.**
- **`x-powered-by` disabled**; error handler returns a generic message without stack traces.

---

## Assumptions and limitations

- Findings that require an organizer/admin session were verified by code review; only the **H-01** read path was exercised end-to-end with a real account.
- TLS termination, WAF, and reverse-proxy header rewriting are deployment concerns. Where the app relies on them, the report says so.
- No denial-of-service, destructive, or data-mutating payloads were run against production data. The check-in write path was reviewed, not executed.
- The audit reflects the code at commit `f89736c` and the running instance on 2026-11-26. Re-test after fixes.

---

## References

- OWASP ASVS 5.0 — V8 Authorization, V3 Session Management, V7 Error Handling and Logging
- OWASP Cheat Sheets — Authorization, CSRF, Session Management, Logging, Clickjacking Defense
- Express security best practices — `trust proxy`, cookie flags, error handling, rate limiting
- CWE-639 (Authorization Bypass Through User-Controlled Key), CWE-284 (Improper Access Control), CWE-532 (Insertion of Sensitive Information into Log Files), CWE-1021 (Improper Restriction of Rendered UI Layers / Clickjacking), CWE-644 (Improper Neutralization of HTTP Headers), CWE-307 (Improper Restriction of Excessive Authentication Attempts)
