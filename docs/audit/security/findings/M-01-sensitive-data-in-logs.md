# M-01 — Ticket codes and email-change tokens written to application logs

| | |
| --- | --- |
| **Severity** | Medium |
| **CVSS 3.1** | 5.5 — `AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N` |
| **CWE** | CWE-532 (Insertion of Sensitive Information into Log File), CWE-312 (Cleartext Storage of Sensitive Information) |
| **Component** | Request logger + email-change flow |
| **Affected code** | `server/src/index.js:31-41`, `server/src/logger.js:52-66`, `server/src/admin.js:350`, `server/src/index.js:216-222` |
| **Status** | **Confirmed in existing logs** |

## Summary

The request logger writes `req.originalUrl` verbatim to `docs/logs/latest.log`:

```js
log.info(
  'Netty Server IO #1',
  `${req.method} ${req.originalUrl.slice(0, 300)} -> ${res.statusCode} ...`,
);
```

Two sensitive values travel in URLs:

1. **Email-change confirmation tokens** — `/api/admin/volunteers/confirm-email?token=<256-bit token>` (`admin.js:350`). The token is valid for 24 hours and is the only thing needed to apply an email change.
2. **Ticket codes** — `/api/tickets/<CODE>/qr.png` (`index.js:210`, `index.js:216`). The code is the bearer credential for check-in.

Both are now in plaintext in `docs/logs/`. The current log files are mode `600` (owner-only), so this is not a direct web exposure — the SPA fallback serves `index.html` for `/docs/...`, not the log. The risk is any copy of the logs: backups, support bundles, a shared host, a future static mount, or a log shipper that forwards to a third party.

## Impact

- Anyone who obtains a log copy can **confirm a pending volunteer email change** within its 24-hour window, taking over the login email for that volunteer account.
- Anyone who obtains a log copy can **read valid ticket codes** and use them at the door (or share them), causing duplicate admissions or denying the legitimate holder.
- Logs also contain client IPs, user IDs, user agents, and page paths, which is useful for reconnaissance and is PII-adjacent.

The confirm-email token is the more serious of the two because it is a full account-recovery secret.

## Preconditions

Read access to `docs/logs/*.log` (local user, backup, support bundle, or a future misconfiguration that serves the directory). No authentication is needed to use the token or the ticket code.

## Reproduction

```bash
cd /path/to/sia_g9_registration_app

# 1. Find email-change tokens in the logs.
grep -n "confirm-email?token=" docs/logs/*.log \
  | sed -E 's/token=[A-Za-z0-9_-]+/token=<redacted>/'

# 2. Find ticket codes in the logs.
grep -o "/api/tickets/[A-Z0-9]\{8\}/qr.png" docs/logs/*.log | sort -u
```

Observed on the audit instance (redacted):

```text
docs/logs/2026-11-25-logs.log:260:[17:12:47] ... GET /api/admin/volunteers/confirm-email?token=<redacted> -> 200 ...
docs/logs/2026-11-25-logs.log:261:[17:12:47] ... GET /api/admin/volunteers/confirm-email?token=<redacted> -> 400 ...
```

The ticket-code grep is also confirmed: requesting a QR image writes the full code to the log, e.g. `/api/tickets/ABCDEFGH/qr.png`.

Using a recovered token:

```bash
curl -sS "http://localhost:4000/api/admin/volunteers/confirm-email?token=<TOKEN_FROM_LOG>"
# 200 "Email updated" — the pending email change is applied
```

Using a recovered ticket code:

```bash
curl -sS -b staff.jar -X POST http://localhost:4000/api/checkin \
  -H 'content-type: application/json' \
  -d '{"code":"<CODE_FROM_LOG>"}'
```

## Evidence

`server/src/index.js:31-41`:

```js
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const agent = (req.get('user-agent') ?? '-').slice(0, 300);
    log.info(
      'Netty Server IO #1',
      `${req.method} ${req.originalUrl.slice(0, 300)} -> ${res.statusCode} (${Date.now() - startedAt}ms) ip=${req.ip} user=${req.user?.id ?? '-'} agent="${agent}"`,
    );
  });
  next();
});
```

`server/src/admin.js:346-351`:

```js
const mail = await sendEmailChangeEmail({
  to: email,
  name,
  confirmUrl: `${req.protocol}://${req.get('host')}/api/admin/volunteers/confirm-email?token=${token}`,
});
```

`server/src/index.js:207-213` and `index.js:216`:

```js
res.status(201).json({
  attendee,
  eventName: event.name,
  qrUrl: `/api/tickets/${attendee.code}/qr.png`,
  // ...
});
// ...
app.get('/api/tickets/:code/qr.png', async (req, res) => {
```

## Root cause

The logger records the raw URL, including query strings and path parameters that carry secrets. Secrets-in-URL is convenient but incompatible with request logging unless the logger redacts known-sensitive routes.

## Remediation

1. **Redact before logging.** Log a route template plus a sanitised query, not `originalUrl`:

   ```js
   // e.g. /api/tickets/:code/qr.png?x=... -> /api/tickets/:code/qr.png
   const path = req.route?.path ?? req.path;
   ```

   At minimum, replace `token=...` and `/api/tickets/<code>/` before writing:

   ```js
   const safeUrl = req.originalUrl
     .replace(/([?&]token=)[^&]+/gi, '$1<redacted>')
     .replace(/(\/api\/tickets\/)[A-Z0-9]{8}/gi, '$1<code>')
     .slice(0, 300);
   ```

2. **Prefer POST for token confirmation** (or a one-time nonce in the path) so the secret is not in the URL at all; if the link must be a GET, keep it out of logs as above.
3. **Do not put ticket codes in URLs.** Serve the QR by attendee ID behind auth, or accept the code in a POST body. If the public QR URL must stay, log it redacted.
4. **Treat existing logs as compromised.** Rotate/expire pending email-change tokens (`UPDATE users SET pending_email_token = NULL ...`) and consider that ticket codes present in logs may have been used.
5. Add a unit test for the log formatter: assert that `token` and ticket codes never appear in the output.
6. Keep the current `600` permissions and the 14-day retention; add a documented policy for log shipping.

## Verification

After the fix, make a request to the confirm-email route and a ticket QR route, then:

```bash
grep -n "confirm-email?token=\|/api/tickets/[A-Z0-9]\{8\}" docs/logs/latest.log
# no matches
```

## References

- OWASP Logging Cheat Sheet — never log credentials, session tokens, or PII
- OWASP ASVS 5.0 V7.1 — log content requirements
- CWE-532, CWE-312
