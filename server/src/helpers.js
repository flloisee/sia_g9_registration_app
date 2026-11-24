export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^[+()\d][\d\s()+-]{6,19}$/;

export const clean = (value, max) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

const pad = (value) => String(value).padStart(2, '0');

// MySQL DATETIME in server-local wall clock, matching how mysql2 reads it back.
export const mysqlDateTime = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

export const toIso = (value) => (value ? new Date(value).toISOString() : null);

export const toAttendee = (row) => ({
  id: row.id,
  code: row.code,
  fullName: row.full_name,
  email: row.email,
  organization: row.organization,
  phone: row.phone,
  eventId: row.event_id,
  eventName: row.event_name ?? null,
  checkedInAt: toIso(row.checked_in_at),
  createdAt: toIso(row.created_at),
});

export const toEvent = (row) => ({
  id: row.id,
  name: row.name,
  title: row.title,
  body: row.body,
  location: row.location,
  startsAt: toIso(row.starts_at),
  endsAt: toIso(row.ends_at),
  registrationClosesAt: toIso(row.registration_closes_at),
  status: row.status,
  createdBy: row.created_by,
  creatorName: row.creator_name ?? null,
  registered: Number(row.registered_count ?? 0),
  checkedIn: Number(row.checked_in_count ?? 0),
  createdAt: toIso(row.created_at),
});

export function rateLimit(max, windowMs) {
  // shortcut: per-process memory, resets on restart — swap for Redis if you run more than one instance.
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) hits.clear();
    const recent = (hits.get(req.ip) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };
}
