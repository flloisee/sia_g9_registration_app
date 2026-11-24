import { ArrowRight, CalendarX, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, ApiError, type PublicEventInfo } from '@/lib/api';
import { formatEventDate } from '@/lib/format';

export function EventsPage() {
  const [events, setEvents] = useState<PublicEventInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);

    api
      .events()
      .then(({ events }) => {
        if (!cancelled) setEvents(events);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load the events.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="animate-rise">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          Guest
        </p>
        <h1 className="mt-3 text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] sm:text-[34px]">
          Events
        </h1>
        <p className="mt-2.5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          Pick the event you're attending to register and get your QR ticket.
        </p>
      </header>

      {error && (
        <div className="mt-6 animate-rise rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-[13px] text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setAttempt((count) => count + 1)}
          >
            Try again
          </Button>
        </div>
      )}

      {!error && events === null && (
        <p className="py-20 text-center text-sm text-muted-foreground">Loading events…</p>
      )}

      {!error && events?.length === 0 && (
        <div className="mt-6 animate-rise rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <CalendarX className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-4 text-[15px] font-medium">No events yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Registration will open once an event is published.
          </p>
        </div>
      )}

      {!error && events && events.length > 0 && (
        <ul className="mt-6 grid animate-rise-slow gap-3">
          {events.map((event) => {
            const past = new Date(event.startsAt).getTime() <= Date.now();
            return (
              <li key={event.id}>
                <Link
                  to={`/events/${event.id}`}
                  className="group flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-5 outline-none transition-[background-color,border-color,transform] duration-150 ease-out hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/35 active:scale-[0.995]"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        {event.name}
                      </span>
                      {event.open ? (
                        <Badge variant="success">Open</Badge>
                      ) : (
                        <Badge variant="outline">{past ? 'Past' : 'Closed'}</Badge>
                      )}
                    </span>
                    <span className="mt-1.5 block truncate text-[17px] font-semibold tracking-[-0.01em]">
                      {event.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                      <span>{formatEventDate(event.startsAt)}</span>
                      {event.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3.5" aria-hidden />
                          {event.location}
                        </span>
                      )}
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
