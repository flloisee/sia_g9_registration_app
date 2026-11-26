import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  isLegacyHash,
  readCookie,
  requireAdmin,
  requireOwner,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
  toSessionUser,
  verifyPassword,
} from './auth.js';
import { pool } from './db.js';
import {
  appOrigin,
  clean,
  EMAIL_RE,
  eventIsOpen,
  mysqlDateTime,
  rateLimit,
  toEvent,
  toIso,
} from './helpers.js';
import { sendEmailChangeEmail } from './mail.js';

export const adminRouter = Router();

const loginIpLimiter = rateLimit(10, 10 * 60_000);
const loginAccountLimiter = rateLimit(10, 10 * 60_000, (req) =>
  clean(req.body?.email, 190).toLowerCase(),
);
const confirmEmailLimiter = rateLimit(20, 60_000);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A missing account must cost the same as a wrong password.
let dummyHashPromise;
const getDummyHash = () =>
  (dummyHashPromise ??= hashPassword('timing-equalizer-not-a-real-password'));

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseEvent(body) {
  const name = clean(body?.name, 120);
  const title = clean(body?.title, 160);
  const description = typeof body?.body === 'string' ? body.body.trim().slice(0, 5000) : '';
  const location = clean(body?.location, 160);
  const startsAt = parseDate(body?.startsAt);
  const endsAt = parseDate(body?.endsAt);
  const registrationClosesAt = parseDate(body?.registrationClosesAt);
  const status = body?.status === 'closed' ? 'closed' : 'open';

  if (name.length < 2) return { error: 'Give the event a name.' };
  if (title.length < 2) return { error: 'Give the event a public title.' };
  if (!startsAt) return { error: 'Set a valid start date and time.' };
  if (endsAt === undefined) return { error: 'The end time is not a valid date.' };
  if (endsAt && endsAt <= startsAt) return { error: 'The end time must be after the start.' };
  if (registrationClosesAt === undefined) {
    return { error: 'The registration deadline is not a valid date.' };
  }
  if (registrationClosesAt && registrationClosesAt > startsAt) {
    return { error: 'Registration must close before the event starts.' };
  }

  return { value: { name, title, description, location, startsAt, endsAt, registrationClosesAt, status } };
}

const EVENT_SELECT = `SELECT e.*, u.name AS creator_name,
    (SELECT COUNT(*) FROM attendees a WHERE a.event_id = e.id) AS registered_count,
    (SELECT COUNT(*) FROM attendees a WHERE a.event_id = e.id AND a.checked_in_at IS NOT NULL) AS checked_in_count
  FROM events e LEFT JOIN users u ON u.id = e.created_by`;

const VOLUNTEER_SELECT = `SELECT u.id, u.name, u.email, u.pending_email, u.approval_status, u.is_active,
    u.created_at, u.staff_event_id, e.name AS event_name, e.starts_at AS event_starts_at,
    e.created_by AS event_creator
  FROM users u LEFT JOIN events e ON e.id = u.staff_event_id`;

const CLEAR_PENDING_EMAIL =
  'UPDATE users SET pending_email = NULL, pending_email_token = NULL, pending_email_expires_at = NULL WHERE id = ?';

const toVolunteer = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  pendingEmail: row.pending_email ?? null,
  approvalStatus: row.approval_status,
  isActive: Boolean(row.is_active),
  eventId: row.staff_event_id,
  eventName: row.event_name ?? null,
  eventStartsAt: toIso(row.event_starts_at),
  createdAt: toIso(row.created_at),
});

async function findEvent(id, user) {
  const [rows] = await pool.execute('SELECT id, created_by FROM events WHERE id = ?', [id]);
  if (!rows.length) return null;
  if (user.role !== 'owner' && rows[0].created_by !== user.id) return null;
  return rows[0];
}

adminRouter.post('/login', loginIpLimiter, loginAccountLimiter, async (req, res) => {
  const email = clean(req.body?.email, 190).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.name, u.role, u.approval_status, u.staff_event_id,
            u.password_hash, u.is_active,
            e.name AS staff_event_name, e.starts_at AS staff_event_starts_at
       FROM users u
       LEFT JOIN events e ON e.id = u.staff_event_id
      WHERE u.email = ?`,
    [email],
  );
  const user = rows[0];
  const stored = user?.password_hash ?? (await getDummyHash());
  const passwordOk = await verifyPassword(password, stored);
  if (!user || !user.is_active || !passwordOk) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }

  if (isLegacyHash(user.password_hash)) {
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
      await hashPassword(password),
      user.id,
    ]);
  }

  await pool.execute('DELETE FROM sessions WHERE expires_at < NOW()');
  setSessionCookie(req, res, await createSession(user.id));
  res.json({ user: toSessionUser(user) });
});

adminRouter.post('/logout', async (req, res) => {
  await destroySession(readCookie(req, SESSION_COOKIE));
  clearSessionCookie(res);
  res.json({ ok: true });
});

// 200 with a null user keeps the signed-out check from logging a console 401.
adminRouter.get('/me', async (req, res) => {
  res.json({ user: await getSessionUser(req) });
});

adminRouter.get('/events', requireUser, requireAdmin, async (req, res) => {
  const [rows] =
    req.user.role === 'owner'
      ? await pool.query(`${EVENT_SELECT} ORDER BY e.starts_at DESC`)
      : await pool.execute(`${EVENT_SELECT} WHERE e.created_by = ? ORDER BY e.starts_at DESC`, [
          req.user.id,
        ]);
  res.json({ events: rows.map(toEvent) });
});

adminRouter.post('/events', requireUser, requireAdmin, async (req, res) => {
  const parsed = parseEvent(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { name, title, description, location, startsAt, endsAt, registrationClosesAt, status } =
    parsed.value;

  const [result] = await pool.execute(
    `INSERT INTO events (name, title, body, location, starts_at, ends_at, status, registration_closes_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      title,
      description,
      location || null,
      mysqlDateTime(startsAt),
      endsAt ? mysqlDateTime(endsAt) : null,
      status,
      registrationClosesAt ? mysqlDateTime(registrationClosesAt) : null,
      req.user.id,
    ],
  );

  const [rows] = await pool.execute(`${EVENT_SELECT} WHERE e.id = ?`, [result.insertId]);
  res.status(201).json({ event: toEvent(rows[0]) });
});

adminRouter.patch('/events/:id', requireUser, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid event.' });
  if (!(await findEvent(id, req.user))) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  const parsed = parseEvent(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { name, title, description, location, startsAt, endsAt, registrationClosesAt, status } =
    parsed.value;

  await pool.execute(
    `UPDATE events
        SET name = ?, title = ?, body = ?, location = ?, starts_at = ?, ends_at = ?, status = ?, registration_closes_at = ?
      WHERE id = ?`,
    [
      name,
      title,
      description,
      location || null,
      mysqlDateTime(startsAt),
      endsAt ? mysqlDateTime(endsAt) : null,
      status,
      registrationClosesAt ? mysqlDateTime(registrationClosesAt) : null,
      id,
    ],
  );

  const [rows] = await pool.execute(`${EVENT_SELECT} WHERE e.id = ?`, [id]);
  res.json({ event: toEvent(rows[0]) });
});

adminRouter.delete('/events/:id', requireUser, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid event.' });
  if (!(await findEvent(id, req.user))) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  // Attendees are removed by the ON DELETE CASCADE on attendees.event_id.
  await pool.execute('DELETE FROM events WHERE id = ?', [id]);
  res.json({ ok: true });
});

adminRouter.get('/staff-requests', requireUser, requireAdmin, async (req, res) => {
  const scoped = req.user.role === 'organizer';
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.email, u.created_at, u.staff_event_id,
            e.name AS event_name, e.starts_at AS event_starts_at
       FROM users u
       LEFT JOIN events e ON e.id = u.staff_event_id
      WHERE u.role = 'staff' AND u.approval_status = 'pending'
        ${scoped ? 'AND e.created_by = ?' : ''}
      ORDER BY u.created_at ASC`,
    scoped ? [req.user.id] : [],
  );

  res.json({
    requests: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      eventId: row.staff_event_id,
      eventName: row.event_name ?? null,
      eventStartsAt: toIso(row.event_starts_at),
      createdAt: toIso(row.created_at),
    })),
  });
});

adminRouter.get('/volunteers', requireUser, requireAdmin, async (req, res) => {
  const scoped = req.user.role === 'organizer';
  const [rows] = await pool.execute(
    `${VOLUNTEER_SELECT}
      WHERE u.role = 'staff'
        ${scoped ? 'AND e.created_by = ?' : ''}
      ORDER BY e.starts_at IS NULL, e.starts_at ASC, u.name ASC`,
    scoped ? [req.user.id] : [],
  );

  res.json({ volunteers: rows.map(toVolunteer) });
});

// The new address proves ownership before the change applies.
adminRouter.get('/volunteers/confirm-email', confirmEmailLimiter, async (req, res) => {
  const page = (status, title, message) =>
    res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Event Manager</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c22;">
<main style="max-width:440px;margin:16px;padding:32px;text-align:center;background:#fff;border:1px solid #e7e5e0;border-radius:16px;">
<h1 style="margin:0 0 12px;font-size:22px;">${title}</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#4a4a55;">${message}</p>
</main></body></html>`);

  const token = String(req.query.token ?? '');
  if (!token) return page(400, 'Link is invalid', 'Ask an admin to send a new verification email.');

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [rows] = await pool.execute(
    `SELECT id FROM users
      WHERE role = 'staff' AND pending_email IS NOT NULL
        AND pending_email_token = ? AND pending_email_expires_at > NOW()`,
    [tokenHash],
  );
  const volunteer = rows[0];
  if (!volunteer) {
    return page(400, 'Link expired', 'Ask an admin to send a new verification email.');
  }

  try {
    await pool.execute(
      `UPDATE users
          SET email = pending_email, pending_email = NULL,
              pending_email_token = NULL, pending_email_expires_at = NULL
        WHERE id = ?`,
      [volunteer.id],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return page(409, 'Email unavailable', 'Another account already uses that email address.');
    }
    throw err;
  }

  page(200, 'Email updated', 'The volunteer can now sign in with this address.');
});

adminRouter.patch('/volunteers/:id', requireUser, requireAdmin, async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid volunteer.' });

  const [rows] = await pool.execute(`${VOLUNTEER_SELECT} WHERE u.id = ? AND u.role = 'staff'`, [id]);
  const volunteer = rows[0];
  if (!volunteer) return res.status(404).json({ error: 'Volunteer not found.' });
  if (req.user.role === 'organizer' && volunteer.event_creator !== req.user.id) {
    return res.status(404).json({ error: 'Volunteer not found.' });
  }

  const name = clean(req.body?.name, 120);
  const email = clean(req.body?.email, 190).toLowerCase();
  const eventId = Number(req.body?.eventId);

  if (name.length < 2) return res.status(400).json({ error: 'Enter the volunteer’s name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!Number.isInteger(eventId)) {
    return res.status(400).json({ error: 'Choose the event they volunteered for.' });
  }

  const [events] = await pool.execute('SELECT id, created_by FROM events WHERE id = ?', [eventId]);
  const event = events[0];
  if (!event) return res.status(400).json({ error: 'That event no longer exists.' });
  if (req.user.role === 'organizer' && event.created_by !== req.user.id) {
    return res.status(400).json({ error: 'You can only assign volunteers to your own events.' });
  }

  let emailSent = false;
  let emailPreviewUrl = null;

  if (email !== String(volunteer.email).toLowerCase()) {
    const [taken] = await pool.execute('SELECT id FROM users WHERE email = ? AND id <> ?', [
      email,
      id,
    ]);
    if (taken.length) return res.status(409).json({ error: 'That email already has an account.' });

    const token = randomBytes(32).toString('base64url');
    await pool.execute(
      'UPDATE users SET pending_email = ?, pending_email_token = ?, pending_email_expires_at = ? WHERE id = ?',
      [
        email,
        createHash('sha256').update(token).digest('hex'),
        mysqlDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000)),
        id,
      ],
    );

    try {
      const mail = await sendEmailChangeEmail({
        to: email,
        name,
        confirmUrl: `${appOrigin(req)}/api/admin/volunteers/confirm-email?token=${token}`,
      });
      emailSent = true;
      emailPreviewUrl = mail.previewUrl;
    } catch (err) {
      console.error('[mail]', err.message);
      await pool.execute(CLEAR_PENDING_EMAIL, [id]);
      return res.status(502).json({ error: 'Could not send the verification email. Try again.' });
    }
  } else {
    await pool.execute(CLEAR_PENDING_EMAIL, [id]);
  }

  await pool.execute('UPDATE users SET name = ?, staff_event_id = ? WHERE id = ?', [
    name,
    eventId,
    id,
  ]);

  const [updated] = await pool.execute(`${VOLUNTEER_SELECT} WHERE u.id = ?`, [id]);
  res.json({ volunteer: toVolunteer(updated[0]), emailSent, emailPreviewUrl });
});

adminRouter.delete('/volunteers/:id', requireUser, requireAdmin, async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid volunteer.' });

  const [rows] = await pool.execute(`${VOLUNTEER_SELECT} WHERE u.id = ? AND u.role = 'staff'`, [id]);
  const volunteer = rows[0];
  if (!volunteer) return res.status(404).json({ error: 'Volunteer not found.' });
  if (req.user.role === 'organizer' && volunteer.event_creator !== req.user.id) {
    return res.status(404).json({ error: 'Volunteer not found.' });
  }

  // Sessions are removed by the ON DELETE CASCADE on sessions.user_id.
  await pool.execute("DELETE FROM users WHERE id = ? AND role = 'staff'", [id]);
  res.json({ ok: true });
});

adminRouter.patch('/staff-requests/:id', requireUser, requireAdmin, async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid request.' });
  const status = req.body?.status;
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ error: 'Choose approve or reject.' });
  }

  const [rows] = await pool.execute(
    `SELECT u.id, u.role, u.staff_event_id, e.created_by AS event_creator
       FROM users u
       LEFT JOIN events e ON e.id = u.staff_event_id
      WHERE u.id = ?`,
    [id],
  );
  const request = rows[0];
  if (!request || request.role !== 'staff') {
    return res.status(404).json({ error: 'Request not found.' });
  }
  if (req.user.role === 'organizer' && request.event_creator !== req.user.id) {
    return res.status(404).json({ error: 'Request not found.' });
  }
  if (status === 'approved') {
    if (!request.staff_event_id) {
      return res
        .status(400)
        .json({ error: 'That event no longer exists. Reject the request instead.' });
    }
    const [events] = await pool.execute('SELECT * FROM events WHERE id = ?', [
      request.staff_event_id,
    ]);
    if (!events.length || !eventIsOpen(events[0])) {
      return res
        .status(400)
        .json({ error: 'That event is no longer open. Reject the request instead.' });
    }
  }

  await pool.execute('UPDATE users SET approval_status = ? WHERE id = ?', [status, id]);
  res.json({ ok: true });
});

adminRouter.get('/users', requireUser, requireOwner, async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT id, email, name, role, is_active, created_at FROM users WHERE role IN ('owner', 'organizer') ORDER BY created_at ASC",
  );
  res.json({
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at.toISOString(),
    })),
  });
});

adminRouter.post('/users', requireUser, requireOwner, async (req, res) => {
  const name = clean(req.body?.name, 120);
  const email = clean(req.body?.email, 190).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (name.length < 2) return res.status(400).json({ error: 'Enter the person’s name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: 'Use a password of 12 to 128 characters.' });
  }

  const id = randomUUID();
  try {
    await pool.execute(
      "INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, 'organizer')",
      [id, email, name, await hashPassword(password)],
    );
    res.status(201).json({
      user: {
        id,
        email,
        name,
        role: 'organizer',
        isActive: true,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That email already has an account.' });
    }
    throw err;
  }
});

adminRouter.patch('/users/:id', requireUser, requireOwner, async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid user.' });
  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  const [rows] = await pool.execute('SELECT id, role FROM users WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found.' });
  if (rows[0].role === 'owner') {
    return res.status(403).json({
      error: 'The owner account is managed by the migration script, not here.',
    });
  }
  if (rows[0].role !== 'organizer') {
    return res.status(404).json({ error: 'User not found.' });
  }

  await pool.execute('UPDATE users SET is_active = ? WHERE id = ?', [req.body.isActive ? 1 : 0, id]);
  if (!req.body.isActive) await pool.execute('DELETE FROM sessions WHERE user_id = ?', [id]);

  res.json({ ok: true });
});
