import { RefreshCw, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, ApiError, type Attendee, type AttendeesResult } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export function AttendeeList({
  lockedEventId,
  canDelete = false,
}: {
  lockedEventId?: number;
  canDelete?: boolean;
}) {
  const [data, setData] = useState<AttendeesResult | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [eventId, setEventId] = useState<number | ''>('');
  const [reload, setReload] = useState(0);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api
      .attendees(lockedEventId ?? (eventId || undefined))
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError({
          message: err instanceof ApiError ? err.message : 'Could not load attendees.',
          status: err instanceof ApiError ? err.status : 0,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reload, eventId, lockedEventId]);

  const search = query.trim().toLowerCase();
  const rows = (data?.attendees ?? []).filter(
    (attendee) =>
      !search ||
      [attendee.fullName, attendee.email, attendee.organization, attendee.code, attendee.eventName ?? ''].some(
        (value) => value.toLowerCase().includes(search),
      ),
  );

  const total = data?.stats.total ?? 0;
  const checkedIn = data?.stats.checkedIn ?? 0;

  async function remove(attendee: Attendee) {
    setDeletingId(attendee.id);
    try {
      await api.admin.deleteAttendee(attendee.id);
      setConfirmId(null);
      setReload((count) => count + 1);
    } catch (err) {
      setError({
        message: err instanceof ApiError ? err.message : 'Could not remove the attendee.',
        status: err instanceof ApiError ? err.status : 0,
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <header className="mb-6 flex animate-rise items-end justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Attendees</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Everyone registered, and who has come through the door.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setReload((count) => count + 1)}
          disabled={loading}
          aria-label="Refresh attendees"
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden />
        </Button>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive"
        >
          <span>{error.message}</span>
          {error.status === 401 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.assign('/staff')}
            >
              Sign in again
            </Button>
          )}
        </div>
      )}

      <div className="grid animate-rise-slow grid-cols-3 gap-3">
        <Stat label="Registered" value={total} />
        <Stat label="Checked in" value={checkedIn} />
        <Stat label="Remaining" value={Math.max(total - checkedIn, 0)} />
      </div>

      <div
        className={
          lockedEventId
            ? 'mt-4 grid gap-3'
            : 'mt-4 grid gap-3 sm:grid-cols-[1fr_15rem]'
        }
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, organization or code"
            aria-label="Search attendees"
            className="pl-10"
          />
        </div>
        {!lockedEventId && (
          <Select
            value={eventId}
            onChange={(event) => setEventId(event.target.value ? Number(event.target.value) : '')}
            aria-label="Filter by event"
          >
            <option value="">All events</option>
            {(data?.events ?? []).map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[840px] text-left text-[13px]">
          <thead className="border-b border-border bg-muted/40 text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Attendee
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Event
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Email
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Code
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Checked in
              </th>
              {canDelete && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Remove
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {rows.map((attendee) => (
              <tr key={attendee.id} className="transition-colors duration-150 hover:bg-muted/40">
                <td className="px-4 py-3">
                  <p className="font-medium">{attendee.fullName}</p>
                  <p className="text-xs text-muted-foreground">{attendee.organization}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{attendee.eventName}</td>
                <td className="px-4 py-3 text-muted-foreground">{attendee.email}</td>
                <td className="px-4 py-3">
                  <span className="font-mono text-[12px] tracking-[0.08em] tabular-nums">
                    {attendee.code}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {attendee.checkedInAt ? (
                    <Badge variant="success">Checked in</Badge>
                  ) : (
                    <Badge variant="outline">Expected</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground tabular-nums">
                  {attendee.checkedInAt ? formatDateTime(attendee.checkedInAt) : '—'}
                </td>
                {canDelete && (
                  <td className="px-4 py-3">
                    {confirmId === attendee.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="mr-1 text-[12px] text-destructive">Remove?</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void remove(attendee)}
                          disabled={deletingId === attendee.id}
                        >
                          {deletingId === attendee.id ? 'Removing…' : 'Remove'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setConfirmId(attendee.id)}
                          aria-label={`Remove ${attendee.fullName}`}
                        >
                          <Trash2 aria-hidden />
                          Remove
                        </Button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 7 : 6} className="px-4 py-10 text-center text-muted-foreground">
                  {loading
                    ? 'Loading attendees…'
                    : search
                      ? 'No matches.'
                      : 'No one has registered yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-[24px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </p>
    </div>
  );
}
