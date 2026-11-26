# L-02 — Registration has no email ownership check: ticket squatting and email bombing

| | |
| --- | --- |
| **Severity** | Low |
| **CVSS 3.1** | 3.1 — `AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N` |
| **CWE** | CWE-620 (Unverified Password Change / Unverified Ownership), CWE-799 (Improper Control of Interaction Frequency) |
| **Component** | `POST /api/register` |
| **Affected code** | `server/src/index.js:172-214`, `server/src/index.js:107-127` |
| **Status** | Code review |

## Summary

Anyone can register any email address for an open event. The response returns the full ticket — including the 8-character code — to the **submitter**, while the email (and QR) goes to the address on the form. There is no verification that the submitter owns that address.

Consequences:

1. **Ticket squatting / denial:** an attacker registers `victim@example.com`, receives a valid ticket code, and the victim cannot register (unique `(event_id, email)` → `409`). The attacker can use the code to check in, or simply hold it.
2. **Email bombing:** the victim receives an unsolicited ticket email. The only limit is 10 requests / 10 min per IP (`index.js:172`), and behind a proxy that limit is global (see **M-03**).
3. **Data pollution:** the attendee list fills with addresses the owners do not control.

This is Low because the attacker gains no data and the impact is limited to a single event/email, but it is a real abuse vector for a public registration page.

## Impact

- A legitimate guest can be blocked from registering (409) by someone else using their email.
- Unsolicited email sent from the event's domain (reputation damage, spam complaints).
- Fraudulent tickets that look legitimate in the attendee list.

## Preconditions

- An open event (`status='open'`, not started, deadline not passed).
- Knowledge of the victim's email address.

## Reproduction

```bash
BASE=http://localhost:4000

# Attacker registers the victim's address and receives the ticket code.
curl -sS -X POST "$BASE/api/register" \
  -H 'content-type: application/json' \
  -d '{"eventId":2,"fullName":"Victim Name","email":"victim@example.com","organization":"Victim Org","phone":"+15551234567"}' \
  | jq '{code: .attendee.code, emailSent, qrUrl}'
# 201 { "code": "ABCD2345", "emailSent": true, "qrUrl": "/api/tickets/ABCD2345/qr.png" }

# The victim now cannot register:
curl -sS -X POST "$BASE/api/register" \
  -H 'content-type: application/json' \
  -d '{"eventId":2,"fullName":"Victim Name","email":"victim@example.com","organization":"Victim Org","phone":"+15551234567"}'
# 409 {"error":"That email is already registered for this event."}
```

## Evidence

`server/src/index.js:185-213`:

```js
created = await insertAttendee(event.id, parsed.value);
// ...
const attendee = { ...parsed.value, code: created.code };
// ...
res.status(201).json({
  attendee,                    // includes the code
  eventName: event.name,
  qrUrl: `/api/tickets/${attendee.code}/qr.png`,
  emailSent,
  emailPreviewUrl: email.previewUrl,
});
```

`server/src/index.js:118-121`:

```js
if (err.message.includes('uq_event_email')) {
  throw Object.assign(new Error('That email is already registered for this event.'), { status: 409 });
}
```

## Root cause

Registration treats "the form says this email" as proof of ownership. The ticket code is issued immediately and returned to the submitter.

## Remediation

1. **Verify before issuing:** create a `pending` registration, email a confirmation link, and only activate/issue the ticket code when the link is opened. This also fixes the enumeration oracle in **L-01**.
2. If you must keep instant registration, at minimum:
   - Do not return the ticket code in the response; show "check your email."
   - Add a per-email cooldown (e.g. one registration email per address per 10 minutes) in addition to the per-IP limit.
   - Allow the legitimate owner to reclaim/cancel a registration via the emailed link.
3. Add a CAPTCHA or proof-of-work to the public form if abuse is observed.
4. Keep the `(event_id, email)` unique constraint — it is correct; just make the error generic (see **L-01**).

## Verification

- Registering an address should not reveal a ticket code until the address is confirmed.
- A second registration for the same address within the cooldown should not send another email.
- The legitimate owner should be able to complete registration even if someone else tried the address first.

## References

- OWASP Account Enumeration / Registration Cheat Sheet
- OWASP ASVS 5.0 V2.5 / V2.8
- CWE-620, CWE-799
