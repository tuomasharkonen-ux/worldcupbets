import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Per-player PIN hashing. We avoid an external dependency (bcrypt/argon) and use
// Node's built-in scrypt — a memory-hard KDF that's plenty for a 4–6 digit PIN
// gating a friends' betting league. Stored as `salt:hash` (both hex).
//
// PINs are deliberately low-entropy, so a leaked passcode + brute force is the real
// threat model — not the hash. The shared league passcode (one more secret the
// attacker must also know) plus scrypt's cost keep online guessing impractical for
// the handful of players involved.

const scryptAsync = promisify(scrypt);

const KEYLEN = 32;
const SALT_BYTES = 16;

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

/** A valid PIN is 4–6 digits. Returns the normalized PIN or null if invalid. */
export function normalizePin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const pin = raw.trim();
  if (!/^\d{4,6}$/.test(pin)) return null;
  return pin;
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(pin, salt, KEYLEN)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Constant-time PIN check. Returns false for malformed stored hashes. */
export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scryptAsync(pin, salt, expected.length)) as Buffer;

  // Lengths match by construction, but guard so timingSafeEqual never throws.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
