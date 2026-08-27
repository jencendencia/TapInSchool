// Subjects management + Subject-based attendance tracking for TapIn Teacher Companion.
// Handles CRUD for subjects, teacher-subject assignments, and per-subject attendance (SF2).
import { db } from '../electron/db/connection';

// ---- Types ----------------------------------------------------------------

export interface Subject {
  id: number;
  subject_code: string;
  subject_name: string;
  grade_level: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubjectInput {
  subject_code: string;
  subject_name: string;
  grade_level?: string;
  description?: string;
  is_active?: boolean;
}

export interface TeacherSubject {
  id: number;
  teacher_id: number;
  subject_id: number;
  grade_section: string;
  school_year: string;
  created_at: string;
}

export interface TeacherSubjectInput {
  subject_id: number;
  grade_section: string;
  school_year?: string;
}

export interface SubjectAttendanceRow {
  id: number;
  student_id: number;
  subject_id: number;
  teacher_subject_id: number;
  attendance_date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'TARDY';
  time_in: string | null;
  time_out: string | null;
  remarks: string;
  recorded_by: number | null;
  source: 'GATE_SCAN' | 'MANUAL' | 'AUTO';
  created_at: string;
}

export interface SubjectAttendanceInput {
  student_id: number;
  subject_id: number;
  attendance_date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'TARDY';
  time_in?: string | null;
  time_out?: string | null;
  remarks?: string;
}

export interface SubjectAttendanceRoster {
  studentId: number;
  studentNo: string;
  fullName: string;
  gender: string;
  gradeSection: string;
  lrn: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'TARDY' | 'NOT_MARKED';
  timeIn: string | null;
  timeOut: string | null;
  remarks: string;
}

export interface SubjectSf2Report {
  section: string;
  subjectId: number;
  subjectName: string;
  subjectCode: string;
  schoolYear: string;
  monthLabel: string;
  from: string;
  to: string;
  days: string[];
  dayLetters: string[];
  students: {
    id: number;
    studentNo: string;
    lrn: string;
    fullName: string;
    sex: string;
  }[];
  marks: { studentId: number; marks: string[]; present: number; absent: number; late: number; excused: number }[];
  perDayPresent: number[];
  perDayAbsent: number[];
}

// ---- Subjects CRUD --------------------------------------------------------

export async function listSubjects(search?: string): Promise<Subject[]> {
  if (search) {
    const like = `%${search}%`;
    return db.query<Subject[]>(
      'SELECT * FROM subjects WHERE (subject_code LIKE ? OR subject_name LIKE ? OR grade_level LIKE ?) AND is_active = 1 ORDER BY grade_level, subject_name',
      [like, like, like],
    );
  }
  return db.query<Subject[]>(
    'SELECT * FROM subjects WHERE is_active = 1 ORDER BY grade_level, subject_name',
  );
}

export async function getSubject(id: number): Promise<Subject | null> {
  const rows = await db.query<Subject[]>('SELECT * FROM subjects WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function createSubject(input: SubjectInput): Promise<Subject> {
  const code = String(input.subject_code ?? '').trim();
  const name = String(input.subject_name ?? '').trim();
  if (!code || !name) throw new Error('Subject code and name are required.');
  const gradeLevel = String(input.grade_level ?? '').trim();
  const description = String(input.description ?? '').trim();
  const res = await db.execute(
    `INSERT INTO subjects (subject_code, subject_name, grade_level, description, is_active)
     VALUES (?, ?, ?, ?, ?)`,
    [code, name, gradeLevel, description, input.is_active ?? true],
  );
  const [row] = await db.query<Subject[]>('SELECT * FROM subjects WHERE id = ?', [res.insertId]);
  return row;
}

export async function updateSubject(id: number, patch: Partial<SubjectInput>): Promise<Subject> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if ('subject_code' in patch) { sets.push('subject_code = ?'); params.push(String(patch.subject_code ?? '').trim()); }
  if ('subject_name' in patch) { sets.push('subject_name = ?'); params.push(String(patch.subject_name ?? '').trim()); }
  if ('grade_level' in patch) { sets.push('grade_level = ?'); params.push(String(patch.grade_level ?? '').trim()); }
  if ('description' in patch) { sets.push('description = ?'); params.push(String(patch.description ?? '').trim()); }
  if ('is_active' in patch) { sets.push('is_active = ?'); params.push(patch.is_active ? 1 : 0); }
  if (!sets.length) throw new Error('Nothing to update.');
  params.push(id);
  await db.execute(`UPDATE subjects SET ${sets.join(', ')} WHERE id = ?`, params);
  const [row] = await db.query<Subject[]>('SELECT * FROM subjects WHERE id = ?', [id]);
  return row;
}

export async function deleteSubject(id: number): Promise<void> {
  await db.execute('UPDATE subjects SET is_active = 0 WHERE id = ?', [id]);
}

// ---- Teacher-Subject Assignments -------------------------------------------

export async function listTeacherSubjects(teacherId: number, schoolYear?: string): Promise<(TeacherSubject & { subject_name: string; subject_code: string })[]> {
  const year = String(schoolYear ?? '').trim();
  if (year) {
    return db.query(
      `SELECT ts.*, s.subject_name, s.subject_code
       FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
       WHERE ts.teacher_id = ? AND ts.school_year = ?
       ORDER BY s.subject_name, ts.grade_section`,
      [teacherId, year],
    );
  }
  return db.query(
    `SELECT ts.*, s.subject_name, s.subject_code
     FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
     WHERE ts.teacher_id = ?
     ORDER BY s.subject_name, ts.grade_section`,
    [teacherId],
  );
}

export async function assignTeacherSubject(teacherId: number, input: TeacherSubjectInput, schoolYear?: string): Promise<TeacherSubject> {
  const [cur] = await db.query<{ name: string }[]>(
    'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
  );
  const year = String(schoolYear ?? '').trim() || (cur?.name ?? '');
  const section = String(input.grade_section ?? '').trim();
  if (!input.subject_id || !section) throw new Error('Subject and section are required.');
  await db.execute(
    `INSERT INTO teacher_subjects (teacher_id, subject_id, grade_section, school_year)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [teacherId, input.subject_id, section, year],
  );
  const rows = await db.query<TeacherSubject[]>(
    'SELECT * FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ? AND grade_section = ? AND school_year = ?',
    [teacherId, input.subject_id, section, year],
  );
  return rows[0];
}

export async function removeTeacherSubject(id: number): Promise<void> {
  await db.execute('DELETE FROM teacher_subjects WHERE id = ?', [id]);
}

// ---- Subject Attendance (per-subject SF2) ----------------------------------

/** Get or find the teacher_subjects row for a teacher+subject+section. */
async function findTeacherSubject(teacherId: number, subjectId: number, gradeSection: string, schoolYear?: string): Promise<TeacherSubject | null> {
  const [cur] = await db.query<{ name: string }[]>(
    'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
  );
  const year = String(schoolYear ?? '').trim() || (cur?.name ?? '');
  const rows = await db.query<TeacherSubject[]>(
    'SELECT * FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ? AND grade_section = ? AND school_year = ?',
    [teacherId, subjectId, gradeSection, year],
  );
  return rows[0] ?? null;
}

/** Mark or update a single student's attendance for a subject on a date. */
export async function markSubjectAttendance(
  teacherId: number,
  input: SubjectAttendanceInput,
  schoolYear?: string,
): Promise<SubjectAttendanceRow> {
  // Find or create the teacher_subjects row
  const subject = await db.query<{ grade_section: string }[]>(
    'SELECT ts.grade_section FROM teacher_subjects ts WHERE ts.subject_id = ? AND ts.teacher_id = ? LIMIT 1',
    [input.subject_id, teacherId],
  );
  const section = subject[0]?.grade_section ?? '';
  const ts = await findTeacherSubject(teacherId, input.subject_id, section, schoolYear);
  if (!ts) throw new Error('You are not assigned to teach this subject in this section.');

  const date = String(input.attendance_date ?? '').trim();
  const status = String(input.status ?? 'PRESENT').toUpperCase();
  const timeIn = input.time_in ?? null;
  const timeOut = input.time_out ?? null;
  const remarks = String(input.remarks ?? '').trim();

  await db.execute(
    `INSERT INTO subject_attendance (student_id, subject_id, teacher_subject_id, attendance_date, status, time_in, time_out, remarks, recorded_by, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL')
     ON DUPLICATE KEY UPDATE status = VALUES(status), time_in = VALUES(time_in), time_out = VALUES(time_out), remarks = VALUES(remarks), recorded_by = VALUES(recorded_by)`,
    [input.student_id, input.subject_id, ts.id, date, status, timeIn, timeOut, remarks, teacherId],
  );
  const rows = await db.query<SubjectAttendanceRow[]>(
    'SELECT * FROM subject_attendance WHERE student_id = ? AND subject_id = ? AND attendance_date = ?',
    [input.student_id, input.subject_id, date],
  );
  return rows[0];
}

/** Mark attendance for multiple students at once (teacher marks a whole class). */
export async function markBulkSubjectAttendance(
  teacherId: number,
  subjectId: number,
  attendanceDate: string,
  marks: { student_id: number; status: string; remarks?: string }[],
  schoolYear?: string,
): Promise<number> {
  const subject = await db.query<{ grade_section: string }[]>(
    'SELECT ts.grade_section FROM teacher_subjects ts WHERE ts.subject_id = ? AND ts.teacher_id = ? LIMIT 1',
    [subjectId, teacherId],
  );
  const section = subject[0]?.grade_section ?? '';
  const ts = await findTeacherSubject(teacherId, subjectId, section, schoolYear);
  if (!ts) throw new Error('You are not assigned to teach this subject in this section.');

  let count = 0;
  for (const m of marks) {
    const status = String(m.status ?? 'PRESENT').toUpperCase();
    const remarks = String(m.remarks ?? '').trim();
    await db.execute(
      `INSERT INTO subject_attendance (student_id, subject_id, teacher_subject_id, attendance_date, status, remarks, recorded_by, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL')
       ON DUPLICATE KEY UPDATE status = VALUES(status), remarks = VALUES(remarks), recorded_by = VALUES(recorded_by)`,
      [m.student_id, subjectId, ts.id, attendanceDate, status, remarks, teacherId],
    );
    count++;
  }
  return count;
}

/** Get the attendance roster for a subject on a specific date. */
export async function getSubjectRoster(
  subjectId: number,
  gradeSection: string,
  date: string,
  _schoolYear?: string,
): Promise<SubjectAttendanceRoster[]> {
  const [students, attendances] = await Promise.all([
    db.query<{ id: number; student_no: string; full_name: string; gender: string; grade_section: string; lrn: string }[]>(
      `SELECT id, student_no, full_name, gender, grade_section, lrn
       FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name`,
      [gradeSection],
    ),
    db.query<SubjectAttendanceRow[]>(
      `SELECT * FROM subject_attendance
       WHERE subject_id = ? AND attendance_date = ?
       AND student_id IN (SELECT id FROM students WHERE grade_section = ? AND is_active = 1)`,
      [subjectId, date, gradeSection],
    ),
  ]);

  const attMap = new Map<number, SubjectAttendanceRow>();
  for (const a of attendances) attMap.set(a.student_id, a);

  return students.map((s) => {
    const att = attMap.get(s.id);
    return {
      studentId: s.id,
      studentNo: s.student_no,
      fullName: s.full_name,
      gender: s.gender,
      gradeSection: s.grade_section,
      lrn: s.lrn,
      status: att?.status ?? 'NOT_MARKED',
      timeIn: att?.time_in ?? null,
      timeOut: att?.time_out ?? null,
      remarks: att?.remarks ?? '',
    };
  });
}

/** Generate SF2-style report for a subject within a date range. */
export async function getSubjectSf2(
  subjectId: number,
  gradeSection: string,
  from: string,
  to: string,
  schoolYear?: string,
): Promise<SubjectSf2Report> {
  const subject = await db.query<{ subject_code: string; subject_name: string }[]>(
    'SELECT subject_code, subject_name FROM subjects WHERE id = ?',
    [subjectId],
  );
  const sub = subject[0] ?? { subject_code: '', subject_name: '' };

  const [cur] = await db.query<{ name: string }[]>(
    'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
  );
  const year = String(schoolYear ?? '').trim() || (cur?.name ?? '');

  // Get school days (days with attendance records in this range)
  const dayRows = await db.query<{ d: string }[]>(
    `SELECT DISTINCT attendance_date d FROM subject_attendance
     WHERE subject_id = ? AND attendance_date >= ? AND attendance_date <= ?
     ORDER BY attendance_date`,
    [subjectId, from, to],
  );
  const days = dayRows.map((r) => String(r.d).slice(0, 10));

  // Get students
  const students = await db.query<{ id: number; student_no: string; lrn: string; full_name: string; gender: string }[]>(
    `SELECT id, student_no, lrn, full_name, gender
     FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name`,
    [gradeSection],
  );

  // Get all attendance records in range
  const attendances = await db.query<{ student_id: number; attendance_date: string; status: string }[]>(
    `SELECT student_id, DATE_FORMAT(attendance_date, '%Y-%m-%d') attendance_date, status
     FROM subject_attendance
     WHERE subject_id = ? AND attendance_date >= ? AND attendance_date <= ?`,
    [subjectId, from, to],
  );

  const attMap = new Map<string, string>();
  for (const a of attendances) {
    attMap.set(`${a.student_id}_${String(a.attendance_date).slice(0, 10)}`, a.status);
  }

  // Build marks matrix
  const marks = students.map((s) => {
    const studentMarks: string[] = [];
    let present = 0, absent = 0, late = 0, excused = 0;
    for (const day of days) {
      const status = attMap.get(`${s.id}_${day}`) ?? '';
      let mark = 'X'; // default absent
      if (status === 'PRESENT') { mark = ''; present++; }
      else if (status === 'ABSENT') { mark = 'X'; absent++; }
      else if (status === 'LATE') { mark = 'L'; late++; present++; }
      else if (status === 'EXCUSED') { mark = 'E'; excused++; }
      else if (status === 'TARDY') { mark = 'T'; late++; present++; }
      else { mark = 'X'; absent++; } // not marked = absent
      studentMarks.push(mark);
    }
    return { studentId: s.id, marks: studentMarks, present, absent, late, excused };
  });

  const perDayPresent = days.map((_, i) => marks.filter((m) => m.marks[i] !== 'X').length);
  const perDayAbsent = days.map((_, i) => marks.filter((m) => m.marks[i] === 'X').length);

  // Day letters (M T W TH F SA SU)
  const dayLetters = days.map((d) => {
    const dow = new Date(d).getDay();
    return ['S', 'M', 'T', 'W', 'TH', 'F', 'SA'][dow] ?? '';
  });

  const monthLabel = (() => {
    if (days.length === 0) return '';
    const first = new Date(days[0]);
    const last = new Date(days[days.length - 1]);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (first.getMonth() === last.getMonth()) return `${months[first.getMonth()]} ${first.getFullYear()}`;
    return `${months[first.getMonth()]} – ${months[last.getMonth()]} ${first.getFullYear()}`;
  })();

  return {
    section: gradeSection,
    subjectId,
    subjectName: sub.subject_name,
    subjectCode: sub.subject_code,
    schoolYear: year,
    monthLabel,
    from,
    to,
    days,
    dayLetters,
    students: students.map((s) => ({ id: s.id, studentNo: s.student_no, lrn: s.lrn, fullName: s.full_name, sex: s.gender === 'male' ? 'M' : 'F' })),
    marks,
    perDayPresent,
    perDayAbsent,
  };
}

/** Get attendance summary for a subject (for quick overview). */
export async function getSubjectAttendanceSummary(
  subjectId: number,
  gradeSection: string,
  from: string,
  to: string,
): Promise<{
  totalStudents: number;
  totalSchoolDays: number;
  avgAttendanceRate: number;
  students: { studentId: number; fullName: string; present: number; absent: number; late: number; rate: number }[];
}> {
  const students = await db.query<{ id: number; full_name: string }[]>(
    `SELECT id, full_name FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name`,
    [gradeSection],
  );

  const dayCount = await db.query<{ c: number }[]>(
    `SELECT COUNT(DISTINCT attendance_date) c FROM subject_attendance
     WHERE subject_id = ? AND attendance_date >= ? AND attendance_date <= ?`,
    [subjectId, from, to],
  );

  const attendances = await db.query<{ student_id: number; status: string }[]>(
    `SELECT student_id, status FROM subject_attendance
     WHERE subject_id = ? AND attendance_date >= ? AND attendance_date <= ?`,
    [subjectId, from, to],
  );

  const byStudent = new Map<number, { present: number; absent: number; late: number }>();
  for (const a of attendances) {
    const cur = byStudent.get(a.student_id) ?? { present: 0, absent: 0, late: 0 };
    if (a.status === 'PRESENT') cur.present++;
    else if (a.status === 'ABSENT') cur.absent++;
    else if (a.status === 'LATE' || a.status === 'TARDY') { cur.late++; cur.present++; }
    else if (a.status === 'EXCUSED') { /* excused counts as present */ cur.present++; }
    byStudent.set(a.student_id, cur);
  }

  const totalSchoolDays = dayCount[0]?.c ?? 0;
  const studentStats = students.map((s) => {
    const stats = byStudent.get(s.id) ?? { present: 0, absent: 0, late: 0 };
    const rate = totalSchoolDays > 0 ? Math.round((stats.present / totalSchoolDays) * 100) : 0;
    return { studentId: s.id, fullName: s.full_name, ...stats, rate };
  });

  const avgAttendanceRate = students.length > 0
    ? Math.round(studentStats.reduce((sum, s) => sum + s.rate, 0) / students.length)
    : 0;

  return {
    totalStudents: students.length,
    totalSchoolDays,
    avgAttendanceRate,
    students: studentStats,
  };
}
