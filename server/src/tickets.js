import { randomBytes } from 'node:crypto';

// No 0/O/1/I so codes survive being read aloud or typed by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

export function newCode() {
  // 256 is an exact multiple of 32, so the modulo introduces no bias.
  return Array.from(randomBytes(8), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export function normalizeCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
