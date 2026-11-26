# L-04 — Check-in is not atomic; concurrent scans both report success

| | |
| --- | --- |
| **Severity** | Low |
| **CVSS 3.1** | 2.6 — `AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:N` |
| **CWE** | CWE-362 (Concurrent Execution using Shared Resource with Improper Synchronization / Race Condition) |
| **Component** | `POST /api/checkin` |
| **Affected code** | `server/src/index.js:252-269` |
| **Status** | Code review |

## Summary

Check-in reads the row, decides based on `checkedInAt`, updates with a `WHERE checked_in_at IS NULL` guard, then re-reads:

```js
const attendee = toAttendee(row);
if (attendee.checkedInAt) {
  return res.json({ status: 'already', attendee });
}

await pool.execute(
  'UPDATE attendees SET checked_in_at = NOW() WHERE code = ? AND checked_in_at IS NULL',
  [code],
);
const [after] = await pool.execute('SELECT checked_in_at FROM attendees WHERE code = ?', [code]);

res.json({
  status: 'checked-in',
  attendee: { ...attendee, checkedInAt: toIso(after[0].checked_in_at) },
});
```

The `UPDATE` guard is correct (only one row is written), but the response does not inspect `affectedRows`. Two staff devices scanning the same ticket at the same moment both pass the initial `if`, both run the `UPDATE` (one affects 1 row, the other 0), and both return `status: 'checked-in'` with the same timestamp.

## Impact

- Two volunteers both believe they admitted the attendee; the second should see "already checked in."
- No data corruption: `checked_in_at` is set once.
- A duplicate-scan alert or reconciliation report may be misleading.

Low severity: integrity of the timestamp is preserved; only the response is wrong.

## Preconditions

- Two concurrent `POST /api/checkin` requests for the same code (two scanners, retry, or a script).

## Reproduction

Use a test ticket code and fire two requests concurrently:

```bash
BASE=http://localhost:4000
CODE=<test-ticket-code>

curl -sS -b staff.jar -X POST "$BASE/api/checkin" \
  -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" &
curl -sS -b staff.jar -X POST "$BASE/api/checkin" \
  -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" &
wait
# Both may print {"status":"checked-in",...}
```

(A single sequential pair correctly returns `checked-in` then `already`; the race requires overlap.)

## Evidence

`server/src/index.js:252-269` (shown above).

## Root cause

The code uses a read-check-write pattern instead of relying on the atomic `UPDATE` result.

## Remediation

1. Make the update the decision point and check `affectedRows`:

   ```js
   const [result] = await pool.execute(
     'UPDATE attendees SET checked_in_at = NOW() WHERE code = ? AND checked_in_at IS NULL',
     [code],
   );
   const [after] = await pool.execute(
     'SELECT checked_in_at FROM attendees WHERE code = ?',
     [code],
   );
   const checkedInAt = toIso(after[0].checked_in_at);
   res.json({
     status: result.affectedRows === 1 ? 'checked-in' : 'already',
     attendee: { ...attendee, checkedInAt },
   });
   ```

   Remove the early `if (attendee.checkedInAt)` return (or keep it as a fast path but still derive the status from `affectedRows`).
2. Optionally wrap the update and read in a transaction, or use `SELECT ... FOR UPDATE`.
3. Add a concurrency test (two parallel requests) asserting exactly one `checked-in` and one `already`.

## Verification

Fire N concurrent requests for the same code; exactly one should return `checked-in` and the rest `already`, and `checked_in_at` should be a single timestamp.

## References

- OWASP ASVS 5.0 V1.4 / V11.1 — concurrency and business logic
- CWE-362
