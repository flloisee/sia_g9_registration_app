import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { hashPassword } from './auth.js';
import { EMAIL_RE, mysqlDateTime } from './helpers.js';

const name = process.env.DB_NAME ?? 'sia_event_registration';
if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Invalid DB_NAME: ${name}`);

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  multipleStatements: true,
});

try {
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await conn.changeUser({ database: name });
  await conn.query(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));

  // Upgrade databases created before staff accounts existed.
  const [roleColumn] = await conn.query("SHOW COLUMNS FROM users LIKE 'role'");
  if (!String(roleColumn[0]?.Type).includes("'staff'")) {
    await conn.query(
      "ALTER TABLE users MODIFY role ENUM('owner', 'organizer', 'staff') NOT NULL DEFAULT 'staff'",
    );
    console.log('Expanded user roles to include staff.');
  }

  const [approvalColumn] = await conn.query("SHOW COLUMNS FROM users LIKE 'approval_status'");
  if (approvalColumn.length === 0) {
    await conn.query(
      "ALTER TABLE users ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'approved' AFTER role",
    );
  }

  const [staffEventColumn] = await conn.query("SHOW COLUMNS FROM users LIKE 'staff_event_id'");
  if (staffEventColumn.length === 0) {
    await conn.query('ALTER TABLE users ADD COLUMN staff_event_id INT UNSIGNED NULL AFTER approval_status');
    await conn.query('ALTER TABLE users ADD KEY idx_users_staff_event (staff_event_id)');
  }

  const [staffEventFk] = await conn.query(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'staff_event_id'
        AND REFERENCED_TABLE_NAME = 'events'
      LIMIT 1`,
    [name],
  );
  if (staffEventFk.length === 0) {
    await conn.query(
      'ALTER TABLE users ADD CONSTRAINT fk_users_staff_event FOREIGN KEY (staff_event_id) REFERENCES events (id) ON DELETE SET NULL',
    );
  }

  const [pendingEmailColumn] = await conn.query("SHOW COLUMNS FROM users LIKE 'pending_email'");
  if (pendingEmailColumn.length === 0) {
    await conn.query(
      `ALTER TABLE users
         ADD COLUMN pending_email VARCHAR(190) NULL AFTER staff_event_id,
         ADD COLUMN pending_email_token CHAR(64) NULL AFTER pending_email,
         ADD COLUMN pending_email_expires_at DATETIME NULL AFTER pending_email_token,
         ADD KEY idx_users_pending_email_token (pending_email_token)`,
    );
  }

  const [eventCount] = await conn.query('SELECT COUNT(*) AS count FROM events');
  let defaultEventId = null;

  if (eventCount[0].count === 0) {
    const starts = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    starts.setHours(9, 0, 0, 0);
    const eventName = process.env.EVENT_NAME ?? 'SIA G9';
    const [created] = await conn.execute(
      'INSERT INTO events (name, title, body, starts_at, status) VALUES (?, ?, ?, ?, ?)',
      [
        eventName,
        'Reserve your seat.',
        `Registration for ${eventName} is open. Bring your QR ticket to check in at the door.`,
        mysqlDateTime(starts),
        'open',
      ],
    );
    defaultEventId = created.insertId;
    console.log(`Seeded a first event: "${eventName}" on ${starts.toDateString()}. Edit it in /dev/admin.`);
  }

  // Upgrade a database created before events existed.
  const [eventIdColumn] = await conn.query("SHOW COLUMNS FROM attendees LIKE 'event_id'");
  if (eventIdColumn.length === 0) {
    if (!defaultEventId) {
      const [first] = await conn.query('SELECT id FROM events ORDER BY starts_at ASC LIMIT 1');
      defaultEventId = first[0]?.id;
    }
    if (!defaultEventId) throw new Error('Cannot migrate attendees: no event exists.');

    await conn.query('ALTER TABLE attendees ADD COLUMN event_id INT UNSIGNED NULL AFTER id');
    await conn.query('UPDATE attendees SET event_id = ? WHERE event_id IS NULL', [defaultEventId]);
    await conn.query(
      `ALTER TABLE attendees
         MODIFY event_id INT UNSIGNED NOT NULL,
         DROP INDEX uq_email,
         ADD UNIQUE KEY uq_event_email (event_id, email),
         ADD CONSTRAINT fk_attendees_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE`,
    );
    console.log('Migrated attendees to per-event registration.');
  }

  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const adminName = (process.env.ADMIN_NAME ?? '').trim() || 'Event Admin';

  if (!EMAIL_RE.test(email)) {
    throw new Error('Set ADMIN_EMAIL in .env before running the migration.');
  }
  if (password.length < 8) {
    throw new Error('Set ADMIN_PASSWORD (8+ characters) in .env before running the migration.');
  }

  const [existing] = await conn.execute('SELECT id FROM users WHERE email = ?', [email]);
  const passwordHash = await hashPassword(password);

  if (existing.length > 0) {
    await conn.execute(
      "UPDATE users SET name = ?, password_hash = ?, role = 'owner', is_active = 1 WHERE id = ?",
      [adminName, passwordHash, existing[0].id],
    );
    await conn.execute('DELETE FROM sessions WHERE user_id = ?', [existing[0].id]);
    console.log(`Admin ${email} updated from .env.`);
  } else {
    await conn.execute(
      "INSERT INTO users (id, email, name, password_hash, role, is_active) VALUES (?, ?, ?, ?, 'owner', 1)",
      [randomUUID(), email, adminName, passwordHash],
    );
    console.log(`Admin ${email} created from .env.`);
  }

  console.log(`Database "${name}" is ready.`);
} finally {
  await conn.end();
}
