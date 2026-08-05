// Admin authentication for the kiosk's admin dashboard gate.
//
// Credentials live in the `users` table (created in schema.ts) with pbkdf2
// password hashes — no plaintext storage, no external dependencies (uses the
// built-in node:crypto). A default admin account (admin / admin) is seeded the
// first time the table is empty, so the app is usable out of the box.
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto';
import { db } from '../db/connection';

const ITERATIONS = 100_000;
const KEY_LEN = 32;
const DIGEST = 'sha256';
const DEFAULT_ADMIN = { username: 'admin', password: 'admin' };

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
}

/** Hash a password into the portable format `pbkdf2$<iterations>$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST);
  return `pbkdf2$${ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time verification of a password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (!Number.isFinite(iterations) || salt.length === 0 || expected.length === 0) return false;
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, DIGEST);
  return timingSafeEqual(actual, expected);
}

/** Create the default admin account if the users table is empty. Idempotent. */
export async function ensureAdminUser(): Promise<void> {
  if (!db.isOnline()) return;
  try {
    const rows = await db.query<{ c: number }[]>('SELECT COUNT(*) c FROM users');
    if ((rows[0]?.c ?? 0) === 0) {
      // INSERT IGNORE so a concurrent seed can't hit the UNIQUE key.
      await db.execute('INSERT IGNORE INTO users (username, password_hash) VALUES (?, ?)', [
        DEFAULT_ADMIN.username,
        hashPassword(DEFAULT_ADMIN.password),
      ]);
    }
  } catch {
    // Users table missing / DB hiccup — the login handler will surface an error.
  }
}

export async function login(username: string, password: string): Promise<LoginResult> {
  if (!db.isOnline()) {
    return { ok: false, error: 'Database offline — cannot sign in.' };
  }
  try {
    // Self-heal: if the app ever boots with an empty users table, make sure the
    // default admin exists before attempting authentication.
    await ensureAdminUser();
    const rows = await db.query<UserRow[]>(
      'SELECT * FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return { ok: false, error: 'Invalid username or password.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Sign-in failed: ${(err as Error).message}` };
  }
}
