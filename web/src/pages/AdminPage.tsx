import {
  CalendarDays,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Pencil,
  Plus,
  QrCode,
  Ticket,
  Trash2,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  api,
  ApiError,
  type AdminEvent,
  type AdminUser,
  type AdminUserRow,
  type EventInfo,
  type EventInput,
  type StaffRequest,
} from '@/lib/api';
import { formatDateTime, formatEventDate, toLocalInput } from '@/lib/format';

type TabId = 'overview' | 'events' | 'approvals' | 'organizers';
type EventFormState = { mode: 'new' } | { mode: 'edit'; event: AdminEvent } | null;

export function AdminPage() {
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);

  useEffect(() => {
    api.admin
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return <p className="py-24 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (user?.role === 'staff') return <Navigate to="/staff" replace />;
  if (!user) return <LoginCard onLogin={setUser} />;
  return <AdminPanel user={user} onSignOut={() => setUser(null)} />;
}

function LoginCard({ onLogin }: { onLogin: (user: AdminUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.admin.login(email.trim(), password);
      onLogin(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
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
        <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.01em]">Sign in</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          Manage events and organizers. Accounts are created by the owner.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-[13px] leading-relaxed text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

function AdminPanel({ user, onSignOut }: { user: AdminUser; onSignOut: () => void }) {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [requests, setRequests] = useState<StaffRequest[]>([]);
  const [eventForm, setEventForm] = useState<EventFormState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const requested = params.get('tab');
  const tab: TabId =
    requested === 'events' ||
    requested === 'approvals' ||
    (requested === 'organizers' && user.role === 'owner')
      ? requested
      : 'overview';

  const tabs: { id: TabId; label: string; icon: LucideIcon }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'events', label: 'Events', icon: CalendarDays },
    {
      id: 'approvals',
      label: requests.length ? `Approvals (${requests.length})` : 'Approvals',
      icon: UserCheck,
    },
    ...(user.role === 'owner'
      ? [{ id: 'organizers' as const, label: 'Organizers', icon: Users }]
      : []),
  ];

  async function refreshEvents() {
    try {
      const result = await api.admin.events();
      setEvents(result.events);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load events.');
    }
  }

  async function refreshUsers() {
    try {
      const result = await api.admin.users();
      setUsers(result.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load users.');
    }
  }

  async function refreshRequests() {
    try {
      const result = await api.admin.staffRequests();
      setRequests(result.requests);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load staff requests.');
    }
  }

  useEffect(() => {
    void refreshEvents();
    void refreshRequests();
    if (user.role === 'owner') void refreshUsers();
  }, [user.role]);

  function setTab(next: TabId) {
    setParams(next === 'overview' ? {} : { tab: next }, { replace: true });
    setNotice(null);
    setError(null);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: TabId) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = tabs.findIndex((item) => item.id === current);
    const step = event.key === 'ArrowRight' ? 1 : tabs.length - 1;
    const next = tabs[(index + step) % tabs.length].id;
    setTab(next);
    document.getElementById(`admin-tab-${next}`)?.focus();
  }

  function openNewEvent() {
    setEventForm({ mode: 'new' });
    setTab('events');
  }

  function editEvent(event: AdminEvent) {
    setEventForm({ mode: 'edit', event });
    setTab('events');
  }

  function handleSaved(event: AdminEvent) {
    setEventForm(null);
    setNotice(`Saved “${event.name}”.`);
    setError(null);
    void refreshEvents();
  }

  async function handleDelete(event: AdminEvent) {
    await api.admin.deleteEvent(event.id);
    setEventForm(null);
    setNotice(
      `Deleted “${event.name}”${
        event.registered
          ? ` and ${event.registered} registration${event.registered === 1 ? '' : 's'}`
          : ''
      }.`,
    );
    setError(null);
    await refreshEvents();
  }

  function handleStaffDecided(request: StaffRequest, status: 'approved' | 'rejected') {
    setNotice(`${status === 'approved' ? 'Approved' : 'Declined'} ${request.name}.`);
    setError(null);
    void refreshRequests();
  }

  async function signOut() {
    try {
      await api.admin.logout();
    } finally {
      onSignOut();
      navigate('/');
    }
  }

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
            {user.name} · {user.role === 'owner' ? 'Owner' : 'Organizer'}
          </p>
        </div>
        <Button variant="outline" onClick={signOut}>
          Sign out
        </Button>
      </header>

      <div className="mb-6 overflow-x-auto pb-1">
        <div
          role="tablist"
          aria-label="Admin sections"
          className="inline-flex gap-1 rounded-lg border border-border bg-card p-1"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`admin-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`admin-panel-${id}`}
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

      {notice && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-success/25 bg-success/5 px-4 py-2.5 text-[13px] text-success"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive"
        >
          {error}
        </p>
      )}

      <div
        key={tab}
        id={`admin-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`admin-tab-${tab}`}
        className="animate-rise"
      >
        {tab === 'overview' && (
          <OverviewTab events={events} onNewEvent={openNewEvent} onEditEvent={editEvent} />
        )}
        {tab === 'events' && (
          <EventsTab
            events={events}
            user={user}
            form={eventForm}
            setForm={setEventForm}
            onSaved={handleSaved}
            onDelete={handleDelete}
            onError={setError}
          />
        )}
        {tab === 'approvals' && (
          <ApprovalsTab
            requests={requests}
            onDecided={handleStaffDecided}
            onError={setError}
          />
        )}
        {tab === 'organizers' && user.role === 'owner' && (
          <OrganizersTab
            users={users}
            onCreated={(created) => {
              setNotice(`Added ${created.name} as an organizer.`);
              void refreshUsers();
            }}
            onToggled={() => void refreshUsers()}
            onError={setError}
          />
        )}
      </div>
    </div>
  );
}

function registrationOpen(event: EventInfo) {
  if (event.status !== 'open') return false;
  const now = Date.now();
  if (new Date(event.startsAt).getTime() <= now) return false;
  if (event.registrationClosesAt && new Date(event.registrationClosesAt).getTime() <= now) {
    return false;
  }
  return true;
}

function OverviewTab({
  events,
  onNewEvent,
  onEditEvent,
}: {
  events: AdminEvent[];
  onNewEvent: () => void;
  onEditEvent: (event: AdminEvent) => void;
}) {
  const now = Date.now();
  const openEvents = events
    .filter(registrationOpen)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const upcoming = events
    .filter((event) => new Date(event.startsAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 5);
  const registered = events.reduce((sum, event) => sum + event.registered, 0);
  const checkedIn = events.reduce((sum, event) => sum + event.checkedIn, 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Events" value={events.length} hint={`${upcoming.length} upcoming`} />
        <StatCard label="Registrations" value={registered} hint="across all events" />
        <StatCard
          label="Checked in"
          value={checkedIn}
          hint={registered ? `${Math.round((checkedIn / registered) * 100)}% of registrations` : 'nobody yet'}
        />
        <StatCard label="Open now" value={openEvents.length} hint="on the public form" />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Open for registration</CardTitle>
              <CardDescription>
                {openEvents.length === 0
                  ? 'No event is open for registration right now.'
                  : `${openEvents.length} open event${
                      openEvents.length === 1 ? '' : 's'
                    } on the guest page.`}
              </CardDescription>
            </div>
            {openEvents.length > 0 && <Badge variant="success">Open</Badge>}
          </div>
        </CardHeader>
        <CardContent>
          {openEvents.length > 0 ? (
            <ul className="divide-y divide-border/70">
              {openEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-medium">{event.name}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                      {formatEventDate(event.startsAt)}
                      {event.location ? ` · ${event.location}` : ''} · {event.registered}{' '}
                      registered
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/events/${event.id}`}>
                        <ExternalLink aria-hidden />
                        View page
                      </Link>
                    </Button>
                    <Button size="sm" onClick={() => onEditEvent(event)}>
                      <Pencil aria-hidden />
                      Edit
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-muted-foreground">
                No event is open for registration right now.
              </p>
              <Button size="sm" onClick={onNewEvent}>
                <Plus aria-hidden />
                New event
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Upcoming events</CardTitle>
            <CardDescription>The next few on the calendar.</CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                Nothing scheduled yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {upcoming.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{event.name}</p>
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                        {formatEventDate(event.startsAt)}
                        {event.location ? ` · ${event.location}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[12px] text-muted-foreground tabular-nums">
                        {event.registered} reg.
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => onEditEvent(event)}>
                        Edit
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>The tools used on the day.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button variant="outline" className="justify-start" onClick={onNewEvent}>
              <Plus aria-hidden />
              Create an event
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <Link to="/staff?tab=attendees">
                <Ticket aria-hidden />
                Attendee list
              </Link>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <Link to="/staff?tab=checkin">
                <QrCode aria-hidden />
                Check-in scanner
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <p className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1.5 text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function EventsTab({
  events,
  user,
  form,
  setForm,
  onSaved,
  onDelete,
  onError,
}: {
  events: AdminEvent[];
  user: AdminUser;
  form: EventFormState;
  setForm: (form: EventFormState) => void;
  onSaved: (event: AdminEvent) => void;
  onDelete: (event: AdminEvent) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const liveId =
    [...events]
      .filter(registrationOpen)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0]?.id ??
    null;

  async function remove(event: AdminEvent) {
    setDeletingId(event.id);
    try {
      await onDelete(event);
      setConfirmId(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not delete the event.');
    } finally {
      setDeletingId(null);
    }
  }

  if (form) {
    return (
      <EventForm
        key={form.mode === 'edit' ? form.event.id : 'new'}
        initial={form.mode === 'edit' ? form.event : null}
        onCancel={() => setForm(null)}
        onSaved={onSaved}
        onError={onError}
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Events</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {user.role === 'owner'
              ? 'Every event and who created it.'
              : 'The events you created.'}{' '}
            Guests can register for any open event.
          </p>
        </div>
        <Button onClick={() => setForm({ mode: 'new' })}>
          <Plus aria-hidden />
          New event
        </Button>
      </div>

      {events.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
          <p className="text-[14px] font-medium">No events yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Create the first one to open registration.
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card">
          {events.map((event) => (
            <li key={event.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[14.5px] font-medium">{event.name}</p>
                    {liveId === event.id ? (
                      <Badge variant="success">Live</Badge>
                    ) : (
                      <Badge variant={registrationOpen(event) ? 'secondary' : 'outline'}>
                        {registrationOpen(event) ? 'Open' : 'Closed'}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    {formatEventDate(event.startsAt)}
                    {event.location ? ` · ${event.location}` : ''}
                  </p>
                  <p className="mt-1 text-[12.5px] text-muted-foreground tabular-nums">
                    {event.registered} registered · {event.checkedIn} checked in
                    {user.role === 'owner' && event.creatorName
                      ? ` · by ${event.creatorName}`
                      : ''}
                  </p>
                </div>

                {confirmId === event.id ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <p className="text-[12.5px] text-destructive">
                      Delete{' '}
                      {event.registered
                        ? `and its ${event.registered} registration${
                            event.registered === 1 ? '' : 's'
                          }?`
                        : 'this event?'}
                    </p>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void remove(event)}
                      disabled={deletingId === event.id}
                    >
                      {deletingId === event.id ? 'Deleting…' : 'Delete'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setForm({ mode: 'edit', event })}
                    >
                      <Pencil aria-hidden />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmId(event.id)}
                    >
                      <Trash2 aria-hidden />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type EventValues = {
  name: string;
  title: string;
  body: string;
  location: string;
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string;
  status: 'open' | 'closed';
};

function defaultStart() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(9, 0, 0, 0);
  return toLocalInput(date.toISOString());
}

function EventForm({
  initial,
  onSaved,
  onCancel,
  onError,
}: {
  initial: AdminEvent | null;
  onSaved: (event: AdminEvent) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [values, setValues] = useState<EventValues>(() => ({
    name: initial?.name ?? '',
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    location: initial?.location ?? '',
    startsAt: initial ? toLocalInput(initial.startsAt) : defaultStart(),
    endsAt: toLocalInput(initial?.endsAt ?? null),
    registrationClosesAt: toLocalInput(initial?.registrationClosesAt ?? null),
    status: initial?.status ?? 'open',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof EventValues, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload: EventInput = {
      name: values.name.trim(),
      title: values.title.trim(),
      body: values.body.trim(),
      location: values.location.trim(),
      startsAt: values.startsAt,
      endsAt: values.endsAt || null,
      registrationClosesAt: values.registrationClosesAt || null,
      status: values.status,
    };

    try {
      const { event: saved } = initial
        ? await api.admin.updateEvent(initial.id, payload)
        : await api.admin.createEvent(payload);
      onSaved(saved);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save the event.';
      setError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>{initial ? 'Edit event' : 'New event'}</CardTitle>
        <CardDescription>
          {initial
            ? 'Update the details or close registration.'
            : 'Open events are listed on the guest page.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="event-name">Event name</Label>
            <Input
              id="event-name"
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="SIA G9 Summit"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="event-title">Public title</Label>
            <Input
              id="event-title"
              value={values.title}
              onChange={(event) => update('title', event.target.value)}
              placeholder="Reserve your seat."
              required
            />
          </div>

          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="event-body">Description</Label>
            <Textarea
              id="event-body"
              value={values.body}
              onChange={(event) => update('body', event.target.value)}
              placeholder="A short paragraph shown above the form."
            />
          </div>

          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="event-location">Location (optional)</Label>
            <Input
              id="event-location"
              value={values.location}
              onChange={(event) => update('location', event.target.value)}
              placeholder="Auditorium, Level 3"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="event-starts">Starts</Label>
            <Input
              id="event-starts"
              type="datetime-local"
              value={values.startsAt}
              onChange={(event) => update('startsAt', event.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="event-ends">Ends (optional)</Label>
            <Input
              id="event-ends"
              type="datetime-local"
              value={values.endsAt}
              onChange={(event) => update('endsAt', event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="event-closes">Registration closes (optional)</Label>
            <Input
              id="event-closes"
              type="datetime-local"
              value={values.registrationClosesAt}
              onChange={(event) => update('registrationClosesAt', event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="event-status">Registration</Label>
            <Select
              id="event-status"
              value={values.status}
              onChange={(event) => update('status', event.target.value)}
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </Select>
          </div>

          {error && (
            <p role="alert" className="text-[13px] leading-relaxed text-destructive sm:col-span-2">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Saving…
                </>
              ) : initial ? (
                'Save changes'
              ) : (
                <>
                  <Plus aria-hidden />
                  Create event
                </>
              )}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ApprovalsTab({
  requests,
  onDecided,
  onError,
}: {
  requests: StaffRequest[];
  onDecided: (request: StaffRequest, status: 'approved' | 'rejected') => void;
  onError: (message: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(request: StaffRequest, status: 'approved' | 'rejected') {
    setBusyId(request.id);
    try {
      await api.admin.setStaffRequest(request.id, status);
      onDecided(request, status);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not update the request.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Staff approvals</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          People who signed up to volunteer. Approving lets them check in attendees for their chosen
          event.
        </p>
      </div>

      {requests.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
          <p className="text-[14px] font-medium">No pending requests</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            New volunteer sign-ups will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card">
          {requests.map((request) => (
            <li key={request.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium">{request.name}</p>
                  <p className="truncate text-[12.5px] text-muted-foreground">{request.email}</p>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    {request.eventName
                      ? `${request.eventName}${
                          request.eventStartsAt
                            ? ` · ${formatEventDate(request.eventStartsAt)}`
                            : ''
                        }`
                      : 'Event removed'}
                    {' · requested '}
                    {formatDateTime(request.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    onClick={() => void decide(request, 'approved')}
                    disabled={busyId === request.id || !request.eventName}
                  >
                    {busyId === request.id ? 'Saving…' : 'Approve'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void decide(request, 'rejected')}
                    disabled={busyId === request.id}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function OrganizersTab({
  users,
  onCreated,
  onToggled,
  onError,
}: {
  users: AdminUserRow[];
  onCreated: (user: AdminUserRow) => void;
  onToggled: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addOrganizer(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.admin.createUser({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      setName('');
      setEmail('');
      setPassword('');
      onCreated(user);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not add the organizer.';
      setError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(user: AdminUserRow) {
    setError(null);
    try {
      await api.admin.setUserActive(user.id, !user.isActive);
      onToggled();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not update the account.';
      setError(message);
      onError(message);
    }
  }

  return (
    <>
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Organizers</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Organizers sign in here and manage their own events. The owner account is managed from{' '}
          <span className="font-mono text-[12px]">.env</span> by the migration script.
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>The owner and every organizer.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/70">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{user.name}</p>
                    <p className="truncate text-[12.5px] text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {user.role === 'owner' ? (
                      <Badge>Owner</Badge>
                    ) : (
                      <>
                        <Badge variant={user.isActive ? 'secondary' : 'outline'}>
                          {user.isActive ? 'Active' : 'Disabled'}
                        </Badge>
                        <Button size="sm" variant="ghost" onClick={() => void toggle(user)}>
                          {user.isActive ? 'Disable' : 'Enable'}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
              {users.length === 0 && (
                <li className="py-3 text-[13px] text-muted-foreground">No accounts yet.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Add organizer</CardTitle>
            <CardDescription>They can create and manage their own events.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addOrganizer} className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="user-name">Name</Label>
                <Input
                  id="user-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="user-email">Email</Label>
                <Input
                  id="user-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="user-password">Temporary password</Label>
                <Input
                  id="user-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <p className="text-[12px] text-muted-foreground">At least 8 characters.</p>
              </div>
              {error && (
                <p role="alert" className="text-[13px] leading-relaxed text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" variant="outline" disabled={busy}>
                {busy ? 'Adding…' : 'Add organizer'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
