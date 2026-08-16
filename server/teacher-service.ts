// Teacher authentication + account management for the kiosk-embedded portal
// (port of the companion app's services). Accounts live in the shared `users`
// table: role 'teacher' (created here by dept heads) and role 'dept_head'
// (created by a kiosk admin on the Users & Roles page, sections assigned
// there). Dept heads manage the teachers of their own sections. Credentials
// use the kiosk's pbkdf2 format, so hashes are interchangeable.
import { db } from '../electron/db/connection';
import { hashPassword, verifyPassword } from '../electron/services/auth';
import { currentSchoolYearName } from './school-year';
import type { LoginResult, SectionSummary, TeacherInfo, TeacherInput, TeacherRole, TeacherSession } from './teacher-types';

interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string | null;
  role: string;
  created_at: string;
}

/** Signs in a `users` row whose role is 'teacher' or 'dept_head'. */
export async function login(username: string, password: string): Promise<LoginResult> {
  if (!db.isOnline()) {
    return { ok: false, error: 'Database offline — cannot sign in.' };
  }
  try {
    const rows = await db.query<UserRow[]>(
      'SELECT * FROM users WHERE username = ? LIMIT 1',
      [String(username ?? '').trim()],
    );
    const user = rows[0];
    const role: TeacherRole | null =
      user?.role === 'teacher' || user?.role === 'dept_head' ? user.role : null;
    if (!user || !role || !verifyPassword(String(password ?? ''), user.password_hash)) {
      return { ok: false, error: 'Invalid username or password.' };
    }
    const session: TeacherSession = { id: user.id, username: user.username, role };
    return { ok: true, teacher: session };
  } catch (err) {
    return { ok: false, error: `Sign-in failed: ${(err as Error).message}` };
  }
}

export async function countTeachers(): Promise<number> {
  if (!db.isOnline()) return 0;
  try {
    const rows = await db.query<{ c: number }[]>(
      "SELECT COUNT(*) c FROM users WHERE role IN ('teacher','dept_head')",
    );
    return rows[0]?.c ?? 0;
  } catch {
    return 0;
  }
}

/** Self-heals the users.email column (added by the schema pass; a peer may
 *  have added it just now). Idempotent. */
async function ensureUserEmailColumn(): Promise<void> {
  if (!db.isOnline()) return;
  try {
    const cols = await db.query<{ COLUMN_NAME: string }[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email'`,
    );
    if (!cols.length) {
      try {
        await db.execute("ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT '' AFTER username");
      } catch (err) {
        if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
      }
    }
  } catch {
    // users table missing / DB hiccup — the write below surfaces the real error.
  }
}

// ---- Section mappings (teacher ↔ grade_sections, current year) -----------------

async function teacherSectionsFor(teacherId: number, year: string): Promise<string[]> {
  const rows = await db.query<{ grade_section: string }[]>(
    'SELECT grade_section FROM teacher_sections WHERE teacher_id = ? AND school_year = ? ORDER BY grade_section',
    [Number(teacherId), year],
  );
  return rows.map((r) => r.grade_section);
}

async function setTeacherSections(teacherId: number, sections: string[], year: string): Promise<void> {
  const id = Number(teacherId);
  await db.execute('DELETE FROM teacher_sections WHERE teacher_id = ? AND school_year = ?', [id, year]);
  for (const section of [...new Set(sections)]) {
    await db.execute(
      'INSERT INTO teacher_sections (teacher_id, grade_section, school_year) VALUES (?, ?, ?)',
      [id, section, year],
    );
  }
}

/** Every grade_section the school has: the sections registry + any section
 *  students are currently in (a section may exist without a registry row). */
export async function listAllSections(): Promise<string[]> {
  const rows = await db.query<{ grade_section: string }[]>(
    `SELECT DISTINCT grade_section FROM (
       SELECT grade_section FROM sections WHERE grade_section <> ''
       UNION
       SELECT grade_section FROM students WHERE grade_section <> ''
     ) t ORDER BY grade_section`,
  );
  return rows.map((r) => r.grade_section);
}

/** Sections a user handles (with current enrolled counts) for the current year. */
export async function listMySections(teacherId: number): Promise<SectionSummary[]> {
  const year = await currentSchoolYearName();
  const rows = await db.query<{ grade_section: string; school_year: string; enrolled: number }[]>(
    `SELECT ts.grade_section, ts.school_year, COUNT(s.id) enrolled
     FROM teacher_sections ts
     LEFT JOIN students s ON s.grade_section = ts.grade_section AND s.is_active = 1
     WHERE ts.teacher_id = ? AND ts.school_year = ?
     GROUP BY ts.grade_section, ts.school_year
     ORDER BY ts.grade_section`,
    [Number(teacherId), year],
  );
  return rows.map((r) => ({
    grade_section: r.grade_section,
    school_year: r.school_year,
    enrolled: Number(r.enrolled),
  }));
}

// ---- Scoped teacher management (dept heads only) --------------------------------

/** The grade_sections a dept_head manages for the current year — their scope.
 *  Plain teachers have no management scope (returns []). */
async function actorScope(actor: TeacherSession): Promise<string[]> {
  if (actor?.role !== 'dept_head') return [];
  return teacherSectionsFor(actor.id, await currentSchoolYearName());
}

function requireDeptHead(actor: TeacherSession): void {
  if (actor?.role !== 'dept_head') {
    throw new Error('Only department heads can manage teacher accounts.');
  }
}

/** True when a teacher's sections make it visible to this dept head: it is
 *  mapped to ≥1 of their sections, or it has no sections at all yet. */
function inScope(teacherSections: string[], scope: string[]): boolean {
  return teacherSections.length === 0 || teacherSections.some((s) => scope.includes(s));
}

/** Every teacher account with sections, scoped to what the actor may manage. */
export async function listTeachers(actor: TeacherSession): Promise<TeacherInfo[]> {
  if (actor?.role !== 'dept_head') return [];
  const scope = await actorScope(actor);
  const rows = await db.query<UserRow[]>(
    "SELECT id, username, email, password_hash, role, created_at FROM users WHERE role = 'teacher' ORDER BY username",
  );
  const year = await currentSchoolYearName();
  const out: TeacherInfo[] = [];
  for (const r of rows) {
    const sections = await teacherSectionsFor(r.id, year);
    if (inScope(sections, scope)) {
      out.push({ id: r.id, username: r.username, email: r.email ?? '', sections, created_at: r.created_at });
    }
  }
  return out;
}

export async function createTeacher(input: TeacherInput, actor: TeacherSession): Promise<TeacherInfo> {
  requireDeptHead(actor);
  await ensureUserEmailColumn();
  const username = String(input?.username ?? '').trim();
  if (!username) throw new Error('Username is required.');
  if (username.length > 64) throw new Error('Username is too long (max 64 characters).');
  const password = String(input?.password ?? '');
  if (password.length < 4) throw new Error('Password must be at least 4 characters.');
  const email = String(input?.email ?? '').trim().slice(0, 255);
  const scope = await actorScope(actor);
  const sections = (Array.isArray(input.sections) ? input.sections : [])
    .map((s) => String(s).trim()).filter(Boolean)
    .filter((s) => scope.includes(s));
  try {
    const res = await db.execute(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username, email, hashPassword(password), 'teacher'],
    );
    const year = await currentSchoolYearName();
    if (sections.length) await setTeacherSections(res.insertId, sections, year);
    const [row] = await db.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [res.insertId]);
    return { id: row.id, username: row.username, email: row.email ?? '', sections, created_at: row.created_at };
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new Error(`Username "${username}" is already taken.`);
    }
    throw err;
  }
}

export async function updateTeacher(id: number, patch: Partial<TeacherInput>, actor: TeacherSession): Promise<TeacherInfo> {
  requireDeptHead(actor);
  await ensureUserEmailColumn();
  const userId = Number(id);
  const [current] = await db.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!current || current.role !== 'teacher') throw new Error('Teacher not found.');

  const year = await currentSchoolYearName();
  const scope = await actorScope(actor);
  const currentSections = await teacherSectionsFor(userId, year);
  if (!inScope(currentSections, scope)) {
    throw new Error('This teacher is not in your department.');
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if ('username' in patch) {
    const username = String(patch.username ?? '').trim();
    if (!username) throw new Error('Username is required.');
    if (username.length > 64) throw new Error('Username is too long (max 64 characters).');
    sets.push('username = ?');
    params.push(username);
  }
  if ('password' in patch) {
    const password = String(patch.password ?? '');
    if (password && password.length < 4) throw new Error('Password must be at least 4 characters.');
    if (password) {
      sets.push('password_hash = ?');
      params.push(hashPassword(password));
    }
  }
  if ('email' in patch) {
    sets.push('email = ?');
    params.push(String(patch.email ?? '').trim().slice(0, 255));
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
  let sections = currentSections;
  if ('sections' in patch) {
    // Keep other departments' mappings intact; only the actor's own sections
    // may be added/removed from the teacher's assignment.
    const kept = currentSections.filter((s) => !scope.includes(s));
    const mine = (Array.isArray(patch.sections) ? patch.sections : [])
      .map((s) => String(s).trim()).filter(Boolean)
      .filter((s) => scope.includes(s));
    sections = [...kept, ...mine];
    await setTeacherSections(userId, sections, year);
  }
  const [row] = await db.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [userId]);
  return { id: row.id, username: row.username, email: row.email ?? '', sections, created_at: row.created_at };
}

export async function deleteTeacher(id: number, actor: TeacherSession): Promise<void> {
  requireDeptHead(actor);
  const userId = Number(id);
  const [target] = await db.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!target || target.role !== 'teacher') throw new Error('Teacher not found.');
  const year = await currentSchoolYearName();
  const scope = await actorScope(actor);
  const sections = await teacherSectionsFor(userId, year);
  if (!inScope(sections, scope)) {
    throw new Error('This teacher is not in your department.');
  }
  // teacher_sections rows cascade via the FK; delete the account itself.
  await db.execute('DELETE FROM users WHERE id = ?', [userId]);
}
