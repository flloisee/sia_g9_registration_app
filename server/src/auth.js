import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import { pool } from './db.js';
import { toIso } from './helpers.js';

export const SESSION_COOKIE = 'sia_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_LENGTH = 64;
// OWASP's argon2id baseline: 19 MiB, 2 passes, 1 lane.
const ARGON2 = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 };

export function hashPassword(password) {
  return argon2id({ password, salt: randomBytes(16), ...ARGON2, outputType: 'encoded' });
}

export async function verifyPassword(password, stored) {
  const value = String(stored ?? '');
  if (value.startsWith('$argon2id$')) {
    return argon2Verify({ password, hash: value }).catch(() => false);
  }
  // Legacy scrypt hashes stay valid until the user's next login rehashes them.
  const [scheme, salt, hash] = value.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export const isLegacyHash = (stored) => !String(stored ?? '').startsWith('$argon2id$');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function toSessionUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    approvalStatus: row.approval_status,
    staffEvent: row.staff_event_id
      ? {
          id: row.staff_event_id,
          name: row.staff_event_name,
          startsAt: toIso(row.staff_event_starts_at),
        }
      : null,
  };
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  await pool.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
    sha256(token),
    userId,
    new Date(Date.now() + SESSION_TTL_MS),
  ]);
  return token;
}

export async function destroySession(token) {
  if (token) await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function getSessionUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.name, u.role, u.approval_status, u.staff_event_id,
            e.name AS staff_event_name, e.starts_at AS staff_event_starts_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN events e ON e.id = u.staff_event_id
      WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.is_active = 1`,
    [sha256(token)],
  );
  return rows[0] ? toSessionUser(rows[0]) : null;
}

export async function requireUser(req, res, next) {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to continue.' });
  req.user = user;
  next();
}

export function requireApproved(req, res, next) {
  if (req.user.approvalStatus !== 'approved') {
    return res.status(403).json({ error: 'Your staff account is waiting for approval.' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'owner' && req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  if (req.user.approvalStatus !== 'approved') {
    return res.status(403).json({ error: 'Your account is not approved yet.' });
  }
  next();
}

export function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner account can manage users.' });
  }
  next();
}
