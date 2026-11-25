import { appendFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Telemetry lives beside the docs, outside the server bundle.
const LOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/logs');
const LATEST = path.join(LOG_DIR, 'latest.log');
const ARCHIVE_RE = /^(\d{4})-(\d{2})-(\d{2})-logs\.log$/;
const KEEP_DAYS = Math.max(1, Number(process.env.LOG_RETENTION_DAYS) || 14);

const pad = (value) => String(value).padStart(2, '0');
const dayKey = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// Vanilla-style line: [12:34:56] [Netty Server IO #1/INFO]: message
const stamp = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

let queue = Promise.resolve();
let openDay = null;

async function prune() {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);

  for (const name of await readdir(LOG_DIR)) {
    const match = ARCHIVE_RE.exec(name);
    if (!match) continue;
    // Filename date, not mtime, so a copied file keeps its own age.
    const logged = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
    if (logged < cutoff) await unlink(path.join(LOG_DIR, name)).catch(() => {});
  }
}

async function rotateIfNeeded() {
  const today = dayKey(new Date());
  if (openDay === today) return;

  try {
    const info = await stat(LATEST);
    const fileDay = dayKey(info.mtime);
    if (fileDay !== today) {
      await rename(LATEST, path.join(LOG_DIR, `${fileDay}-logs.log`));
      await prune();
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  openDay = today;
}

function write(level, thread, message) {
  const now = new Date();
  const text = String(message).replace(/[\r\n\t]+/g, ' ').slice(0, 2000);
  const line = `[${stamp(now)}] [${thread}/${level}]: ${text}\n`;
  queue = queue
    .then(async () => {
      await mkdir(LOG_DIR, { recursive: true });
      await rotateIfNeeded();
      await appendFile(LATEST, line);
    })
    .catch((err) => {
      console.error('[logger]', err.message);
    });
  return queue;
}

export const log = {
  info: (thread, message) => write('INFO', thread, message),
  warn: (thread, message) => write('WARN', thread, message),
  error: (thread, message) => write('ERROR', thread, message),
};

// Clean up expired archives even when the server starts fresh.
mkdir(LOG_DIR, { recursive: true }).then(prune).catch(() => {});
