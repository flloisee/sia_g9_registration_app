export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^[+()\d][\d\s()+-]{6,19}$/;

export const clean = (value, max) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

// Secrets travel in URLs (ticket codes, email-change tokens); never write them to logs.
export const redactUrl = (value) =>
  String(value ?? '')
    .replace(/([?&]token=)[^&]+/gi, '$1<redacted>')
    .replace(/(\/api\/tickets\/)[^/?#]+/gi, '$1<code>')
    .slice(0, 300);

export const eventIsOpen = (row) => {
  const now = new Date();
  return (
    row.status === 'open' &&
    new Date(row.starts_at) > now &&
    (!row.registration_closes_at || new Date(row.registration_closes_at) > now)
  );
};

export const APP_ORIGIN = (process.env.APP_ORIGIN ?? '').trim().replace(/\/+$/, '');
if (APP_ORIGIN && !/^https?:\/\/[^/]+$/.test(APP_ORIGIN)) {
  throw new Error('APP_ORIGIN must be an origin such as https://events.example.com');
}

// Email links must never be built from the request Host header.
export function appOrigin(req) {
  if (APP_ORIGIN) return APP_ORIGIN;
  const host = req.get('host') ?? '';
  // Local development only; any real hostname must be configured explicitly.
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) {
    return `${req.protocol}://${host}`;
  }
  throw new Error('Set APP_ORIGIN so email links do not trust the Host header.');
}

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

export function rateLimit(max, windowMs, keyFn = (req) => req.ip) {
  // shortcut: per-process memory, resets on restart — swap for Redis if you run more than one instance.
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    const key = keyFn(req) || req.ip;
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
