import {
  CalendarX,
  CheckCircle2,
  Clock3,
  Loader2,
  QrCode,
  Ticket,
  Users,
  XCircle,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AttendeeList } from '@/components/AttendeeList';
import { Scanner } from '@/components/Scanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  api,
  ApiError,
  type PublicEventInfo,
  type SessionUser,
} from '@/lib/api';
import { formatEventDate } from '@/lib/format';

export function StaffPage() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    api.admin
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  }, []);

  async function refreshUser() {
    try {
      const { user } = await api.admin.me();
      setUser(user);
    } catch {
      setUser(null);
    }
  }

  if (user === undefined) {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (!user) return <StaffAuth onAuth={setUser} />;
  return <StaffHome user={user} onSignOut={() => setUser(null)} onRefresh={refreshUser} />;
}

function StaffAuth({ onAuth }: { onAuth: (user: SessionUser) => void }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [eventId, setEventId] = useState('');
  const [events, setEvents] = useState<PublicEventInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .events()
      .then(({ events }) => {
        if (!cancelled) setEvents(events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const upcoming = (events ?? []).filter((event) => event.open);

  function switchMode(next: 'signin' | 'signup') {
    setMode(next);
    setError(null);
  }

  async function handleSignIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.admin.login(email.trim(), password);
      onAuth(user);
      // Admins land in their dashboard; staff stay on the check-in dashboard.
      if (user.role !== 'staff') navigate('/dev/admin', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.staff.signup({
        name: name.trim(),
        email: email.trim(),
        password,
        eventId: Number(eventId),
      });
      onAuth(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm animate-rise">
      <div className="rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_oklch(0.235_0.012_268/0.04),0_10px_30px_-24px_oklch(0.235_0.012_268/0.35)]">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          Staff
        </p>
        <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.01em]">
          {mode === 'signin' ? 'Sign in' : 'Volunteer'}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          {mode === 'signin'
            ? 'Check in attendees and see who is expected at your assigned event.'
            : 'Choose an event to volunteer for. An existing staff member or admin must approve you.'}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {(['signin', 'signup'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => switchMode(value)}
              aria-pressed={mode === value}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 ${
                mode === value
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {value === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form
          onSubmit={mode === 'signin' ? handleSignIn : handleSignUp}
          className="mt-5 grid gap-4"
        >
          {mode === 'signup' && (
            <div className="grid gap-2">
              <Label htmlFor="staff-name">Full name</Label>
              <Input
                id="staff-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="staff-email">Email</Label>
            <Input
              id="staff-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="staff-password">Password</Label>
            <Input
              id="staff-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 12 : undefined}
              required
            />
            {mode === 'signup' && (
              <p className="text-[12px] text-muted-foreground">At least 12 characters.</p>
            )}
          </div>

          {mode === 'signup' && (
            <div className="grid gap-2">
              <Label htmlFor="staff-event">Volunteer for</Label>
              <Select
                id="staff-event"
                value={eventId}
                onChange={(event) => setEventId(event.target.value)}
                required
              >
                <option value="">Choose an event</option>
                {upcoming.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name} · {formatEventDate(event.startsAt)}
                  </option>
                ))}
              </Select>
              {events === null && (
                <p className="text-[12px] text-muted-foreground">Loading events…</p>
              )}
              {events?.length === 0 && (
                <p className="text-[12px] text-muted-foreground">
                  No open events to volunteer for yet.
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-[13px] leading-relaxed text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={busy || (mode === 'signup' && !eventId)}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                {mode === 'signin' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : mode === 'signin' ? (
              'Sign in'
            ) : (
              'Request to volunteer'
            )}
          </Button>
        </form>

        <p className="mt-4 text-center text-[12px] text-muted-foreground">
          <Link
            to="/events"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Browse events as a guest
          </Link>
        </p>
      </div>
    </div>
  );
}

function StaffHome({
  user,
  onSignOut,
  onRefresh,
}: {
  user: SessionUser;
  onSignOut: () => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'attendees' ? 'attendees' : 'checkin';

  async function signOut() {
    try {
      await api.admin.logout();
    } finally {
      onSignOut();
      navigate('/');
    }
  }

  if (user.role === 'staff' && user.approvalStatus !== 'approved') {
    return (
      <StatusCard
        kind={user.approvalStatus === 'rejected' ? 'rejected' : 'pending'}
        user={user}
        onSignOut={() => void signOut()}
        onRefresh={onRefresh}
      />
    );
  }

  if (user.role === 'staff' && !user.staffEvent) {
    return (
      <StatusCard
        kind="unassigned"
        user={user}
        onSignOut={() => void signOut()}
        onRefresh={onRefresh}
      />
    );
  }

  function setTab(next: 'checkin' | 'attendees') {
    setParams(next === 'checkin' ? {} : { tab: next }, { replace: true });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: 'checkin' | 'attendees') {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = current === 'checkin' ? 'attendees' : 'checkin';
    setTab(next);
    document.getElementById(`staff-tab-${next}`)?.focus();
  }

  const tabs = [
    { id: 'checkin' as const, label: 'Check in', icon: QrCode },
    { id: 'attendees' as const, label: 'Attendees', icon: Users },
  ];
  const roleLabel =
    user.role === 'owner' ? 'Owner' : user.role === 'organizer' ? 'Organizer' : 'Staff';

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6 flex animate-rise flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Staff
          </p>
          <h1 className="mt-3 text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] sm:text-[34px]">
            Dashboard
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
            {user.name} · {roleLabel}
            {user.staffEvent ? ` · ${user.staffEvent.name}` : ' · all events'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.role !== 'staff' && (
            <Button variant="outline" asChild>
              <Link to="/dev/admin">
                <Ticket aria-hidden />
                Admin dashboard
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      {user.role === 'staff' && user.staffEvent && (
        <div className="mb-4 flex animate-rise-slow flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-[13px]">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          <span className="font-medium">{user.staffEvent.name}</span>
          <span className="text-muted-foreground">{formatEventDate(user.staffEvent.startsAt)}</span>
        </div>
      )}

      <div className="mb-6 overflow-x-auto pb-1">
        <div
          role="tablist"
          aria-label="Staff sections"
          className="inline-flex gap-1 rounded-lg border border-border bg-card p-1"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`staff-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`staff-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(event) => onTabKeyDown(event, id)}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 ${
                tab === id
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        key={tab}
        id={`staff-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`staff-tab-${tab}`}
        className="animate-rise"
      >
        {tab === 'checkin' ? (
          <Scanner />
        ) : (
          <AttendeeList
            lockedEventId={user.role === 'staff' ? user.staffEvent!.id : undefined}
            canDelete={user.role !== 'staff'}
          />
        )}
      </div>
    </div>
  );
}

function StatusCard({
  kind,
  user,
  onSignOut,
  onRefresh,
}: {
  kind: 'pending' | 'rejected' | 'unassigned';
  user: SessionUser;
  onSignOut: () => void;
  onRefresh: () => void;
}) {
  const copy = {
    pending: {
      icon: Clock3,
      title: 'Waiting for approval',
      body: user.staffEvent
        ? `Your request to volunteer for ${user.staffEvent.name} is with the team. You can check people in once it is approved.`
        : 'Your request is with the team. You can check people in once it is approved.',
    },
    rejected: {
      icon: XCircle,
      title: 'Request not approved',
      body: 'Ask an admin if you think this was a mistake.',
    },
    unassigned: {
      icon: CalendarX,
      title: 'No event assigned',
      body: 'The event you volunteered for is no longer available. Ask an admin for help.',
    },
  }[kind];
  const Icon = copy.icon;

  return (
    <div className="mx-auto w-full max-w-md animate-rise">
      <div className="rounded-xl border border-border bg-card p-6 text-center shadow-[0_1px_2px_oklch(0.235_0.012_268/0.04),0_10px_30px_-24px_oklch(0.235_0.012_268/0.35)]">
        <div
          className={
            kind === 'pending'
              ? 'mx-auto grid size-11 place-items-center rounded-full bg-warning/15 text-[oklch(0.5_0.11_72)]'
              : 'mx-auto grid size-11 place-items-center rounded-full bg-muted text-muted-foreground'
          }
        >
          <Icon className="size-5" aria-hidden />
        </div>
        <h1 className="mt-4 text-[21px] font-semibold tracking-[-0.01em]">{copy.title}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{copy.body}</p>
        <p className="mt-4 text-[12px] text-muted-foreground">
          Signed in as {user.name} · {user.email}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {kind === 'pending' && (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              Check again
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
