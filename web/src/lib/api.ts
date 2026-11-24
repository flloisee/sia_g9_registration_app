export type Attendee = {
  id: number;
  code: string;
  fullName: string;
  email: string;
  organization: string;
  phone: string;
  eventId: number;
  eventName: string | null;
  checkedInAt: string | null;
  createdAt: string;
};

export type RegisterInput = {
  fullName: string;
  email: string;
  organization: string;
  phone: string;
};

export type Ticket = RegisterInput & { code: string };

export type RegisterResult = {
  attendee: Ticket;
  eventName: string;
  qrUrl: string;
  emailSent: boolean;
  emailPreviewUrl: string | null;
};

export type CheckinResult = {
  status: 'checked-in' | 'already';
  attendee: Attendee;
};

export type EventInfo = {
  id: number;
  name: string;
  title: string;
  body: string;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  registrationClosesAt: string | null;
  status: 'open' | 'closed';
};

// The public list adds whether registration is currently open.
export type PublicEventInfo = EventInfo & { open: boolean };

// The admin list adds ownership and per-event registration totals.
export type AdminEvent = EventInfo & {
  createdBy: string | null;
  creatorName: string | null;
  createdAt: string;
  registered: number;
  checkedIn: number;
};

export type EventInput = {
  name: string;
  title: string;
  body: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  registrationClosesAt: string | null;
  status: 'open' | 'closed';
};

export type StaffEvent = { id: number; name: string; startsAt: string };

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'organizer' | 'staff';
  approvalStatus: 'pending' | 'approved' | 'rejected';
  staffEvent: StaffEvent | null;
};

export type AdminUser = SessionUser;

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'organizer';
  isActive: boolean;
  createdAt: string;
};

export type StaffRequest = {
  id: string;
  name: string;
  email: string;
  eventId: number | null;
  eventName: string | null;
  eventStartsAt: string | null;
  createdAt: string;
};

export type AttendeesResult = {
  events: { id: number; name: string; startsAt: string }[];
  attendees: Attendee[];
  stats: { total: number; checkedIn: number };
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const api = {
  events: () => request<{ events: PublicEventInfo[] }>('/api/events'),
  event: (id: number) => request<{ event: PublicEventInfo }>(`/api/events/${id}`),

  register: (eventId: number, input: RegisterInput) =>
    request<RegisterResult>('/api/register', json('POST', { ...input, eventId })),

  checkin: (code: string) => request<CheckinResult>('/api/checkin', json('POST', { code })),

  attendees: (eventId?: number) =>
    request<AttendeesResult>(`/api/attendees${eventId ? `?eventId=${eventId}` : ''}`),

  staff: {
    signup: (input: { name: string; email: string; password: string; eventId: number }) =>
      request<{ user: SessionUser }>('/api/staff/signup', json('POST', input)),
  },

  admin: {
    me: () => request<{ user: SessionUser | null }>('/api/admin/me'),
    login: (email: string, password: string) =>
      request<{ user: SessionUser }>('/api/admin/login', json('POST', { email, password })),
    logout: () => request<{ ok: true }>('/api/admin/logout', { method: 'POST' }),

    events: () => request<{ events: AdminEvent[] }>('/api/admin/events'),
    createEvent: (input: EventInput) =>
      request<{ event: AdminEvent }>('/api/admin/events', json('POST', input)),
    updateEvent: (id: number, input: EventInput) =>
      request<{ event: AdminEvent }>(`/api/admin/events/${id}`, json('PATCH', input)),
    deleteEvent: (id: number) =>
      request<{ ok: true }>(`/api/admin/events/${id}`, { method: 'DELETE' }),

    users: () => request<{ users: AdminUserRow[] }>('/api/admin/users'),
    createUser: (input: { name: string; email: string; password: string }) =>
      request<{ user: AdminUserRow }>('/api/admin/users', json('POST', input)),
    setUserActive: (id: string, isActive: boolean) =>
      request<{ ok: true }>(`/api/admin/users/${id}`, json('PATCH', { isActive })),

    staffRequests: () => request<{ requests: StaffRequest[] }>('/api/admin/staff-requests'),
    setStaffRequest: (id: string, status: 'approved' | 'rejected') =>
      request<{ ok: true }>(`/api/admin/staff-requests/${id}`, json('PATCH', { status })),
  },
};
