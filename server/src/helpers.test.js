import assert from 'node:assert/strict';
import test from 'node:test';
import { appOrigin, eventIsOpen, rateLimit, redactUrl } from './helpers.js';

test('redactUrl hides email-change tokens and ticket codes', () => {
  assert.equal(
    redactUrl('/api/admin/volunteers/confirm-email?token=secret123&x=1'),
    '/api/admin/volunteers/confirm-email?token=<redacted>&x=1',
  );
  assert.equal(redactUrl('/api/tickets/ABCD2345/qr.png'), '/api/tickets/<code>/qr.png');
});

test('eventIsOpen requires open status, a future start and no passed deadline', () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);
  assert.equal(
    eventIsOpen({ status: 'open', starts_at: future, registration_closes_at: null }),
    true,
  );
  assert.equal(
    eventIsOpen({ status: 'closed', starts_at: future, registration_closes_at: null }),
    false,
  );
  assert.equal(
    eventIsOpen({ status: 'open', starts_at: past, registration_closes_at: null }),
    false,
  );
  assert.equal(
    eventIsOpen({ status: 'open', starts_at: future, registration_closes_at: past }),
    false,
  );
});

test('appOrigin only falls back to localhost hosts', () => {
  const req = (host, protocol = 'https') => ({ get: () => host, protocol });
  if (!process.env.APP_ORIGIN) {
    assert.equal(appOrigin(req('localhost:4000', 'http')), 'http://localhost:4000');
    assert.equal(appOrigin(req('127.0.0.1:4000', 'http')), 'http://127.0.0.1:4000');
    assert.throws(() => appOrigin(req('attacker.example')), /APP_ORIGIN/);
  }
});

test('rateLimit keys on the supplied key and returns 429 after the limit', () => {
  const limiter = rateLimit(2, 60_000, (req) => req.key);
  const req = { key: 'account', ip: '127.0.0.1' };
  let status = 0;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };

  limiter(req, res, () => {});
  limiter(req, res, () => {});
  limiter(req, res, () => {});
  assert.equal(status, 429);
});
