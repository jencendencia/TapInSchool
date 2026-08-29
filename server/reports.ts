// Report builders for the teacher app — a slim subset of TapIn School's
// report engine (electron/services/report.ts) with the same semantics:
//
//   - "school day" = a day the gate was used (≥1 scan anywhere that day)
//   - attendance rate = daysPresent / schoolDays × 100
//   - LATE / EARLY reuse the shared bell-time rules
//   - the register matrix is capped at 35 days (like the kiosk's SF2 export)
import { db } from '../electron/db/connection';
import { readBellSettings } from './settings';
import { computeScanFlag, minutesLate } from './bell-times';
import { addDays, fmtDay, parseDay } from '../shared/badge-windows';
import { currentSchoolYearName } from './school-year';
import type { EntryType } from '../shared/types';
import type {
  AbsenteeReport,
  AbsenteeReportRow,
  PerSectionReport,
  PerSectionRow,
  RegisterReport,
  RegisterRow,
  SectionReport,
  SectionReportRow,
  Sf1Report,
  Sf1Row,
  TardinessReport,
  TardinessRow,
} from './teacher-types';

/** Validates an inclusive YYYY-MM-DD range → [start, endExclusive) bounds. */
function bounds(from: string, to: string): { start: string; end: string } {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? String(from) : fmtDay(new Date());
  const t = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? String(to) : fmtDay(new Date());
  const start = f < t ? f : t;
  return { start, end: fmtDay(addDays(parseDay(t), 1)) };
}

/** Gate-used (school) days inside [start, endExclusive), ascending. */
async function schoolDays(start: string, end: string): Promise<string[]> {
  const rows = await db.query<{ d: string }[]>(
    'SELECT DISTINCT DATE(scanned_at) d FROM attendance_logs WHERE scanned_at >= ? AND scanned_at < ? ORDER BY d',
    [start, end],
  );
  return rows.map((r) => fmtDay(parseDay(r.d)));
}

interface ScanRow {
  student_id: number;
  student_no: string;
  full_name: string;
  entry_type: EntryType;
  scanned_at: string;
}

async function sectionScans(section: string, start: string, end: string): Promise<ScanRow[]> {
  return db.query<ScanRow[]>(
    `SELECT a.student_id, s.student_no, s.full_name, a.entry_type, a.scanned_at
     FROM attendance_logs a JOIN students s ON s.id = a.student_id
     WHERE s.grade_section = ? AND s.is_active = 1 AND a.scanned_at >= ? AND a.scanned_at < ?
     ORDER BY a.scanned_at`,
    [section, start, end],
  );
}

function scanDay(at: string): string {
  return String(at).slice(0, 10);
}
function scanTime(at: string): string {
  return String(at).slice(11, 16);
}

// ---- Per-student (section) report -------------------------------------------

export async function getSectionReport(section: string, from: string, to: string): Promise<SectionReport> {
  const { start, end } = bounds(from, to);
  const [days, students, scans, bell] = await Promise.all([
    schoolDays(start, end),
    db.query<{ id: number; student_no: string; full_name: string }[]>(
      'SELECT id, student_no, full_name FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name',
      [section],
    ),
    sectionScans(section, start, end),
    readBellSettings(),
  ]);
  const schoolDaysCount = days.length;

  const byStudent = new Map<number, ScanRow[]>();
  for (const sc of scans) {
    const list = byStudent.get(sc.student_id) ?? [];
    list.push(sc);
    byStudent.set(sc.student_id, list);
  }

  const rows: SectionReportRow[] = students.map((s) => {
    const list = byStudent.get(s.id) ?? [];
    const presentDays = new Set<string>();
    const lateDays = new Set<string>();
    let totalIn = 0;
    let totalOut = 0;
    let totalMinutesLate = 0;
    for (const sc of list) {
      const day = scanDay(sc.scanned_at);
      presentDays.add(day);
      if (sc.entry_type === 'IN') {
        totalIn++;
        if (computeScanFlag('IN', new Date(sc.scanned_at.replace(' ', 'T')), bell) === 'LATE') {
          lateDays.add(day);
          totalMinutesLate += minutesLate(new Date(sc.scanned_at.replace(' ', 'T')), bell);
        }
      } else {
        totalOut++;
      }
    }
    const daysPresent = presentDays.size;
    return {
      studentId: s.id,
      studentNo: s.student_no,
      fullName: s.full_name,
      daysPresent,
      daysLate: lateDays.size,
      daysAbsent: Math.max(0, schoolDaysCount - daysPresent),
      attendanceRate: schoolDaysCount > 0 ? Math.round((daysPresent / schoolDaysCount) * 1000) / 10 : null,
      totalIn,
      totalOut,
      totalMinutesLate,
    };
  });

  return { kind: 'section', section, from: start, to: String(to), schoolDays: schoolDaysCount, rows };
}

// ---- Per-section summary ------------------------------------------------------

export async function getPerSectionReport(sections: string[], from: string, to: string): Promise<PerSectionReport> {
  const { start, end } = bounds(from, to);
  const list = (Array.isArray(sections) ? sections : []).map((s) => String(s).trim()).filter(Boolean);
  const days = await schoolDays(start, end);
  const schoolDaysCount = days.length;
  if (!list.length) return { kind: 'per-section', sections: list, from: start, to: String(to), rows: [] };

  const placeholders = list.map(() => '?').join(',');
  const [enrolledRows, scans, bell] = await Promise.all([
    db.query<{ grade_section: string; c: number }[]>(
      `SELECT grade_section, COUNT(*) c FROM students
       WHERE is_active = 1 AND grade_section IN (${placeholders}) GROUP BY grade_section`,
      [...list],
    ),
    db.query<{ student_id: number; grade_section: string; entry_type: EntryType; scanned_at: string }[]>(
      `SELECT a.student_id, s.grade_section, a.entry_type, a.scanned_at
       FROM attendance_logs a JOIN students s ON s.id = a.student_id
       WHERE s.is_active = 1 AND s.grade_section IN (${placeholders})
         AND a.scanned_at >= ? AND a.scanned_at < ?`,
      [...list, start, end],
    ),
    readBellSettings(),
  ]);

  // Compute midpoint for AM/PM split
  const parseHM = (s: string) => { const parts = s.split(':').map(Number); return parts[0] * 60 + parts[1]; };
  const amOutMin = bell.am_time_out ? parseHM(bell.am_time_out) : NaN;
  let midMin = !Number.isNaN(amOutMin) ? amOutMin : 720;
  if (Number.isNaN(amOutMin)) {
    const amInMin = bell.am_time_in ? parseHM(bell.am_time_in) : NaN;
    const pmOutMin = bell.pm_time_out ? parseHM(bell.pm_time_out) : NaN;
    if (!Number.isNaN(amInMin) && !Number.isNaN(pmOutMin)) midMin = Math.round((amInMin + pmOutMin) / 2);
  }
  const midHH = String(Math.floor(midMin / 60)).padStart(2, '0');
  const midMM = String(midMin % 60).padStart(2, '0');
  const midStr = `${midHH}:${midMM}`;

  const enrolled = new Map(enrolledRows.map((r) => [r.grade_section, Number(r.c)]));
  const present = new Map<string, Set<number>>();
  const presentAm = new Map<string, Set<number>>();
  const presentPm = new Map<string, Set<number>>();
  const late = new Map<string, Set<number>>();
  const lateAm = new Map<string, Set<number>>();
  const latePm = new Map<string, Set<number>>();
  const early = new Map<string, Set<number>>();
  const earlyAm = new Map<string, Set<number>>();
  const earlyPm = new Map<string, Set<number>>();
  const totalIn = new Map<string, number>();
  const totalInAm = new Map<string, number>();
  const totalInPm = new Map<string, number>();
  const totalOut = new Map<string, number>();
  const totalOutAm = new Map<string, number>();
  const totalOutPm = new Map<string, number>();
  for (const sc of scans) {
    const sec = sc.grade_section;
    if (!present.has(sec)) present.set(sec, new Set());
    if (!late.has(sec)) late.set(sec, new Set());
    if (!early.has(sec)) early.set(sec, new Set());
    present.get(sec)!.add(sc.student_id);
    const scanTime = sc.scanned_at.slice(11, 16); // 'HH:MM'
    const isAm = scanTime < midStr;
    if (isAm) {
      if (!presentAm.has(sec)) presentAm.set(sec, new Set());
      presentAm.get(sec)!.add(sc.student_id);
    } else {
      if (!presentPm.has(sec)) presentPm.set(sec, new Set());
      presentPm.get(sec)!.add(sc.student_id);
    }
    const f = computeScanFlag(sc.entry_type, new Date(sc.scanned_at.replace(' ', 'T')), bell);
    if (f === 'LATE') {
      late.get(sec)!.add(sc.student_id);
      if (isAm) {
        if (!lateAm.has(sec)) lateAm.set(sec, new Set());
        lateAm.get(sec)!.add(sc.student_id);
      } else {
        if (!latePm.has(sec)) latePm.set(sec, new Set());
        latePm.get(sec)!.add(sc.student_id);
      }
    }
    if (f === 'EARLY') {
      early.get(sec)!.add(sc.student_id);
      if (isAm) {
        if (!earlyAm.has(sec)) earlyAm.set(sec, new Set());
        earlyAm.get(sec)!.add(sc.student_id);
      } else {
        if (!earlyPm.has(sec)) earlyPm.set(sec, new Set());
        earlyPm.get(sec)!.add(sc.student_id);
      }
    }
    totalIn.set(sec, (totalIn.get(sec) ?? 0) + (sc.entry_type === 'IN' ? 1 : 0));
    totalOut.set(sec, (totalOut.get(sec) ?? 0) + (sc.entry_type === 'OUT' ? 1 : 0));
    if (sc.entry_type === 'IN') {
      if (isAm) totalInAm.set(sec, (totalInAm.get(sec) ?? 0) + 1);
      else totalInPm.set(sec, (totalInPm.get(sec) ?? 0) + 1);
    } else {
      if (isAm) totalOutAm.set(sec, (totalOutAm.get(sec) ?? 0) + 1);
      else totalOutPm.set(sec, (totalOutPm.get(sec) ?? 0) + 1);
    }
  }

  const rows: PerSectionRow[] = list.map((sec) => {
    const presentCount = present.get(sec)?.size ?? 0;
    const enrolledCount = enrolled.get(sec) ?? 0;
    const presentAmCount = presentAm.get(sec)?.size ?? 0;
    const presentPmCount = presentPm.get(sec)?.size ?? 0;
    return {
      gradeSection: sec,
      enrolled: enrolledCount,
      present: presentCount,
      absent: Math.max(0, enrolledCount - presentCount),
      late: late.get(sec)?.size ?? 0,
      lateAm: lateAm.get(sec)?.size ?? 0,
      latePm: latePm.get(sec)?.size ?? 0,
      early: early.get(sec)?.size ?? 0,
      earlyAm: earlyAm.get(sec)?.size ?? 0,
      earlyPm: earlyPm.get(sec)?.size ?? 0,
      attendanceRate: schoolDaysCount > 0 ? Math.round((presentCount / enrolledCount / schoolDaysCount) * 100000) / 1000 : null,
      presentAm: presentAmCount,
      presentPm: presentPmCount,
      absentAm: Math.max(0, enrolledCount - presentAmCount),
      absentPm: Math.max(0, enrolledCount - presentPmCount),
      totalIn: totalIn.get(sec) ?? 0,
      totalInAm: totalInAm.get(sec) ?? 0,
      totalInPm: totalInPm.get(sec) ?? 0,
      totalOut: totalOut.get(sec) ?? 0,
      totalOutAm: totalOutAm.get(sec) ?? 0,
      totalOutPm: totalOutPm.get(sec) ?? 0,
    };
  });

  return { kind: 'per-section', sections: list, from: start, to: String(to), rows };
}

// ---- Absentee list -------------------------------------------------------------

export async function getAbsenteeReport(section: string, from: string, to: string): Promise<AbsenteeReport> {
  const { start, end } = bounds(from, to);
  const [days, students, scans] = await Promise.all([
    schoolDays(start, end),
    db.query<{ id: number; student_no: string; full_name: string }[]>(
      'SELECT id, student_no, full_name FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name',
      [section],
    ),
    sectionScans(section, start, end),
  ]);
  const present = new Set<string>();
  for (const sc of scans) present.add(`${sc.student_id}|${scanDay(sc.scanned_at)}`);
  const rows: AbsenteeReportRow[] = [];
  for (const day of days) {
    for (const s of students) {
      if (!present.has(`${s.id}|${day}`)) {
        rows.push({ studentId: s.id, studentNo: s.student_no, fullName: s.full_name, day });
      }
    }
  }
  return { kind: 'absentee', section, from: start, to: String(to), rows };
}

// ---- Tardiness list -------------------------------------------------------------

export async function getTardinessReport(section: string, from: string, to: string): Promise<TardinessReport> {
  const { start, end } = bounds(from, to);
  const [scans, bell] = await Promise.all([sectionScans(section, start, end), readBellSettings()]);
  const rows: TardinessRow[] = [];
  for (const sc of scans) {
    if (sc.entry_type !== 'IN') continue;
    const at = new Date(sc.scanned_at.replace(' ', 'T'));
    if (computeScanFlag('IN', at, bell) !== 'LATE') continue;
    rows.push({
      studentNo: sc.student_no,
      fullName: sc.full_name,
      day: scanDay(sc.scanned_at),
      scannedTime: scanTime(sc.scanned_at),
      minutesLate: minutesLate(at, bell),
    });
  }
  return { kind: 'tardiness', section, from: start, to: String(to), rows };
}

// ---- Register matrix (DepEd SF2 — School Form 2) -------------------------------
// Renders the official daily-attendance grid: one row per learner (LRN, name,
// sex), one column per school day, marks in the cells (blank = present,
// X = absent, L = tardy, E = excused), per-day M/F/combined total rows, plus
// the DepEd letterhead fields (school name, school year, month, section).

const REGISTER_MAX_DAYS = 35;

// Official SF2 weekday letters: S M T W TH F (S = Saturday/Sunday).
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'TH', 'F', 'S'];

async function readSchoolName(): Promise<string> {
  try {
    const rows = await db.query<{ setting_value: string }[]>(
      "SELECT setting_value FROM settings WHERE setting_key = 'school_name' LIMIT 1",
    );
    return rows[0]?.setting_value?.trim() || 'TapIn School';
  } catch {
    return 'TapIn School';
  }
}

function monthLabel(from: string, to: string): string {
  const f = parseDay(from);
  const t = parseDay(to);
  const fLabel = f.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) return fLabel;
  return `${fLabel} – ${t.toLocaleString('en-US', { month: 'long', year: 'numeric' })}`;
}

interface RegisterStudent {
  id: number;
  student_no: string;
  full_name: string;
  lrn: string;
  gender: string;
}

export async function getRegisterReport(section: string, from: string, to: string): Promise<RegisterReport> {
  const { start, end } = bounds(from, to);
  const [days, students, scans, excuses, bell, schoolName, schoolYear] = await Promise.all([
    schoolDays(start, end),
    db.query<RegisterStudent[]>(
      `SELECT id, student_no, full_name, lrn, gender FROM students
       WHERE grade_section = ? AND is_active = 1 ORDER BY full_name`,
      [section],
    ),
    sectionScans(section, start, end),
    db.query<{ student_id: number; excuse_date: string }[]>(
      'SELECT student_id, excuse_date FROM excuses WHERE excuse_date >= ? AND excuse_date < ?',
      [start, end],
    ),
    readBellSettings(),
    readSchoolName(),
    currentSchoolYearName(),
  ]);
  const capped = days.length > REGISTER_MAX_DAYS;
  const window = capped ? days.slice(-REGISTER_MAX_DAYS) : days;
  const windowSet = new Set(window);

  // Per (student, day): present (any scan) and tardy (late-flagged IN).
  const presentByKey = new Set<string>();
  const lateByKey = new Set<string>();
  for (const sc of scans) {
    const day = scanDay(sc.scanned_at);
    if (!windowSet.has(day)) continue;
    const key = `${sc.student_id}|${day}`;
    presentByKey.add(key);
    if (sc.entry_type === 'IN') {
      const at = new Date(sc.scanned_at.replace(' ', 'T'));
      if (computeScanFlag('IN', at, bell) === 'LATE') lateByKey.add(key);
    }
  }
  const excuseKeys = new Set(
    excuses
      .filter((e) => windowSet.has(fmtDay(parseDay(e.excuse_date))))
      .map((e) => `${e.student_id}|${fmtDay(parseDay(e.excuse_date))}`),
  );

  const perDayTotal = window.map(() => 0);
  const perDayMale = window.map(() => 0);
  const perDayFemale = window.map(() => 0);

  const rows: RegisterRow[] = students.map((s) => {
    const isMale = /^m/i.test(s.gender);
    const marks = window.map((day, i) => {
      const key = `${s.id}|${day}`;
      let mark = '';
      if (presentByKey.has(key)) {
        mark = lateByKey.has(key) ? 'L' : '';
        perDayTotal[i]++;
        if (isMale) perDayMale[i]++;
        else perDayFemale[i]++;
      } else if (excuseKeys.has(key)) {
        mark = 'E';
      } else {
        mark = 'X';
      }
      return mark;
    });
    const daysPresent = marks.filter((m) => m === '' || m === 'L').length;
    const daysLate = marks.filter((m) => m === 'L').length;
    const daysAbsent = marks.filter((m) => m === 'X').length;
    const daysExcused = marks.filter((m) => m === 'E').length;
    return {
      studentId: s.id,
      studentNo: s.student_no,
      lrn: s.lrn,
      fullName: s.full_name,
      sex: isMale ? 'M' : 'F',
      marks,
      daysPresent,
      daysLate,
      daysAbsent,
      daysExcused,
    };
  });

  return {
    kind: 'register',
    section,
    from: start,
    to: String(to),
    capped,
    days: window,
    dayLetters: window.map((d) => DAY_LETTERS[parseDay(d).getDay()]),
    perDayTotal,
    perDayMale,
    perDayFemale,
    schoolName,
    schoolYear,
    monthLabel: monthLabel(start, String(to)),
    rows,
  };
}

// ---- School Register (DepEd SF1) ---------------------------------------------
// A snapshot of the section's enrolled learners — no date range. Birthdate is
// the one official SF1 column we don't store, so it renders blank on the form.

export async function getSf1Report(section: string): Promise<Sf1Report> {
  const [students, schoolName, schoolYear] = await Promise.all([
    db.query<
      {
        id: number;
        student_no: string;
        full_name: string;
        lrn: string;
        gender: string;
        guardian_address: string;
        guardian_name: string;
        parent_phone: string;
      }[]
    >(
      `SELECT id, student_no, full_name, lrn, gender, guardian_address, guardian_name, parent_phone
       FROM students WHERE grade_section = ? AND is_active = 1 ORDER BY full_name`,
      [section],
    ),
    readSchoolName(),
    currentSchoolYearName(),
  ]);

  let male = 0;
  let female = 0;
  const rows: Sf1Row[] = students.map((s) => {
    const isMale = /^m/i.test(s.gender);
    if (isMale) male++;
    else female++;
    return {
      studentId: s.id,
      studentNo: s.student_no,
      lrn: s.lrn,
      fullName: s.full_name,
      sex: isMale ? 'M' : 'F',
      address: s.guardian_address,
      guardian: s.guardian_name,
      contact: s.parent_phone,
    };
  });

  return { kind: 'sf1', section, schoolName, schoolYear, rows, male, female };
}
