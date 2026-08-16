// Attendance reads + the teacher manual check-in/out write path.
//
// Everything reads the SHARED tables (students, attendance_logs) exactly as
// the kiosk writes them. Flags (LATE / EARLY) reuse the same bell-time rules
// as the kiosk. Manual check-ins are written with source='MANUAL' and NEVER
// queue an SMS — teacher-initiated marks shouldn't double-notify parents.
import { db } from '../electron/db/connection';
import { readBellSettings } from './settings';
import { computeScanFlag } from './bell-times';
import { addDays, fmtDay, parseDay } from '../shared/badge-windows';
import type { EntryType } from '../shared/types';
import type { ManualCheckResult, RosterStudent, SectionTodayStats, StudentScan } from './teacher-types';

/** Inclusive [start, end) day window: 'YYYY-MM-DD' bounds for `date` (default today). */
export function dayRange(date?: string): { start: string; end: string } {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseDay(date) : new Date();
  return { start: fmtDay(d), end: fmtDay(addDays(d, 1)) };
}

interface ScanDbRow {
  id: number;
  student_id: number;
  entry_type: EntryType;
  scanned_at: string;
  source: string;
}

/** Parses a MySQL TIMESTAMP string (e.g. '2026-08-16 08:32:11.123') into a
 *  local Date plus 'HH:MM'. The string has no timezone, so it is local by
 *  construction — same as the kiosk's display. */
function parseScan(at: string): { date: Date; time: string } {
  const date = new Date(at.replace(' ', 'T'));
  return { date, time: String(at).slice(11, 16) };
}

/** Full section roster with a day's scans, first IN / last OUT, and flags. */
export async function getRoster(section: string, date?: string): Promise<RosterStudent[]> {
  const { start, end } = dayRange(date);
  const [students, rows] = await Promise.all([
    db.query<{ id: number; student_no: string; full_name: string; gender: string; grade_section: string; lrn: string; photo_url: string | null }[]>(
      `SELECT id, student_no, full_name, gender, grade_section, lrn, photo_url
       FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name`,
      [section],
    ),
    db.query<ScanDbRow[]>(
      `SELECT a.id, a.student_id, a.entry_type, a.scanned_at, a.source
       FROM attendance_logs a JOIN students s ON s.id = a.student_id
       WHERE s.grade_section = ? AND s.is_active = 1 AND a.scanned_at >= ? AND a.scanned_at < ?
       ORDER BY a.scanned_at`,
      [section, start, end],
    ),
  ]);
  const bell = await readBellSettings();
  const byStudent = new Map<number, StudentScan[]>();
  for (const r of rows) {
    const { date: at, time } = parseScan(r.scanned_at);
    const list = byStudent.get(r.student_id) ?? [];
    list.push({
      id: r.id,
      time,
      entryType: r.entry_type,
      flag: computeScanFlag(r.entry_type, at, bell),
      source: r.source as StudentScan['source'],
    });
    byStudent.set(r.student_id, list);
  }
  return students.map((s) => {
    const scans = (byStudent.get(s.id) ?? []).sort((a, b) => (a.time < b.time ? -1 : 1));
    const firstIn = scans.find((x) => x.entryType === 'IN')?.time ?? null;
    const lastOut = [...scans].reverse().find((x) => x.entryType === 'OUT')?.time ?? null;
    return {
      id: s.id,
      student_no: s.student_no,
      full_name: s.full_name,
      gender: s.gender,
      grade_section: s.grade_section,
      lrn: s.lrn,
      photo_url: s.photo_url,
      scans,
      present: scans.length > 0,
      firstIn,
      lastOut,
      late: scans.some((x) => x.flag === 'LATE'),
      early: scans.some((x) => x.flag === 'EARLY'),
    };
  });
}

/** One student's scans on a day, oldest first. */
export async function getStudentDay(studentId: number, date?: string): Promise<StudentScan[]> {
  const { start, end } = dayRange(date);
  const rows = await db.query<ScanDbRow[]>(
    'SELECT id, entry_type, scanned_at, source FROM attendance_logs WHERE student_id = ? AND scanned_at >= ? AND scanned_at < ? ORDER BY scanned_at',
    [Number(studentId), start, end],
  );
  const bell = await readBellSettings();
  return rows.map((r) => {
    const { date: at, time } = parseScan(r.scanned_at);
    return { id: r.id, time, entryType: r.entry_type, flag: computeScanFlag(r.entry_type, at, bell), source: r.source as StudentScan['source'] };
  });
}

/** Today's IN/OUT summary for a section (flags resolved with bell settings). */
export async function sectionTodayStats(section: string): Promise<SectionTodayStats> {
  const { start, end } = dayRange();
  const [enrolledRows, rows] = await Promise.all([
    db.query<{ c: number }[]>(
      'SELECT COUNT(*) c FROM students WHERE grade_section = ? AND is_active = 1',
      [section],
    ),
    db.query<{ student_id: number; entry_type: EntryType; scanned_at: string }[]>(
      `SELECT a.student_id, a.entry_type, a.scanned_at
       FROM attendance_logs a JOIN students s ON s.id = a.student_id
       WHERE s.grade_section = ? AND s.is_active = 1 AND a.scanned_at >= ? AND a.scanned_at < ?`,
      [section, start, end],
    ),
  ]);
  const bell = await readBellSettings();
  const present = new Set<number>();
  const late = new Set<number>();
  const early = new Set<number>();
  for (const r of rows) {
    present.add(r.student_id);
    const f = computeScanFlag(r.entry_type, parseScan(r.scanned_at).date, bell);
    if (f === 'LATE') late.add(r.student_id);
    if (f === 'EARLY') early.add(r.student_id);
  }
  const enrolled = Number(enrolledRows[0]?.c ?? 0);
  return {
    enrolled,
    present: present.size,
    absent: Math.max(0, enrolled - present.size),
    late: late.size,
    early: early.size,
    scans: rows.length,
  };
}

/**
 * Manual check-in/out. Toggles on the student's LAST scan of the day (IN →
 * OUT, otherwise IN) — the same rule the kiosk applies to QR scans. Writes
 * attendance_logs with source 'MANUAL'; no SMS is queued.
 */
export async function manualCheckIn(studentId: number): Promise<ManualCheckResult> {
  if (!db.isOnline()) return { ok: false, error: 'Database offline — cannot check in.' };
  const id = Number(studentId);
  if (!Number.isInteger(id)) return { ok: false, error: 'Invalid student.' };
  const [stud] = await db.query<{ is_active: number }[]>(
    'SELECT is_active FROM students WHERE id = ?',
    [id],
  );
  if (!stud) return { ok: false, error: 'Student not found.' };
  if (!stud.is_active) return { ok: false, error: 'Student is inactive (access restricted).' };

  const { start } = dayRange();
  const [last] = await db.query<{ entry_type: EntryType }[]>(
    `SELECT entry_type FROM attendance_logs
     WHERE student_id = ? AND scanned_at >= ? ORDER BY scanned_at DESC LIMIT 1`,
    [id, start],
  );
  const entryType: EntryType = last?.entry_type === 'IN' ? 'OUT' : 'IN';
  const res = await db.execute(
    "INSERT INTO attendance_logs (student_id, entry_type, source) VALUES (?, ?, 'MANUAL')",
    [id, entryType],
  );
  const [row] = await db.query<{ scanned_at: string }[]>(
    'SELECT scanned_at FROM attendance_logs WHERE id = ?',
    [res.insertId],
  );
  const at = row?.scanned_at ?? new Date().toISOString();
  const bell = await readBellSettings();
  return {
    ok: true,
    entryType,
    flag: computeScanFlag(entryType, parseScan(at).date, bell),
    time: String(at).slice(11, 16),
  };
}
