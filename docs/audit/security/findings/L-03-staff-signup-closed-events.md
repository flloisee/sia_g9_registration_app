# L-03 — Volunteer signup allowed for closed or past-deadline events

| | |
| --- | --- |
| **Severity** | Low |
| **CVSS 3.1** | 3.1 — `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N` |
| **CWE** | CWE-863 (Incorrect Authorization) |
| **Component** | `POST /api/staff/signup` |
| **Affected code** | `server/src/staff.js:26-32`, `web/src/pages/StaffPage.tsx:79-81` |
| **Status** | Code review |

## Summary

Staff signup validates only that the event has not started yet:

```js
const [events] = await pool.execute(
  'SELECT id FROM events WHERE id = ? AND starts_at > NOW()',
  [eventId],
);
```

It does **not** check `status = 'open'` or `registration_closes_at`, unlike guest registration (`index.js:63-70`). The client filter is also only `startsAt > now` (`StaffPage.tsx:79-81`), so closed events appear in the volunteer dropdown.

An attacker can request to volunteer for an event the organizer has explicitly closed (full, private, cancelled registration). If an organizer approves the request — for example, without noticing the event is closed — the volunteer gets access to that event's attendee list and check-in tools.

## Impact

- Bypass of the organizer's "registration closed" intent for volunteer staffing.
- A volunteer account can gain attendee PII and check-in capability for an event the organizer meant to freeze.
- Noise in the approvals queue.

The approval step is still a gate, so this is Low.

## Preconditions

- An event with `starts_at > NOW()` but `status='closed'` or `registration_closes_at <= NOW()`.
- An organizer approves the resulting request.

## Reproduction

```bash
BASE=http://localhost:4000

# Pick an upcoming event whose registration is closed (status='closed'
# or registration_closes_at in the past, starts_at in the future).
curl -sS -X POST "$BASE/api/staff/signup" \
  -H 'content-type: application/json' \
  -d '{"name":"Volunteer","email":"volunteer@example.com","password":"Volunteer123","eventId":2}'
# 201 and a pending staff session — even though the event is closed.

# The client also lists closed upcoming events in the "Volunteer for" select,
# because StaffPage filters only on startsAt.
```

## Evidence

`server/src/staff.js:26-32`:

```js
const [events] = await pool.execute(
  'SELECT id FROM events WHERE id = ? AND starts_at > NOW()',
  [eventId],
);
if (!events.length) {
  return res.status(400).json({ error: 'That event is no longer open for volunteers.' });
}
```

`web/src/pages/StaffPage.tsx:79-81`:

```ts
const upcoming = (events ?? []).filter(
  (event) => new Date(event.startsAt).getTime() > Date.now(),
);
```

Compare guest registration's `eventIsOpen()` (`index.js:63-70`), which checks `status` and `registration_closes_at`.

## Root cause

The volunteer flow reused a simplified "event is in the future" check instead of the shared "event is open" predicate.

## Remediation

1. Reuse the same predicate as guest registration:

   ```js
   const [events] = await pool.execute(
     `SELECT id FROM events
       WHERE id = ? AND status = 'open' AND starts_at > NOW()
         AND (registration_closes_at IS NULL OR registration_closes_at > NOW())`,
     [eventId],
   );
   ```
2. Re-check the predicate when an organizer approves the request (`admin.js:411-415`), so an event closed between signup and approval cannot be staffed.
3. Filter the client dropdown with `event.open` (the public API already returns it) rather than `startsAt`.
4. If volunteers should be allowed after guest registration closes, add an explicit `volunteer_signup_closes_at` column rather than overloading the guest deadline.

## Verification

- Signup for a closed event should return `400`.
- Approval for an event that closed after signup should return `400` with a clear message.
- The dropdown should not list closed events.

## References

- OWASP ASVS 5.0 V8.3 — function-level authorization
- CWE-863
