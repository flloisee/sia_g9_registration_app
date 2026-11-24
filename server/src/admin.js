import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
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
import { clean, EMAIL_RE, mysqlDateTime, rateLimit, toEvent, toIso } from './helpers.js';

export const adminRouter = Router();

const loginLimiter = rateLimit(10, 10 * 60_000);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function findEvent(id, user) {
  const [rows] = await pool.execute('SELECT id, created_by FROM events WHERE id = ?', [id]);
  if (!rows.length) return null;
  if (user.role !== 'owner' && rows[0].created_by !== user.id) return null;
  return rows[0];
}

adminRouter.post('/login', loginLimiter, async (req, res) => {
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
  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
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
  if (status === 'approved' && !request.staff_event_id) {
    return res.status(400).json({ error: 'That event no longer exists. Reject the request instead.' });
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
  if (password.length < 8) {
    return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
  }

  const id = randomUUID();
  try {
    await pool.execute(
      "INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, 'organizer')",
      [id, email, name, hashPassword(password)],
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
