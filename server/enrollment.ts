// Student enrollment for the kiosk-embedded teacher portal (companion app).
//
// The admin flips settings.teacher_enrollment_enabled ON in the kiosk's
// Settings; when it's ON, teachers/dept heads can enroll (create / edit /
// deactivate / delete) students in the sections THEY are mapped to — the same
// student-management rules the kiosk's own admin page follows, but scoped so a
// teacher can never touch another section's roster.
//
// This is a port of the student CRUD in electron/ipc.ts (kept intentionally
// simpler: no guardian-registry linking, no photos — the portal form only
// collects the SF1-style profile fields). QR payloads and the current-year
// enrollment sync behave exactly like the kiosk's.
import { db } from '../electron/db/connection';
import { generateGuardianPayload, generatePayload } from '../electron/services/qr';
import { findGuardianById } from './guardians';
import { currentSchoolYearName } from './school-year';
import type { Student, StudentInput } from '../shared/types';
import type { TeacherRole } from './teacher-types';

export interface PortalActor {
  id: number;
  username: string;
  role: TeacherRole;
}

interface StudentRow {
  id: number;
  student_no: string;
  qr_hash_payload: string;
  full_name: string;
  gender: string;
  grade_section: string;
  parent_phone: string;
  lrn: string;
  guardian_name: string;
  guardian_address: string;
  guardian_qr_hash_payload: string | null;
  guardian_id: number | null;
  photo_url: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const toStudent = (r: StudentRow): Student => ({
  id: r.id,
  student_no: r.student_no,
  qr_hash_payload: r.qr_hash_payload,
  full_name: r.full_name,
  gender: r.gender as Student['gender'],
  grade_section: r.grade_section,
  parent_phone: r.parent_phone,
  lrn: r.lrn,
  guardian_name: r.guardian_name,
  guardian_address: r.guardian_address,
  guardian_qr_hash_payload: r.guardian_qr_hash_payload,
  guardian_id: r.guardian_id,
  photo_url: r.photo_url,
  is_active: !!r.is_active,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/** Coerces a raw gender value to 'male' | 'female' | '' (lenient about case
 *  and single letters — mirrors electron/ipc.ts). */
function normalizeGender(raw: unknown): '' | 'male' | 'female' {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'male' || v === 'm') return 'male';
  if (v === 'female' || v === 'f') return 'female';
  return '';
}

/** Splits "Grade 7 - Section A" into grade "Grade 7" / section "Section A"
 *  (must match electron/ipc.ts splitSection + the schema backfill). */
function splitSection(name: string): { grade: string; section: string } {
  const first = name.indexOf(' - ');
  const last = name.lastIndexOf(' - ');
  if (first >= 0) return { grade: name.slice(0, first).trim(), section: name.slice(last + 3).trim() };
  return { grade: name.trim(), section: '' };
}

/** Registers a section (auto-created by enrollment paths), deriving grade/section. */
async function upsertSectionRow(gradeSection: string): Promise<void> {
  const { grade, section } = splitSection(gradeSection);
  await db.execute(
    `INSERT INTO sections (grade_section, grade, section) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE grade = ?, section = ?`,
    [gradeSection, grade, section, grade, section],
  );
}

/**
 * Keeps a student's section in sync within a school year (the portal always
 * writes the CURRENT year). Mirrors electron/ipc.ts syncEnrollment: the
 * current year's enrollment is mirrored onto students.grade_section — the live
 * section attendance/SMS/reports read.
 */
async function syncEnrollment(studentId: number, section: string): Promise<void> {
  const year = await currentSchoolYearName();
  if (!year) return;
  if (section) {
    await upsertSectionRow(section);
    await db.execute(
      `INSERT INTO enrollments (student_id, school_year, grade_section) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE grade_section = ?`,
      [studentId, year, section, section],
    );
    await db.execute('UPDATE students SET grade_section = ? WHERE id = ?', [section, studentId]);
  } else {
    await db.execute('DELETE FROM enrollments WHERE student_id = ? AND school_year = ?', [studentId, year]);
    await db.execute("UPDATE students SET grade_section = '' WHERE id = ?", [studentId]);
  }
}

/** Computes the next auto-generated student number for the current year,
 *  e.g. "2026-0001" → "2026-0002" (mirrors electron/ipc.ts). */
async function generateStudentNo(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const [row] = await db.query<{ max_seq: number | null }[]>(
    `SELECT MAX(CAST(SUBSTRING(student_no, ?) AS UNSIGNED)) max_seq
     FROM students WHERE student_no LIKE ?`,
    [prefix.length + 1, `${prefix}%`],
  );
  const next = (row?.max_seq ?? 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// ---- Gating + scoping -------------------------------------------------------

/** Whether the admin has enabled teacher enrollment (settings table). */
export async function enrollmentEnabled(): Promise<boolean> {
  if (!db.isOnline()) return false;
  try {
    const rows = await db.query<{ setting_value: string }[]>(
      `SELECT setting_value FROM settings WHERE setting_key = 'teacher_enrollment_enabled' LIMIT 1`,
    );
    const v = String(rows[0]?.setting_value ?? '').trim().toLowerCase();
    return v === 'true' || v === '1';
  } catch {
    return false;
  }
}

async function assertEnabled(): Promise<void> {
  if (!(await enrollmentEnabled())) {
    throw new Error('Student enrollment is turned off. Ask the admin to enable it in the kiosk Settings.');
  }
}

/** The grade_sections the actor is mapped to for the current school year —
 *  their enrollment scope (both teachers and dept heads live in teacher_sections). */
async function actorSections(actor: PortalActor): Promise<string[]> {
  const year = await currentSchoolYearName();
  const rows = await db.query<{ grade_section: string }[]>(
    'SELECT grade_section FROM teacher_sections WHERE teacher_id = ? AND school_year = ?',
    [Number(actor.id), year],
  );
  return rows.map((r) => r.grade_section);
}

async function assertSectionScope(actor: PortalActor, section: string): Promise<void> {
  const sec = String(section ?? '').trim();
  if (!sec) throw new Error('A section is required.');
  const mine = await actorSections(actor);
  if (!mine.includes(sec)) {
    throw new Error('You can only enroll students in your own sections.');
  }
}

// ---- CRUD -------------------------------------------------------------------

/** Active students of one section (the section must be in the actor's scope). */
export async function listSectionStudents(section: string, actor: PortalActor): Promise<Student[]> {
  await assertEnabled();
  await assertSectionScope(actor, section);
  const rows = await db.query<StudentRow[]>(
    `SELECT * FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name`,
    [String(section ?? '')],
  );
  return rows.map(toStudent);
}

/** Creates a student in the actor's section (student_no auto-generated when blank). */
export async function enrollStudent(input: StudentInput, actor: PortalActor): Promise<Student> {
  await assertEnabled();
  const section = String(input?.grade_section ?? '').trim();
  await assertSectionScope(actor, section);
  const fullName = String(input?.full_name ?? '').trim();
  if (!fullName) throw new Error('Student name is required.');
  const studentNo = String(input?.student_no ?? '').trim() || (await generateStudentNo());
  // Guardian snapshot: when the form links a registered guardian, the registry
  // row's identity is copied onto the student (same as the kiosk's Add form);
  // otherwise fall back to the free-text name/address fields. The QR payload
  // hashes the guardian identity, so children sharing a guardian share one QR.
  let guardianId: number | null = null;
  let guardianName = String(input?.guardian_name ?? '').trim();
  let guardianAddress = String(input?.guardian_address ?? '').trim();
  let parentPhone = String(input?.parent_phone ?? '').trim();
  let guardianPayload: string | null = null;
  if (input?.guardian_id) {
    const g = await findGuardianById(Number(input.guardian_id));
    if (!g) throw new Error('Selected guardian no longer exists.');
    guardianId = g.id;
    guardianName = g.full_name;
    guardianAddress = g.address;
    parentPhone = g.mobile;
    guardianPayload = g.qr_hash_payload;
  }
  if (!guardianPayload && guardianName) {
    guardianPayload = generateGuardianPayload(guardianName, guardianAddress);
  }
  const res = await db.execute(
    `INSERT INTO students (student_no, qr_hash_payload, full_name, gender, grade_section, parent_phone,
                           lrn, guardian_name, guardian_address, guardian_qr_hash_payload, guardian_id,
                           photo_url, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      studentNo,
      generatePayload(studentNo),
      fullName,
      normalizeGender(input?.gender),
      section,
      parentPhone,
      String(input?.lrn ?? '').trim(),
      guardianName,
      guardianAddress,
      guardianPayload,
      guardianId,
      input?.photo_url || null,
      input?.is_active ?? true,
    ],
  );
  await syncEnrollment(res.insertId, section);
  const [row] = await db.query<StudentRow[]>('SELECT * FROM students WHERE id = ?', [res.insertId]);
  return toStudent(row);
}

/** Updates a student's profile fields (the section may move, but only inside
 *  the actor's own sections). Mirrors the kiosk's partial-update semantics. */
export async function updateEnrolledStudent(
  id: number,
  patch: Partial<StudentInput>,
  actor: PortalActor,
): Promise<Student> {
  await assertEnabled();
  const studentId = Number(id);
  const [existing] = await db.query<StudentRow[]>('SELECT * FROM students WHERE id = ?', [studentId]);
  if (!existing) throw new Error('Student not found.');
  // The student must currently belong to the actor's scope (or be moving into
  // one of the actor's sections from an empty section).
  const mine = await actorSections(actor);
  if (existing.grade_section && !mine.includes(existing.grade_section)) {
    throw new Error('This student is not in your sections.');
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, key: keyof StudentInput, fallback: unknown) => {
    if (key in patch) {
      sets.push(`${col} = ?`);
      params.push(patch[key] ?? fallback);
    }
  };
  add('student_no', 'student_no', '');
  add('full_name', 'full_name', '');
  add('lrn', 'lrn', '');
  add('photo_url', 'photo_url', null);
  // Legacy free-text guardian fields — skipped when the form sends
  // guardian_id (the registry link wins and the snapshot is derived below).
  const usesGuardianLink = 'guardian_id' in patch;
  if (!usesGuardianLink) {
    add('parent_phone', 'parent_phone', '');
    add('guardian_name', 'guardian_name', '');
    add('guardian_address', 'guardian_address', '');
  }
  if ('gender' in patch) {
    sets.push('gender = ?');
    params.push(normalizeGender(patch.gender));
  }
  if ('is_active' in patch) {
    sets.push('is_active = ?');
    params.push(patch.is_active ? 1 : 0);
  }
  // Guardian link lifecycle: linking a guardian copies its identity onto the
  // student; passing guardian_id: null clears the link (and with it the SMS
  // number + guardian QR — no guardian, no alerts). Mirrors the kiosk.
  if (usesGuardianLink) {
    const gid = patch.guardian_id ? Number(patch.guardian_id) : null;
    if (gid && Number.isInteger(gid)) {
      const g = await findGuardianById(gid);
      if (!g) throw new Error('Selected guardian no longer exists.');
      sets.push('guardian_id = ?', 'parent_phone = ?', 'guardian_name = ?', 'guardian_address = ?', 'guardian_qr_hash_payload = ?');
      params.push(g.id, g.mobile, g.full_name, g.address, g.qr_hash_payload);
    } else {
      sets.push('guardian_id = NULL', 'parent_phone = ?', 'guardian_name = ?', 'guardian_address = ?', 'guardian_qr_hash_payload = NULL');
      params.push('', '', '');
    }
  }
  // Legacy Guardian QR lifecycle: the payload hashes the identity (name +
  // address), so editing either re-issues it; clearing the name removes it.
  // Skipped when the form used the registry dropdown instead.
  if (!usesGuardianLink && ('guardian_name' in patch || 'guardian_address' in patch)) {
    const name = String(patch.guardian_name ?? existing.guardian_name ?? '').trim();
    const address = String(patch.guardian_address ?? existing.guardian_address ?? '').trim();
    if (name) {
      sets.push('guardian_qr_hash_payload = ?');
      params.push(generateGuardianPayload(name, address));
    } else {
      sets.push('guardian_qr_hash_payload = NULL');
    }
  }
  if (!sets.length && !('grade_section' in patch)) throw new Error('Nothing to update.');
  if (sets.length) {
    params.push(studentId);
    await db.execute(`UPDATE students SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  // Section move — only into the actor's own sections; keeps the enrollment row
  // + live section in sync for the current year.
  if ('grade_section' in patch) {
    const section = String(patch.grade_section ?? '').trim();
    if (section) await assertSectionScope(actor, section);
    await syncEnrollment(studentId, section);
  }
  const [row] = await db.query<StudentRow[]>('SELECT * FROM students WHERE id = ?', [studentId]);
  return toStudent(row);
}

/** Permanently removes a student (and their enrollments) — the same behavior
 *  as the kiosk's delete. Only students in the actor's sections are affected. */
export async function deleteEnrolledStudent(id: number, actor: PortalActor): Promise<void> {
  await assertEnabled();
  const studentId = Number(id);
  const [existing] = await db.query<StudentRow[]>('SELECT * FROM students WHERE id = ?', [studentId]);
  if (!existing) throw new Error('Student not found.');
  if (existing.grade_section) {
    const mine = await actorSections(actor);
    if (!mine.includes(existing.grade_section)) {
      throw new Error('This student is not in your sections.');
    }
  }
  await db.execute('DELETE FROM enrollments WHERE student_id = ?', [studentId]);
  await db.execute('DELETE FROM students WHERE id = ?', [studentId]);
}
