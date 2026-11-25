import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { createSession, hashPassword, setSessionCookie, toSessionUser } from './auth.js';
import { pool } from './db.js';
import { clean, EMAIL_RE, rateLimit } from './helpers.js';

export const staffRouter = Router();

const signupLimiter = rateLimit(10, 10 * 60_000);

staffRouter.post('/signup', signupLimiter, async (req, res) => {
  const name = clean(req.body?.name, 120);
  const email = clean(req.body?.email, 190).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const eventId = Number(req.body?.eventId);

  if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) {
    return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
  }
  if (!Number.isInteger(eventId)) {
    return res.status(400).json({ error: 'Choose the event you want to volunteer for.' });
  }

  const [events] = await pool.execute(
    'SELECT id FROM events WHERE id = ? AND starts_at > NOW()',
    [eventId],
  );
  if (!events.length) {
    return res.status(400).json({ error: 'That event is no longer open for volunteers.' });
  }

  const id = randomUUID();
  try {
    await pool.execute(
      `INSERT INTO users (id, email, name, password_hash, role, approval_status, staff_event_id)
       VALUES (?, ?, ?, ?, 'staff', 'pending', ?)`,
      [id, email, name, await hashPassword(password), eventId],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That email already has an account.' });
    }
    throw err;
  }

  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.name, u.role, u.approval_status, u.staff_event_id,
            e.name AS staff_event_name, e.starts_at AS staff_event_starts_at
       FROM users u
       LEFT JOIN events e ON e.id = u.staff_event_id
      WHERE u.id = ?`,
    [id],
  );

  setSessionCookie(req, res, await createSession(id));
  res.status(201).json({ user: toSessionUser(rows[0]) });
});
