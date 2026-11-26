import {
  CalendarDays,
  ExternalLink,
  HeartHandshake,
  LayoutDashboard,
  Loader2,
  Pencil,
  Plus,
  QrCode,
  Search,
  Ticket,
  Trash2,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
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
  type AdminVolunteerRow,
  type EventInfo,
  type EventInput,
  type StaffRequest,
} from '@/lib/api';
import { formatDateTime, formatEventDate, toLocalInput } from '@/lib/format';

type TabId = 'overview' | 'events' | 'volunteers' | 'approvals' | 'organizers';
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
  const [volunteers, setVolunteers] = useState<AdminVolunteerRow[]>([]);
  const [eventForm, setEventForm] = useState<EventFormState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const requested = params.get('tab');
  const tab: TabId =
    requested === 'events' ||
    requested === 'volunteers' ||
    requested === 'approvals' ||
    (requested === 'organizers' && user.role === 'owner')
      ? requested
      : 'overview';

  const tabs: { id: TabId; label: string; icon: LucideIcon }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'events', label: 'Events', icon: CalendarDays },
    { id: 'volunteers', label: 'Volunteers', icon: HeartHandshake },
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

  async function refreshVolunteers() {
    try {
      const result = await api.admin.volunteers();
      setVolunteers(result.volunteers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load volunteers.');
    }
  }

  useEffect(() => {
    void refreshEvents();
    void refreshRequests();
    void refreshVolunteers();
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
    void refreshVolunteers();
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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/staff">
              <QrCode aria-hidden />
              Staff dashboard
            </Link>
          </Button>
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </div>
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
        {tab === 'volunteers' && (
          <VolunteersTab
            volunteers={volunteers}
            events={events}
            onChanged={() => void refreshVolunteers()}
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
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');
  const [sort, setSort] = useState<'date' | 'name' | 'registered'>('date');

  const liveId =
    [...events]
      .filter(registrationOpen)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0]?.id ??
    null;

  const search = query.trim().toLowerCase();
  const filtered = events
    .filter((event) => {
      if (status !== 'all' && (registrationOpen(event) ? 'open' : 'closed') !== status) {
        return false;
      }
      if (!search) return true;
      return [event.name, event.title, event.location ?? '', event.creatorName ?? ''].some((value) =>
        value.toLowerCase().includes(search),
      );
    })
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'registered') return b.registered - a.registered;
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    });

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
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem_12rem]">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, title or location"
                aria-label="Search events"
                className="pl-10"
              />
            </div>
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              aria-label="Filter events by status"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </Select>
            <Select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              aria-label="Sort events"
            >
              <option value="date">Sort: event date</option>
              <option value="name">Sort: name</option>
              <option value="registered">Sort: most registered</option>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
              <p className="text-[14px] font-medium">No matching events</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Try a different search or status.
              </p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card">
              {filtered.map((event) => (
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

type VolunteerSort = 'date' | 'name' | 'count';

function VolunteersTab({
  volunteers,
  events,
  onChanged,
  onError,
}: {
  volunteers: AdminVolunteerRow[];
  events: AdminEvent[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<VolunteerSort>('date');
  const [editing, setEditing] = useState<AdminVolunteerRow | null>(null);
  const [deleting, setDeleting] = useState<AdminVolunteerRow | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const search = query.trim().toLowerCase();
  const filtered = volunteers.filter(
    (volunteer) =>
      !search ||
      [
        volunteer.name,
        volunteer.email,
        volunteer.pendingEmail ?? '',
        volunteer.eventName ?? '',
        volunteer.approvalStatus,
      ].some((value) => value.toLowerCase().includes(search)),
  );

  const groups = new Map<number | null, AdminVolunteerRow[]>();
  for (const volunteer of filtered) {
    const members = groups.get(volunteer.eventId) ?? [];
    members.push(volunteer);
    groups.set(volunteer.eventId, members);
  }

  const sections = [...groups.entries()]
    .map(([eventId, members]) => ({
      eventId,
      eventName: members[0].eventName,
      eventStartsAt: members[0].eventStartsAt,
      members: [...members].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      if (sort === 'count') return b.members.length - a.members.length;
      if (sort === 'name') return (a.eventName ?? '\uffff').localeCompare(b.eventName ?? '\uffff');
      if (!a.eventStartsAt) return 1;
      if (!b.eventStartsAt) return -1;
      return a.eventStartsAt.localeCompare(b.eventStartsAt);
    });

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.admin.deleteVolunteer(deleting.id);
      setNotice(`Deleted ${deleting.name}.`);
      setPreviewUrl(null);
      setDeleting(null);
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not delete the volunteer.');
    } finally {
      setDeletingBusy(false);
    }
  }

  function handleSaved(volunteer: AdminVolunteerRow, emailSent: boolean, preview: string | null) {
    setEditing(null);
    setNotice(
      emailSent
        ? `Saved ${volunteer.name}. Verification email sent to ${volunteer.pendingEmail}.`
        : `Saved ${volunteer.name}.`,
    );
    setPreviewUrl(preview);
    onChanged();
  }

  return (
    <>
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Volunteers</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Everyone who signed up to volunteer, grouped by the event they are assigned to.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_15rem]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email or event"
            aria-label="Search volunteers"
            className="pl-10"
          />
        </div>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as VolunteerSort)}
          aria-label="Sort volunteers"
        >
          <option value="date">Sort: event date</option>
          <option value="name">Sort: event name</option>
          <option value="count">Sort: most volunteers</option>
        </Select>
      </div>

      {notice && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-success/25 bg-success/5 px-4 py-2.5 text-[13px] text-success"
        >
          {notice}
        </p>
      )}
      {previewUrl && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Dev inbox:{' '}
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline underline-offset-2"
          >
            open the verification email
          </a>
        </p>
      )}

      {sections.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
          <p className="text-[14px] font-medium">
            {search ? 'No matching volunteers' : 'No volunteers yet'}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {search
              ? 'Try a different name, email or event.'
              : 'Staff sign-ups appear here once they choose an event.'}
          </p>
        </div>
      ) : (
        sections.map((section) => (
          <Card key={section.eventId ?? 'unassigned'} className="mt-4">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>{section.eventName ?? 'No event assigned'}</CardTitle>
                  <CardDescription>
                    {section.eventStartsAt
                      ? formatEventDate(section.eventStartsAt)
                      : 'The event is no longer available.'}
                  </CardDescription>
                </div>
                <Badge variant="secondary">
                  {section.members.length} volunteer{section.members.length === 1 ? '' : 's'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border/70">
                {section.members.map((volunteer) => (
                  <li
                    key={volunteer.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{volunteer.name}</p>
                      <p className="truncate text-[12.5px] text-muted-foreground">
                        {volunteer.email}
                      </p>
                      {volunteer.pendingEmail && (
                        <p className="truncate text-[12px] text-warning">
                          Pending: {volunteer.pendingEmail}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <span className="mr-1 text-[12px] text-muted-foreground tabular-nums">
                        Signed up {formatDateTime(volunteer.createdAt)}
                      </span>
                      {!volunteer.isActive && <Badge variant="outline">Disabled</Badge>}
                      <VolunteerStatus status={volunteer.approvalStatus} />
                      <Button size="sm" variant="ghost" onClick={() => setEditing(volunteer)}>
                        <Pencil aria-hidden />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleting(volunteer)}
                      >
                        <Trash2 aria-hidden />
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}

      {editing && (
        <EditVolunteerModal
          volunteer={editing}
          events={events}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
          onError={onError}
        />
      )}

      {deleting && (
        <Modal
          title="Delete volunteer?"
          onClose={() => {
            if (!deletingBusy) setDeleting(null);
          }}
        >
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            This permanently removes{' '}
            <span className="font-medium text-foreground">{deleting.name}</span> and revokes their
            staff access. This cannot be undone.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deletingBusy}>
              {deletingBusy ? 'Deleting…' : 'Delete volunteer'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function EditVolunteerModal({
  volunteer,
  events,
  onClose,
  onSaved,
  onError,
}: {
  volunteer: AdminVolunteerRow;
  events: AdminEvent[];
  onClose: () => void;
  onSaved: (volunteer: AdminVolunteerRow, emailSent: boolean, previewUrl: string | null) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(volunteer.name);
  const [email, setEmail] = useState(volunteer.email);
  const [eventId, setEventId] = useState(volunteer.eventId ? String(volunteer.eventId) : '');
  const [busy, setBusy] = useState(false);

  const emailChanged = email.trim().toLowerCase() !== volunteer.email.toLowerCase();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!eventId) return;
    setBusy(true);
    try {
      const result = await api.admin.updateVolunteer(volunteer.id, {
        name: name.trim(),
        email: email.trim(),
        eventId: Number(eventId),
      });
      onSaved(result.volunteer, result.emailSent, result.emailPreviewUrl);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save the volunteer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit volunteer" onClose={() => (busy ? undefined : onClose())}>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="volunteer-name">Full name</Label>
          <Input
            id="volunteer-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            required
            autoFocus
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="volunteer-email">Email address</Label>
          <Input
            id="volunteer-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            required
          />
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {emailChanged
              ? 'A verification link goes to the new address; the change applies once it is confirmed.'
              : 'Changing this sends a verification link to the new address.'}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="volunteer-event">Volunteering for</Label>
          <Select
            id="volunteer-event"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            required
          >
            <option value="" disabled>
              Choose an event
            </option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name} · {formatEventDate(event.startsAt)}
              </option>
            ))}
          </Select>
          {events.length === 0 && (
            <p className="text-[12px] text-muted-foreground">Create an event first.</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !eventId}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-foreground/35 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_oklch(0.235_0.012_268/0.04),0_20px_60px_-30px_oklch(0.235_0.012_268/0.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="admin-modal-title" className="text-[18px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function VolunteerStatus({ status }: { status: AdminVolunteerRow['approvalStatus'] }) {
  if (status === 'approved') return <Badge variant="success">Approved</Badge>;
  if (status === 'rejected') return <Badge variant="destructive">Declined</Badge>;
  return <Badge variant="warning">Pending</Badge>;
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
                  minLength={12}
                  required
                />
                <p className="text-[12px] text-muted-foreground">At least 12 characters.</p>
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
