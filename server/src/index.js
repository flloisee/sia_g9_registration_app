import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { adminRouter } from './admin.js';
import { canAccessEvent, requireApproved, requireUser, visibleEventIds } from './auth.js';
import { pool } from './db.js';
import {
  APP_ORIGIN,
  clean,
  EMAIL_RE,
  eventIsOpen,
  PHONE_RE,
  rateLimit,
  redactUrl,
  toAttendee,
  toEvent,
  toIso,
} from './helpers.js';
import { log } from './logger.js';
import { sendTicketEmail } from './mail.js';
import { staffRouter } from './staff.js';
import { CODE_RE, newCode, normalizeCode } from './tickets.js';

const PORT = Number(process.env.PORT ?? 4000);
const TRUST_PROXY = (process.env.TRUST_PROXY ?? '').trim();

const app = express();
app.disable('x-powered-by');
// A hop count (e.g. 1) or a comma-separated subnet list. Off by default.
app.set(
  'trust proxy',
  TRUST_PROXY === '' ? false : /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY,
);
if (process.env.NODE_ENV === 'production' && !TRUST_PROXY) {
  console.warn('[config] TRUST_PROXY is not set; rate limits will see the proxy IP for every client.');
}

app.use((_req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  next();
});

app.use(express.json({ limit: '16kb' }));

// Cookies are SameSite=Lax and bodies are JSON-only, but check Origin explicitly.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  let allowed = false;
  try {
    const url = new URL(origin);
    allowed = url.host === req.get('host') || (APP_ORIGIN !== '' && url.origin === APP_ORIGIN);
  } catch {
    allowed = false;
  }
  if (!allowed) return res.status(403).json({ error: 'Cross-origin request blocked.' });
  next();
});

// One line per request: every API call and every static/page request.
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const agent = (req.get('user-agent') ?? '-').slice(0, 300);
    log.info(
      'Netty Server IO #1',
      `${req.method} ${redactUrl(req.originalUrl)} -> ${res.statusCode} (${Date.now() - startedAt}ms) ip=${req.ip} user=${req.user?.id ?? '-'} agent="${agent}"`,
    );
  });
  next();
});

// Staff and admin pages are unlisted; keep them out of search engines.
app.use(['/dev', '/staff'], (_req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

function validateRegistration(body) {
  const value = {
    fullName: clean(body?.fullName, 120),
    email: clean(body?.email, 190).toLowerCase(),
    organization: clean(body?.organization, 160),
    phone: clean(body?.phone, 40),
  };
  if (value.fullName.length < 2) return { error: 'Enter your full name.' };
  if (!EMAIL_RE.test(value.email)) return { error: 'Enter a valid email address.' };
  if (value.organization.length < 2) return { error: 'Enter your organization.' };
  if (!PHONE_RE.test(value.phone)) return { error: 'Enter a valid contact number.' };
  return { value };
}

function closedReason(row) {
  const now = new Date();
  if (new Date(row.starts_at) <= now) return 'This event has already started.';
  if (row.status !== 'open') return 'The organizer has closed registration.';
  if (row.registration_closes_at && new Date(row.registration_closes_at) <= now) {
    return 'Registration for this event has closed.';
  }
  return 'Registration is not open right now.';
}

const toPublicEvent = (row) => {
  const event = toEvent(row);
  return {
    id: event.id,
    name: event.name,
    title: event.title,
    body: event.body,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    registrationClosesAt: event.registrationClosesAt,
    status: event.status,
    open: eventIsOpen(row),
  };
};

const qrPng = (code) =>
  QRCode.toBuffer(code, {
    type: 'png',
    width: 480,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#1c1c22', light: '#ffffff' },
  });

async function insertAttendee(eventId, values) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      const [result] = await pool.execute(
        'INSERT INTO attendees (event_id, code, full_name, email, organization, phone) VALUES (?, ?, ?, ?, ?, ?)',
        [eventId, code, values.fullName, values.email, values.organization, values.phone],
      );
      return { id: result.insertId, code };
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      if (err.message.includes('uq_event_email')) {
        throw Object.assign(new Error('That email is already registered for this event.'), {
          status: 409,
        });
      }
      // Otherwise it was a code collision: draw a new one.
    }
  }
  throw new Error('Could not allocate a ticket code.');
}

const qrLimiter = rateLimit(60, 60_000);
const registrationEmailLimiter = rateLimit(3, 10 * 60_000, (req) =>
  clean(req.body?.email, 190).toLowerCase(),
);
const checkinLimiter = rateLimit(30, 60_000, (req) => req.user?.id);
const attendeeLimiter = rateLimit(30, 60_000, (req) => req.user?.id);

// Do not advertise which methods each API route accepts.
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') return res.status(404).end();
  next();
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// Client-side navigations never reach the server, so the SPA reports them here.
app.post('/api/telemetry/pageview', rateLimit(300, 60_000), (req, res) => {
  const route = redactUrl(clean(req.body?.path, 300)) || '/';
  const referrer = redactUrl(clean(req.body?.referrer, 300));
  log.info(
    'Netty Server IO #1',
    `Pageview ${route}${referrer ? ` <- ${referrer}` : ''} ip=${req.ip}`,
  );
  res.status(204).end();
});

app.get('/api/events', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const [rows] = await pool.query('SELECT * FROM events');
  const now = Date.now();
  rows.sort((a, b) => {
    const aTime = new Date(a.starts_at).getTime();
    const bTime = new Date(b.starts_at).getTime();
    const aPast = aTime <= now;
    const bPast = bTime <= now;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return aPast ? bTime - aTime : aTime - bTime;
  });
  res.json({ events: rows.map(toPublicEvent) });
});

app.get('/api/events/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid event.' });
  const [rows] = await pool.execute('SELECT * FROM events WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Event not found.' });
  res.json({ event: toPublicEvent(rows[0]) });
});

app.post(
  '/api/register',
  rateLimit(10, 10 * 60_000),
  registrationEmailLimiter,
  async (req, res) => {
    const parsed = validateRegistration(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const eventId = Number(req.body?.eventId);
    if (!Number.isInteger(eventId)) {
      return res.status(400).json({ error: 'Choose an event to register for.' });
    }
    const [rows] = await pool.execute('SELECT * FROM events WHERE id = ?', [eventId]);
    const event = rows[0];
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    if (!eventIsOpen(event)) return res.status(403).json({ error: closedReason(event) });

    let attendee;
    let created = false;
    try {
      const inserted = await insertAttendee(event.id, parsed.value);
      attendee = { id: inserted.id, ...parsed.value, code: inserted.code };
      created = true;
    } catch (err) {
      if (err.status !== 409) throw err;
      // The address is already registered. Re-send the existing ticket to that address
      // and never reveal the code to whoever submitted the form.
      const [existing] = await pool.execute(
        `SELECT a.*, e.name AS event_name
           FROM attendees a JOIN events e ON e.id = a.event_id
          WHERE a.event_id = ? AND a.email = ?`,
        [event.id, parsed.value.email],
      );
      if (!existing.length) throw err;
      attendee = toAttendee(existing[0]);
    }

    try {
      const email = await sendTicketEmail({
        ...attendee,
        eventName: event.name,
        qrPng: await qrPng(attendee.code),
      });
      res.status(201).json({
        email: parsed.value.email,
        eventName: event.name,
        emailPreviewUrl: email.previewUrl,
      });
    } catch (err) {
      console.error('[mail]', err.message);
      if (created) {
        await pool.execute('DELETE FROM attendees WHERE id = ?', [attendee.id]).catch(() => {});
      }
      res.status(502).json({ error: 'Could not send your ticket email. Please try again.' });
    }
  },
);

app.get('/api/tickets/:code/qr.png', qrLimiter, async (req, res) => {
  const code = normalizeCode(req.params.code);
  // Same response for malformed and unknown codes so this is not a validity oracle.
  if (!CODE_RE.test(code)) return res.status(404).end();
  const [rows] = await pool.execute('SELECT id FROM attendees WHERE code = ?', [code]);
  if (!rows.length) return res.status(404).end();
  res.type('png').set('Cache-Control', 'public, max-age=3600').send(await qrPng(code));
});

app.post('/api/checkin', requireUser, requireApproved, checkinLimiter, async (req, res) => {
  const code = normalizeCode(req.body?.code);
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ error: 'That does not look like a ticket code.' });
  }

  const [rows] = await pool.execute(
    `SELECT a.*, e.name AS event_name
       FROM attendees a JOIN events e ON e.id = a.event_id
      WHERE a.code = ?`,
    [code],
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'No ticket found for that code.' });
  }

  const row = rows[0];
  if (req.user.role === 'staff' && !req.user.staffEvent) {
    return res.status(403).json({ error: 'No event is assigned to your account.' });
  }
  if (!(await canAccessEvent(req.user, row.event_id))) {
    return res.status(404).json({ error: 'No ticket found for that code.' });
  }

  const attendee = toAttendee(row);
  // The guarded UPDATE is the decision point; affectedRows tells us who won the race.
  const [result] = await pool.execute(
    'UPDATE attendees SET checked_in_at = NOW() WHERE code = ? AND checked_in_at IS NULL',
    [code],
  );
  const [after] = await pool.execute(
    'SELECT checked_in_at FROM attendees WHERE code = ?',
    [code],
  );

  res.json({
    status: result.affectedRows === 1 ? 'checked-in' : 'already',
    attendee: { ...attendee, checkedInAt: toIso(after[0].checked_in_at) },
  });
});

app.get('/api/attendees', requireUser, requireApproved, attendeeLimiter, async (req, res) => {
  if (req.user.role === 'staff' && !req.user.staffEvent) {
    return res.status(403).json({ error: 'No event is assigned to your account.' });
  }

  const requested = Number(req.query.eventId) || null;
  const allowed = await visibleEventIds(req.user);
  if (requested !== null && allowed !== null && !allowed.includes(requested)) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  const scope = requested !== null ? [requested] : allowed;
  if (scope !== null && scope.length === 0) {
    return res.json({ events: [], attendees: [], stats: { total: 0, checkedIn: 0 } });
  }

  const placeholders = scope === null ? '' : scope.map(() => '?').join(',');
  const [events] =
    scope === null
      ? await pool.query('SELECT id, name, starts_at FROM events ORDER BY starts_at DESC')
      : await pool.execute(
          `SELECT id, name, starts_at FROM events WHERE id IN (${placeholders}) ORDER BY starts_at DESC`,
          scope,
        );
  const [rows] = await pool.execute(
    `SELECT a.*, e.name AS event_name
       FROM attendees a JOIN events e ON e.id = a.event_id
      ${scope === null ? '' : `WHERE a.event_id IN (${placeholders})`}
      ORDER BY a.created_at DESC
      LIMIT 1000`,
    scope ?? [],
  );
  const [[stats]] = await pool.execute(
    `SELECT COUNT(*) AS total, COALESCE(SUM(checked_in_at IS NOT NULL), 0) AS checkedIn
       FROM attendees ${scope === null ? '' : `WHERE event_id IN (${placeholders})`}`,
    scope ?? [],
  );

  res.json({
    events: events.map((event) => ({
      id: event.id,
      name: event.name,
      startsAt: toIso(event.starts_at),
    })),
    attendees: rows.map(toAttendee),
    stats: { total: Number(stats.total), checkedIn: Number(stats.checkedIn) },
  });
});

app.use('/api/admin', adminRouter);
app.use('/api/staff', staffRouter);

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err, req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  console.error(err);
  log.error(
    'Server thread',
    `${req.method} ${redactUrl(req.originalUrl)} failed: ${err.message}`,
  );
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.listen(PORT, async () => {
  console.log(`API listening on http://localhost:${PORT}`);
  if (!APP_ORIGIN) {
    console.warn('[config] APP_ORIGIN is not set; email links only work for localhost hosts.');
  }
  log.info('Server thread', `Done! API listening on http://localhost:${PORT}`);
  try {
    await pool.query('SELECT 1');
  } catch {
    console.warn('[config] MySQL is not reachable. Run "npm run db:migrate" and check .env.');
    log.warn('Server thread', 'MySQL is unreachable. Run "npm run db:migrate" and check .env.');
  }
});
