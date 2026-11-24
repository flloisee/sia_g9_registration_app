import {
  ArrowLeft,
  CalendarX,
  Check,
  Download,
  MailCheck,
  MailX,
  MapPin,
  Share2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RegisterForm } from '@/components/RegisterForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, ApiError, type PublicEventInfo, type RegisterResult } from '@/lib/api';
import { formatDateTime, formatEventDate } from '@/lib/format';

type EventState = {
  loading: boolean;
  event: PublicEventInfo | null;
  error: string | null;
};

export function EventPage() {
  const { id } = useParams();
  const eventId = Number(id);
  const [state, setState] = useState<EventState>({ loading: true, event: null, error: null });
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!Number.isInteger(eventId)) {
      setState({ loading: false, event: null, error: 'Event not found.' });
      return;
    }

    let cancelled = false;
    setState({ loading: true, event: null, error: null });
    setResult(null);

    api
      .event(eventId)
      .then(({ event }) => {
        if (!cancelled) setState({ loading: false, event, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          loading: false,
          event: null,
          error: error instanceof ApiError ? error.message : 'Could not load the event.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, attempt]);

  if (state.loading) {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading event…</p>;
  }

  if (state.error || !state.event) {
    return (
      <div className="mx-auto w-full max-w-xl animate-rise rounded-xl border border-border bg-card p-8 text-center">
        <CalendarX className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.01em]">
          {state.error ?? 'Event not found'}
        </h1>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/events">Back to events</Link>
          </Button>
        </div>
      </div>
    );
  }

  const event = state.event;

  if (result) {
    return (
      <div className="mx-auto w-full max-w-xl">
        <TicketCard event={event} result={result} onReset={() => setResult(null)} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <Link
        to="/events"
        className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>

      <header className="mt-5 animate-rise">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {event.name} · {formatEventDate(event.startsAt)}
          </p>
          {event.open ? (
            <Badge variant="success">Registration open</Badge>
          ) : (
            <Badge variant="outline">Registration closed</Badge>
          )}
        </div>
        <h1 className="mt-3 text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[34px]">
          {event.title}
        </h1>
        {event.body && (
          <p className="mt-2.5 max-w-md text-[15px] leading-relaxed whitespace-pre-line text-muted-foreground">
            {event.body}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {event.location && (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden />
              {event.location}
            </p>
          )}
          <ShareButton title={event.title} url={eventShareUrl(event.id)} />
        </div>
      </header>

      <div className="mt-8">
        {event.open ? (
          <RegisterForm eventId={event.id} onSuccess={setResult} />
        ) : (
          <ClosedCard event={event} />
        )}
      </div>
    </div>
  );
}

function eventShareUrl(id: number) {
  return `${window.location.origin}/events/${id}`;
}

function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this event link', url);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void share()}>
      {copied ? <Check aria-hidden /> : <Share2 aria-hidden />}
      {copied ? 'Link copied' : 'Share event'}
    </Button>
  );
}

function ClosedCard({ event }: { event: PublicEventInfo }) {
  return (
    <div className="animate-rise-slow rounded-xl border border-border bg-card p-6 sm:p-8">
      <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <CalendarX className="size-5" aria-hidden />
      </div>
      <h2 className="mt-4 text-[19px] font-semibold tracking-[-0.01em]">Registration is closed</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
        {closedReason(event)}
      </p>
      <p className="mt-4 text-[13px] text-muted-foreground">
        {event.name} · {formatEventDate(event.startsAt)}
      </p>
    </div>
  );
}

function closedReason(event: PublicEventInfo) {
  const now = Date.now();
  if (new Date(event.startsAt).getTime() <= now) return 'This event has already started.';
  if (event.status === 'closed') return 'The organizer has closed registration.';
  if (event.registrationClosesAt && new Date(event.registrationClosesAt).getTime() <= now) {
    return `Registration closed on ${formatDateTime(event.registrationClosesAt)}.`;
  }
  return 'Registration is not open right now.';
}

function TicketCard({
  event,
  result,
  onReset,
}: {
  event: PublicEventInfo;
  result: RegisterResult;
  onReset: () => void;
}) {
  const { attendee, eventName, qrUrl, emailSent, emailPreviewUrl } = result;

  return (
    <div className="animate-rise">
      <div className="rounded-xl border border-border bg-card p-6 text-center shadow-[0_1px_2px_oklch(0.235_0.012_268/0.04),0_10px_30px_-24px_oklch(0.235_0.012_268/0.35)] sm:p-8">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-success/10 text-success">
          <Check className="size-5" aria-hidden />
        </div>
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.01em]">You're registered.</h1>
        <p className="mt-1.5 text-[14px] text-muted-foreground">
          {attendee.fullName}, your ticket for {eventName} is below.
        </p>

        <div className="mx-auto mt-6 w-fit rounded-xl border border-border bg-white p-3">
          <img
            src={qrUrl}
            alt={`QR code for ticket ${attendee.code}`}
            width={208}
            height={208}
            className="size-52"
          />
        </div>

        <p className="mt-5 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Ticket code
        </p>
        <p className="mt-1 font-mono text-[19px] font-semibold tracking-[0.16em] tabular-nums">
          {attendee.code}
        </p>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
          {emailSent ? (
            <>
              <MailCheck className="size-4" aria-hidden />
              Sent to {attendee.email}
            </>
          ) : (
            <>
              <MailX className="size-4 text-warning" aria-hidden />
              Email could not be sent — save the QR code below
            </>
          )}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
          <Button asChild variant="outline">
            <a href={qrUrl} download={`sia-g9-${attendee.code}.png`}>
              <Download aria-hidden />
              Save ticket
            </a>
          </Button>
          <ShareButton title={event.title} url={eventShareUrl(event.id)} />
          <Button variant="ghost" onClick={onReset}>
            Register someone else
          </Button>
        </div>
      </div>

      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        Bring the QR code on your phone. If the email is missing, check spam.
      </p>

      {emailPreviewUrl && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Dev inbox:{' '}
          <a
            href={emailPreviewUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline underline-offset-2"
          >
            open the sent email
          </a>
        </p>
      )}
    </div>
  );
}
