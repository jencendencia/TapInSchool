// Authentication + user management for the kiosk's admin dashboard gate and
// the staff PIN gate (kiosk manual check-in), plus the Department Head role
// (created on the Users & Roles page; signs into the Teacher Companion app).
//
// Credentials live in the `users` table (created in schema.ts) with pbkdf2
// hashes — no plaintext storage, no external dependencies (uses the built-in
// node:crypto). A default admin account (admin / admin) is seeded the first
// time the table is empty, so the app is usable out of the box.
//
// Roles:
//   admin      — username + password, opens the admin dashboard.
//   staff      — 4–8 digit PIN only; used at the kiosk to manually check in a
//                student who forgot their QR code.
//   dept_head  — created here by an admin (username + password + the sections
//                they manage). Signs into the TapIn Teacher Companion app,
//                where they add teachers and assign them to those sections.
//   teacher    — created + managed in the TapIn Teacher Companion app; listed
//                here read-only (source for the Sections page adviser dropdown).
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto';
import { db } from '../db/connection';
import type { TeacherOption, User, UserInput, UserRole } from '../../shared/types';

const ITERATIONS = 100_000;
const KEY_LEN = 32;
const DIGEST = 'sha256';
const DEFAULT_ADMIN = { username: 'admin', password: 'admin' };
const DEFAULT_STAFF = { username: 'staff', pin: '1234' };

interface UserRow {
  id: number;
  username: string;
  password_hash: string | null;
  role: UserRole;
  pin_hash: string | null;
  created_at: string;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
  role?: UserRole;
}

/** Hash a password/PIN into the portable format `pbkdf2$<iterations>$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST);
  return `pbkdf2$${ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time verification of a password/PIN against a stored hash. */
export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (!Number.isFinite(iterations) || salt.length === 0 || expected.length === 0) return false;
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, DIGEST);
  return timingSafeEqual(actual, expected);
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    username: r.username,
    role: r.role,
    has_pin: !!r.pin_hash,
    created_at: r.created_at,
  };
}

/** Human label for a role (used in validation errors). */
function roleLabel(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'staff':
      return 'Staff';
    case 'teacher':
      return 'Teacher';
    case 'dept_head':
      return 'Department head';
  }
}

/** Normalizes a requested role to a known value (falls back to `fallback`). */
function normalizeRole(raw: unknown, fallback: UserRole): UserRole {
  const r = String(raw ?? '');
  return r === 'admin' || r === 'staff' || r === 'teacher' || r === 'dept_head'
    ? (r as UserRole)
    : fallback;
}

// ---- Section mappings (dept_head ↔ grade_sections) --------------------------
// Stored in the shared teacher_sections table (also used by the companion app
// to map teachers ↔ sections). A dept_head manages the teachers of the
// sections assigned here on the Users & Roles page.

/** The current school year name (mappings are year-scoped). */
async function currentSchoolYearName(): Promise<string> {
  const rows = await db.query<{ name: string }[]>(
    'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
  );
  return rows[0]?.name ?? String(new Date().getFullYear());
}

/** Replaces a user's section mappings for the current school year. */
async function syncUserSections(userId: number, sections: string[]): Promise<void> {
  const year = await currentSchoolYearName();
  await db.execute('DELETE FROM teacher_sections WHERE teacher_id = ? AND school_year = ?', [userId, year]);
  for (const section of [...new Set(sections)]) {
    await db.execute(
      'INSERT INTO teacher_sections (teacher_id, grade_section, school_year) VALUES (?, ?, ?)',
      [userId, section, year],
    );
  }
}

/** The sections a user manages for the current school year. */
async function userSections(userId: number): Promise<string[]> {
  const year = await currentSchoolYearName();
  const rows = await db.query<{ grade_section: string }[]>(
    'SELECT grade_section FROM teacher_sections WHERE teacher_id = ? AND school_year = ? ORDER BY grade_section',
    [userId, year],
  );
  return rows.map((r) => r.grade_section);
}

/** Normalizes a PIN: digits only, 4–8 chars. Throws on invalid input. */
export function normalizePin(pin: unknown): string {
  const digits = String(pin ?? '').replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 8) {
    // ASCII only — a real en dash gets mangled by the Windows console codepage.
    throw new Error('Kiosk PIN must be 4-8 digits.');
  }
  return digits;
}

/**
 * Create the default accounts if the users table is empty, and migrate the
 * legacy settings-based staff PIN (pre-Users-page installs) into a staff user.
 * Idempotent.
 */
export async function ensureDefaultUsers(): Promise<void> {
  if (!db.isOnline()) return;
  try {
    const rows = await db.query<{ c: number }[]>('SELECT COUNT(*) c FROM users');
    if ((rows[0]?.c ?? 0) === 0) {
      // INSERT IGNORE so a concurrent seed can't hit the UNIQUE key.
      await db.execute('INSERT IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)', [
        DEFAULT_ADMIN.username,
        hashPassword(DEFAULT_ADMIN.password),
        'admin',
      ]);
      await db.execute('INSERT IGNORE INTO users (username, password_hash, role, pin_hash) VALUES (?, ?, ?, ?)', [
        DEFAULT_STAFF.username,
        null,
        'staff',
        hashPassword(DEFAULT_STAFF.pin),
      ]);
    }
    // Legacy migration: the old Settings page stored the kiosk PIN as a
    // `kiosk_staff_pin` setting. Transfer it to the first staff user (or the
    // default staff account just seeded) and drop the setting row.
    const pinRows = await db.query<{ setting_value: string }[]>(
      "SELECT setting_value FROM settings WHERE setting_key = 'kiosk_staff_pin' LIMIT 1",
    );
    if (pinRows[0]) {
      const legacyPin = String(pinRows[0].setting_value ?? '').replace(/\D/g, '');
      const staff = await db.query<UserRow[]>(
        "SELECT * FROM users WHERE role = 'staff' ORDER BY id LIMIT 1",
      );
      if (legacyPin.length >= 4 && legacyPin.length <= 8) {
        if (staff[0]) {
          await db.execute('UPDATE users SET pin_hash = ? WHERE id = ?', [hashPassword(legacyPin), staff[0].id]);
        } else {
          await db.execute(
            'INSERT IGNORE INTO users (username, password_hash, role, pin_hash) VALUES (?, ?, ?, ?)',
            ['staff', null, 'staff', hashPassword(legacyPin)],
          );
        }
      }
      await db.execute("DELETE FROM settings WHERE setting_key = 'kiosk_staff_pin'");
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
    // default accounts exist before attempting authentication.
    await ensureDefaultUsers();
    const rows = await db.query<UserRow[]>(
      'SELECT * FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    const user = rows[0];
    // Only admin accounts may open the dashboard; staff use the kiosk PIN and
    // teachers/dept heads sign into the companion app instead.
    if (!user || user.role !== 'admin' || !verifyPassword(password, user.password_hash)) {
      return { ok: false, error: 'Invalid username or password.' };
    }
    return { ok: true, role: 'admin' };
  } catch (err) {
    return { ok: false, error: `Sign-in failed: ${(err as Error).message}` };
  }
}

/** Teacher accounts (role 'teacher' in the shared users table) — the source
 *  for the Sections page's adviser dropdown. Teacher accounts are created in
 *  the TapIn Teacher Companion app; the kiosk only lists them here. */
export async function listAdvisers(): Promise<TeacherOption[]> {
  const rows = await db.query<TeacherOption[]>(
    "SELECT id, username, email FROM users WHERE role = 'teacher' ORDER BY username",
  );
  return rows;
}

/** True when any account's PIN matches (staff use this for kiosk manual check-in). */
export async function verifyStaffPin(pin: string): Promise<boolean> {
  const actual = String(pin ?? '').trim();
  if (!actual) return false;
  if (!db.isOnline()) return false;
  try {
    const rows = await db.query<UserRow[]>('SELECT pin_hash FROM users WHERE pin_hash IS NOT NULL');
    for (const row of rows) {
      if (verifyPassword(actual, row.pin_hash)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function listUsers(): Promise<User[]> {
  const rows = await db.query<UserRow[]>(
    'SELECT id, username, password_hash, role, pin_hash, created_at FROM users ORDER BY role ASC, username ASC',
  );
  const users = rows.map(toUser);
  // Attach the sections a dept_head manages (assigned here on this page).
  const deptHeads = users.filter((u) => u.role === 'dept_head');
  if (deptHeads.length) {
    try {
      const year = await currentSchoolYearName();
      const mappings = await db.query<{ teacher_id: number; grade_section: string }[]>(
        'SELECT teacher_id, grade_section FROM teacher_sections WHERE school_year = ?',
        [year],
      );
      for (const u of deptHeads) {
        u.sections = mappings.filter((m) => m.teacher_id === u.id).map((m) => m.grade_section);
      }
    } catch {
      // teacher_sections table missing (fresh DB mid-migration) — degrade.
    }
  }
  return users;
}

export async function createUser(input: UserInput): Promise<User> {
  const username = String(input?.username ?? '').trim();
  if (!username) throw new Error('Username is required.');
  if (username.length > 64) throw new Error('Username is too long (max 64 characters).');
  // Teachers are created in the companion app, but accept the role so a stale
  // client can never silently create an 'admin' by accident.
  const role: UserRole = normalizeRole(input?.role, 'admin');

  let passwordHash: string | null = null;
  let pinHash: string | null = null;
  if (role === 'staff') {
    pinHash = hashPassword(normalizePin(input?.pin));
  } else {
    // admin / dept_head / teacher all carry a username + password.
    const password = String(input?.password ?? '');
    if (password.length < 4) throw new Error(`${roleLabel(role)} users need a password (min 4 characters).`);
    passwordHash = hashPassword(password);
    // These roles may optionally carry a kiosk PIN too.
    const pin = String(input?.pin ?? '').replace(/\D/g, '');
    if (pin) pinHash = hashPassword(normalizePin(pin));
  }

  const sections = (Array.isArray(input?.sections) ? input.sections : []).map((s) => String(s).trim()).filter(Boolean);
  try {
    const res = await db.execute(
      'INSERT INTO users (username, password_hash, role, pin_hash) VALUES (?, ?, ?, ?)',
      [username, passwordHash, role, pinHash],
    );
    if (role === 'dept_head' && sections.length) await syncUserSections(res.insertId, sections);
    const [row] = await db.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [res.insertId]);
    return { ...toUser(row), sections: role === 'dept_head' ? sections : undefined };
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new Error(`Username "${username}" is already taken.`);
    }
    throw err;
  }
}

export async function updateUser(id: number, patch: Partial<UserInput>): Promise<User> {
  const userId = Number(id);
  const [current] = await db.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!current) throw new Error('User not found.');

  // Compute the RESULTING role + pin state up front so we can reject invalid
  // combinations BEFORE the UPDATE commits (a post-check would leave the DB
  // mutated even though the caller saw an error).
  const nextRole: UserRole = 'role' in patch ? normalizeRole(patch.role, current.role) : current.role;
  const pinWasCleared = 'pin' in patch && !String(patch.pin ?? '').replace(/\D/g, '');
  const nextHasPin = 'pin' in patch && !pinWasCleared
    ? !!String(patch.pin ?? '').replace(/\D/g, '')
    : pinWasCleared
      ? false
      : !!current.pin_hash;

  const sets: string[] = [];
  const params: unknown[] = [];

  if ('username' in patch) {
    const username = String(patch.username ?? '').trim();
    if (!username) throw new Error('Username is required.');
    if (username.length > 64) throw new Error('Username is too long (max 64 characters).');
    sets.push('username = ?');
    params.push(username);
  }
  if ('role' in patch) {
    const role = nextRole;
    // Staff accounts have no password; password-bearing roles (admin, dept
    // head, teacher) need one when they don't already have a current hash.
    if (role !== 'staff') {
      const nextPassword = 'password' in patch ? String(patch.password ?? '') : '';
      const keepCurrent = !nextPassword && current.password_hash;
      if (!keepCurrent && nextPassword.length < 4) {
        throw new Error(`${roleLabel(role)} users need a password (min 4 characters).`);
      }
      if (nextPassword) {
        sets.push('password_hash = ?');
        params.push(hashPassword(nextPassword));
      }
    }
    sets.push('role = ?');
    params.push(role);
  }
  if ('password' in patch && !('role' in patch)) {
    const password = String(patch.password ?? '');
    if (password && password.length < 4) throw new Error('Password must be at least 4 characters.');
    if (password) {
      sets.push('password_hash = ?');
      params.push(hashPassword(password));
    }
  }
  if ('pin' in patch) {
    const raw = String(patch.pin ?? '').replace(/\D/g, '');
    if (raw) {
      sets.push('pin_hash = ?');
      params.push(hashPassword(normalizePin(raw)));
    } else {
      sets.push('pin_hash = NULL');
    }
  }

  // A staff account is useless without a kiosk PIN — refuse to leave it PIN-less.
  if (nextRole === 'staff' && !nextHasPin) {
    throw new Error('Staff users need a 4-8 digit kiosk PIN.');
  }

  // Section mappings follow the dept_head role: sync when the role changes or
  // when sections are explicitly provided; clear when the role leaves dept_head.
  if ('role' in patch || 'sections' in patch) {
    if (nextRole === 'dept_head') {
      const kept =
        'sections' in patch
          ? (Array.isArray(patch.sections) ? patch.sections : []).map((s) => String(s).trim()).filter(Boolean)
          : await userSections(userId);
      await syncUserSections(userId, kept);
    } else if ('sections' in patch) {
      await syncUserSections(userId, []);
    }
  }

  if (sets.length) {
    params.push(userId);
    try {
      await db.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new Error(`Username "${patch.username}" is already taken.`);
      }
      throw err;
    }
  }
  const [row] = await db.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [userId]);
  const sections = nextRole === 'dept_head' ? await userSections(userId) : undefined;
  return { ...toUser(row), sections };
}

export async function deleteUser(id: number): Promise<void> {
  const userId = Number(id);
  const [target] = await db.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!target) throw new Error('User not found.');
  // Never allow removing the last admin — the dashboard would be locked out.
  if (target.role === 'admin') {
    const [count] = await db.query<{ c: number }[]>(
      "SELECT COUNT(*) c FROM users WHERE role = 'admin'",
    );
    if ((count?.c ?? 0) <= 1) {
      throw new Error('Cannot delete the last admin account.');
    }
  }
  // teacher_sections rows cascade via the FK.
  await db.execute('DELETE FROM users WHERE id = ?', [userId]);
}
