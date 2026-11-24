import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { adminRouter } from './admin.js';
import { requireApproved, requireUser } from './auth.js';
import { pool } from './db.js';
import {
  clean,
  EMAIL_RE,
  PHONE_RE,
  rateLimit,
  toAttendee,
  toEvent,
  toIso,
} from './helpers.js';
import { sendTicketEmail } from './mail.js';
import { staffRouter } from './staff.js';
import { CODE_RE, newCode, normalizeCode } from './tickets.js';

const PORT = Number(process.env.PORT ?? 4000);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use(express.json({ limit: '16kb' }));

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

function eventIsOpen(row) {
  const now = new Date();
  return (
    row.status === 'open' &&
    new Date(row.starts_at) > now &&
    (!row.registration_closes_at || new Date(row.registration_closes_at) > now)
  );
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

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
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

app.post('/api/register', rateLimit(10, 10 * 60_000), async (req, res) => {
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

  let created;
  try {
    created = await insertAttendee(event.id, parsed.value);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const attendee = { ...parsed.value, code: created.code };
  let email = { previewUrl: null };
  let emailSent = true;
  try {
    email = await sendTicketEmail({
      ...attendee,
      eventName: event.name,
      qrPng: await qrPng(attendee.code),
    });
  } catch (err) {
    emailSent = false;
    console.error('[mail]', err.message);
  }

  res.status(201).json({
    attendee,
    eventName: event.name,
    qrUrl: `/api/tickets/${attendee.code}/qr.png`,
    emailSent,
    emailPreviewUrl: email.previewUrl,
  });
});

app.get('/api/tickets/:code/qr.png', async (req, res) => {
  const code = normalizeCode(req.params.code);
  if (!CODE_RE.test(code)) return res.status(400).end();
  const [rows] = await pool.execute('SELECT id FROM attendees WHERE code = ?', [code]);
  if (!rows.length) return res.status(404).end();
  res.type('png').set('Cache-Control', 'public, max-age=3600').send(await qrPng(code));
});

app.post('/api/checkin', requireUser, requireApproved, async (req, res) => {
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
  if (req.user.role === 'staff') {
    if (!req.user.staffEvent) {
      return res.status(403).json({ error: 'No event is assigned to your account.' });
    }
    if (row.event_id !== req.user.staffEvent.id) {
      return res
        .status(403)
        .json({ error: `This ticket is for ${row.event_name}, not your assigned event.` });
    }
  }

  const attendee = toAttendee(row);
  if (attendee.checkedInAt) {
    return res.json({ status: 'already', attendee });
  }

  await pool.execute(
    'UPDATE attendees SET checked_in_at = NOW() WHERE code = ? AND checked_in_at IS NULL',
    [code],
  );
  const [after] = await pool.execute(
    'SELECT checked_in_at FROM attendees WHERE code = ?',
    [code],
  );

  res.json({
    status: 'checked-in',
    attendee: { ...attendee, checkedInAt: toIso(after[0].checked_in_at) },
  });
});

app.get('/api/attendees', requireUser, requireApproved, async (req, res) => {
  const requested = Number(req.query.eventId) || null;
  const staffEventId = req.user.role === 'staff' ? req.user.staffEvent?.id : null;
  if (req.user.role === 'staff' && !staffEventId) {
    return res.status(403).json({ error: 'No event is assigned to your account.' });
  }
  const eventId = staffEventId ?? requested;

  const [events] = staffEventId
    ? await pool.execute('SELECT id, name, starts_at FROM events WHERE id = ?', [staffEventId])
    : await pool.query('SELECT id, name, starts_at FROM events ORDER BY starts_at DESC');
  const [rows] = await pool.execute(
    `SELECT a.*, e.name AS event_name
       FROM attendees a JOIN events e ON e.id = a.event_id
      ${eventId ? 'WHERE a.event_id = ?' : ''}
      ORDER BY a.created_at DESC
      LIMIT 1000`,
    eventId ? [eventId] : [],
  );
  const [[stats]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(checked_in_at IS NOT NULL), 0) AS checkedIn
       FROM attendees ${eventId ? 'WHERE event_id = ?' : ''}`,
    eventId ? [eventId] : [],
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

app.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.listen(PORT, async () => {
  console.log(`API listening on http://localhost:${PORT}`);
  try {
    await pool.query('SELECT 1');
  } catch {
    console.warn('[config] MySQL is not reachable. Run "npm run db:migrate" and check .env.');
  }
});
