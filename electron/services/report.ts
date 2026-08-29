// Attendance report data (admin → Reports tab). Implements REPORTS_PLAN.md
// Tier 1: an extended summary (attendance %, ADA, on-time %, at-risk count) plus
// per-type payloads — per-student summary, per-section rollup, the SF2-style
// register matrix (≤35 days), absentee list, tardiness detail, SMS audit and
// trends. Only the payload matching the requested type is populated so IPC
// payloads stay bounded; the summary + daily tables are always computed.
//
// Attendance semantics (decided in REPORTS_PLAN.md §2):
//   - present day  = student has ≥1 scan that day
//   - absent day   = active student with zero scans on a gate-used (school) day
//   - school day   = a day in range with ≥1 scan anywhere
//   - attendance%  = Σ daily present / (activeStudents × schoolDays)
// Late/early use the same flagCutoffs() as the live scan path.
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { flagCutoffs } from './bell-times';
import type {
  AbsenteeRow,
  AbsenteeTotalsRow,
  PerSectionRow,
  PerStudentRow,
  RegisterRow,
  ReportData,
  ReportDrilldownMetric,
  ReportDrilldownQuery,
  ReportDrilldownResult,
  ReportDrilldownRow,
  ReportQuery,
  ReportRegister,
  ReportTrends,
  SchoolRegisterRow,
  SchoolRegisterSection,
  SmsAuditDay,
  SmsFailureRow,
  SmsStatus,
  StudentDayRow,
  StudentRecord,
  StudentScanRow,
  TardinessFrequencyRow,
  TardinessRow,
} from '../../shared/types';

const MAX_RANGE_DAYS = 400;
/** The register matrix is capped at 35 days (one month-ish) per REPORTS_PLAN. */
const REGISTER_MAX_DAYS = 35;
/** Row cap for per-scan detail lists so IPC payloads stay small. */
const DETAIL_ROW_CAP = 3000;
/** SMS audit failure rows cap. */
const SMS_FAILURE_CAP = 500;

function parseDay(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function maskPhone(phone: string): string {
  // Same format as the renderer's mockMaskPhone so Electron and demo output
  // match: keep the first 5 digits (+63 area) and the last 2.
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 7) return phone || '';
  return `+${digits.slice(0, 5)}*****${digits.slice(-2)}`;
}

/** Numeric grade extracted from a "Grade 7 - Section A" label ("7"). */
function gradeNum(label: string): number {
  const n = Number.parseInt(String(label || '').replace(/\D+/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * MySQL expression ordering a section label by its numeric grade so reports
 * read Grade 7 → 8 → … → 11 instead of the lexical "Grade 10"-before-"Grade 7"
 * ordering. "Grade 7 - Section A" → SUBSTRING_INDEX(' ' 2) = "Grade 7" →
 * last token "7" → CAST UNSIGNED.
 */
function gradeOrd(sqlExpr: string): string {
  return `CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(${sqlExpr}, ' ', 2), ' ', -1) AS UNSIGNED)`;
}

export async function getReportData(query: ReportQuery): Promise<ReportData> {
  const settings = settingsStore.get();
  const today = fmtDay(new Date());
  const type = query?.type ?? 'summary';
  const section = (query?.section ?? '').trim() || '';
  const maskPhones = !!query?.maskPhones;

  let from = parseDay(query?.from) ?? parseDay(today)!;
  let to = parseDay(query?.to) ?? from;
  if (from.getTime() > to.getTime()) [from, to] = [to, from];
  // Cap the range so a typo can't produce a giant report (or a huge loop).
  if (to.getTime() - from.getTime() > (MAX_RANGE_DAYS - 1) * 86400000) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
  }
  const fromStr = fmtDay(from);
  const toStr = fmtDay(to);
  const fromDt = `${fromStr} 00:00:00`;
  const toDt = `${toStr} 23:59:59`;
  const { late, early } = flagCutoffs(settings);
  const schoolYear = (query?.schoolYear ?? '').trim();
  // Section groupings reflect the SELECTED school year's enrollments: each
  // student appears under the section they were enrolled in that year, falling
  // back to their live section (students.grade_section = current year) when no
  // enrollment exists for the year (e.g. pre-backfill installs). Empty year =
  // current sections (the original behavior).
  const yearJoin = schoolYear
    ? `LEFT JOIN enrollments e ON e.student_id = s.id AND e.school_year = ?`
    : '';
  const yearParams: unknown[] = schoolYear ? [schoolYear] : [];
  const secExpr = schoolYear ? `COALESCE(NULLIF(e.grade_section, ''), s.grade_section)` : 's.grade_section';
  const sectionWhere = section ? ` AND ${secExpr} = ?` : '';
  const sectionParams: unknown[] = section ? [section] : [];

  const count = async (sql: string, params?: unknown[]): Promise<number> => {
    const [row] = await db.query<{ c: number }[]>(sql, params);
    return row?.c ?? 0;
  };

  // ---- Always-computed pieces (summary + daily) ---------------------------
  const sectionsRows = await db.query<{ grade_section: string }[]>(
    schoolYear
      ? `SELECT DISTINCT ${secExpr} grade_section FROM students s ${yearJoin}
         WHERE ${secExpr} <> ''`
      : `SELECT DISTINCT grade_section FROM students WHERE grade_section <> ''`,
    schoolYear ? [...yearParams] : [],
  );
  // Sort in JS: MySQL rejects ORDER BY on an expression not in the select list
  // when DISTINCT is used (error 3065), so the numeric-grade ordering happens
  // here on the bounded result set.
  const sections = sectionsRows.map((r) => r.grade_section).sort((a, b) => gradeNum(a) - gradeNum(b) || a.localeCompare(b));

  const activeStudents = await count('SELECT COUNT(*) c FROM students WHERE is_active = 1');

  // Distinct present students per day — drives schoolDays, ADA, rates, trends.
  const dayPresence = await db.query<{ day: string; present: number }[]>(
    `SELECT DATE_FORMAT(scanned_at, '%Y-%m-%d') day, COUNT(DISTINCT student_id) present
     FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(scanned_at, '%Y-%m-%d')`,
    [fromDt, toDt],
  );
  const presentByDay = new Map(dayPresence.map((r) => [r.day, r.present]));
  const schoolDays = dayPresence.length;
  const sumPresent = dayPresence.reduce((s, r) => s + r.present, 0);
  const ada = schoolDays > 0 ? sumPresent / schoolDays : null;
  const attendanceRate =
    schoolDays > 0 && activeStudents > 0 ? (sumPresent / (activeStudents * schoolDays)) * 100 : null;

  const [scanRow] = await db.query<{ c: number; ins: number; outs: number }[]>(
    `SELECT COUNT(*) c, COALESCE(SUM(entry_type = 'IN'), 0) ins, COALESCE(SUM(entry_type = 'OUT'), 0) outs
     FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?`,
    [fromDt, toDt],
  );
  const totalIn = scanRow?.ins ?? 0;
  const lateTotal = late
    ? await count(
        `SELECT COUNT(*) c FROM attendance_logs
         WHERE scanned_at BETWEEN ? AND ? AND entry_type = 'IN' AND TIME(scanned_at) > ?`,
        [fromDt, toDt, late],
      )
    : 0;
  const earlyTotal = early
    ? await count(
        `SELECT COUNT(*) c FROM attendance_logs
         WHERE scanned_at BETWEEN ? AND ? AND entry_type = 'OUT' AND TIME(scanned_at) < ?`,
        [fromDt, toDt, early],
      )
    : 0;
  const present = await count(
    `SELECT COUNT(DISTINCT student_id) c FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?`,
    [fromDt, toDt],
  );
  const [smsRow] = await db.query<{ c: number; sent: number }[]>(
    `SELECT COUNT(*) c, COALESCE(SUM(status = 'SENT'), 0) sent FROM sms_logs WHERE created_at BETWEEN ? AND ?`,
    [fromDt, toDt],
  );

  const onTime = Math.max(0, totalIn - lateTotal);
  const onTimePct = totalIn > 0 ? (onTime / totalIn) * 100 : null;
  const latePct = totalIn > 0 ? (lateTotal / totalIn) * 100 : null;

  // At-risk = active students with attendance < 80% (DepEd threshold). Only
  // needs present-day counts per student — a light query.
  let atRiskCount = 0;
  if (schoolDays > 0) {
    const rows = await db.query<{ present_days: number }[]>(
      `SELECT COUNT(DISTINCT DATE(a.scanned_at)) present_days
       FROM students s LEFT JOIN attendance_logs a
         ON a.student_id = s.id AND a.scanned_at BETWEEN ? AND ?
       WHERE s.is_active = 1 GROUP BY s.id`,
      [fromDt, toDt],
    );
    atRiskCount = rows.filter((r) => r.present_days / schoolDays < 0.8).length;
  }

  // Compute midpoint for morning/afternoon split using AM/PM times.
  const parseHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const amOut = settings.am_time_out ? parseHHMM(settings.am_time_out) : NaN;
  let midMin = !Number.isNaN(amOut) ? amOut : 720;
  if (Number.isNaN(amOut)) {
    const amIn = settings.am_time_in ? parseHHMM(settings.am_time_in) : NaN;
    const pmOut = settings.pm_time_out ? parseHHMM(settings.pm_time_out) : NaN;
    if (!Number.isNaN(amIn) && !Number.isNaN(pmOut)) midMin = Math.round((amIn + pmOut) / 2);
  }
  const midH = String(Math.floor(midMin / 60)).padStart(2, '0');
  const midM = String(midMin % 60).padStart(2, '0');
  const midTime = `${midH}:${midM}:00`;
  // Per-session late/early cutoffs for AM and PM.
  const toHms = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`;
  const grace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  const amInMin = settings.am_time_in ? parseHHMM(settings.am_time_in) : NaN;
  const amOutMin = settings.am_time_out ? parseHHMM(settings.am_time_out) : NaN;
  const pmInMin = settings.pm_time_in ? parseHHMM(settings.pm_time_in) : NaN;
  const pmOutMin = settings.pm_time_out ? parseHHMM(settings.pm_time_out) : NaN;
  const amLateCutoff = Number.isNaN(amInMin) ? '' : toHms(amInMin + grace);
  const pmLateCutoff = Number.isNaN(pmInMin) ? '' : toHms(pmInMin + grace);
  const amEarlyCutoff = Number.isNaN(amOutMin) ? '' : toHms(amOutMin);
  const pmEarlyCutoff = Number.isNaN(pmOutMin) ? '' : toHms(pmOutMin);

  const dailyRows = await db.query<
    { day: string; scans: number; ins: number; outs: number;
      morning_in: number; morning_out: number; afternoon_in: number; afternoon_out: number;
      late: number; am_late: number; pm_late: number;
      early: number; am_early: number; pm_early: number }[]
  >(
    `SELECT DATE_FORMAT(scanned_at, '%Y-%m-%d') day,
            COUNT(*) scans,
            COALESCE(SUM(entry_type = 'IN'), 0) ins,
            COALESCE(SUM(entry_type = 'OUT'), 0) outs,
            COALESCE(SUM(entry_type = 'IN' AND TIME(scanned_at) < ?), 0) morning_in,
            COALESCE(SUM(entry_type = 'OUT' AND TIME(scanned_at) < ?), 0) morning_out,
            COALESCE(SUM(entry_type = 'IN' AND TIME(scanned_at) >= ?), 0) afternoon_in,
            COALESCE(SUM(entry_type = 'OUT' AND TIME(scanned_at) >= ?), 0) afternoon_out,
            COALESCE(SUM(entry_type = 'IN' AND ? <> '' AND TIME(scanned_at) > ?), 0) late,
            COALESCE(SUM(entry_type = 'IN' AND ? <> '' AND TIME(scanned_at) > ? AND TIME(scanned_at) < ?), 0) am_late,
            COALESCE(SUM(entry_type = 'IN' AND ? <> '' AND TIME(scanned_at) > ? AND TIME(scanned_at) >= ?), 0) pm_late,
            COALESCE(SUM(entry_type = 'OUT' AND ? <> '' AND TIME(scanned_at) < ?), 0) early,
            COALESCE(SUM(entry_type = 'OUT' AND ? <> '' AND TIME(scanned_at) < ? AND TIME(scanned_at) < ?), 0) am_early,
            COALESCE(SUM(entry_type = 'OUT' AND ? <> '' AND TIME(scanned_at) < ? AND TIME(scanned_at) >= ?), 0) pm_early
     FROM attendance_logs
     WHERE scanned_at BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(scanned_at, '%Y-%m-%d')
     ORDER BY day`,
    [midTime, midTime, midTime, midTime,
     late, late,
     amLateCutoff, amLateCutoff, midTime,
     pmLateCutoff, pmLateCutoff, midTime,
     early, early,
     amEarlyCutoff, amEarlyCutoff, midTime,
     pmEarlyCutoff, pmEarlyCutoff, midTime,
     fromDt, toDt],
  );
  // AM/PM absent: students with zero AM scans / zero PM scans per day.
  const amPresentRows = await db.query<{ day: string; c: number }[]>(
    `SELECT DATE_FORMAT(scanned_at, '%Y-%m-%d') day, COUNT(DISTINCT student_id) c
     FROM attendance_logs WHERE scanned_at BETWEEN ? AND ? AND TIME(scanned_at) < ?
     GROUP BY day`, [fromDt, toDt, midTime],
  );
  const pmPresentRows = await db.query<{ day: string; c: number }[]>(
    `SELECT DATE_FORMAT(scanned_at, '%Y-%m-%d') day, COUNT(DISTINCT student_id) c
     FROM attendance_logs WHERE scanned_at BETWEEN ? AND ? AND TIME(scanned_at) >= ?
     GROUP BY day`, [fromDt, toDt, midTime],
  );
  const amPresentByDay = new Map(amPresentRows.map((r) => [r.day, r.c]));
  const pmPresentByDay = new Map(pmPresentRows.map((r) => [r.day, r.c]));

  const byDay = new Map(dailyRows.map((r) => [r.day, r]));
  const daily = [];
  // Absence is scan-derived per REPORTS_PLAN §2 (user decision): an active
  // student with zero scans on a gate-used day is absent that day. Non-gate
  // days (weekends/holidays) count as neither present nor absent.
  for (let d = new Date(from); d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    const key = fmtDay(d);
    const r = byDay.get(key);
    const presentDay = presentByDay.get(key) ?? 0;
    const amP = amPresentByDay.get(key) ?? 0;
    const pmP = pmPresentByDay.get(key) ?? 0;
    daily.push({
      day: key,
      scans: r?.scans ?? 0,
      in: r?.ins ?? 0,
      out: r?.outs ?? 0,
      morningIn: r?.morning_in ?? 0,
      morningOut: r?.morning_out ?? 0,
      afternoonIn: r?.afternoon_in ?? 0,
      afternoonOut: r?.afternoon_out ?? 0,
      late: r?.late ?? 0,
      amLate: r?.am_late ?? 0,
      pmLate: r?.pm_late ?? 0,
      early: r?.early ?? 0,
      amEarly: r?.am_early ?? 0,
      pmEarly: r?.pm_early ?? 0,
      absent: r ? Math.max(0, activeStudents - presentDay) : 0,
      amAbsent: r ? Math.max(0, activeStudents - amP) : 0,
      pmAbsent: r ? Math.max(0, activeStudents - pmP) : 0,
      present: presentDay,
    });
  }
  const absentTotal = daily.reduce((s, d) => s + d.absent, 0);

  // ---- Per-type payloads ---------------------------------------------------
  let perStudent: PerStudentRow[] = [];
  let perSection: PerSectionRow[] = [];
  let register: ReportRegister = { windowFrom: fromStr, windowTo: toStr, capped: false, days: [], students: [], rows: [] };
  let absentee: AbsenteeRow[] = [];
  let absenteeTotals: AbsenteeTotalsRow[] = [];
  let tardiness: TardinessRow[] = [];
  let tardinessFrequency: TardinessFrequencyRow[] = [];
  let smsAudit: { daily: SmsAuditDay[]; failures: SmsFailureRow[] } = { daily: [], failures: [] };
  let trends: ReportTrends = { weekly: [], dayOfWeek: [], gateHours: [] };
  let studentRecord: StudentRecord | null = null;
  let schoolRegister: SchoolRegisterSection[] = [];

  const yearScope = { yearJoin, yearParams, secExpr };
  if (type === 'per-student') {
    perStudent = await loadPerStudent({ ...yearScope, section, maskPhones, late, fromDt, toDt, schoolDays, midTime, sectionWhere, sectionParams });
  } else if (type === 'per-section') {
    perSection = await loadPerSection({ ...yearScope, late, early, fromDt, toDt, schoolDays });
  } else if (type === 'register') {
    register = await loadRegister({ ...yearScope, late, fromDt, toDt, sectionWhere, sectionParams });
  } else if (type === 'absentee') {
    absentee = await loadAbsentee({ ...yearScope, section, maskPhones, fromDt, toDt, sectionWhere, sectionParams });
    absenteeTotals = await loadAbsenteeTotals({ ...yearScope, maskPhones, fromDt, toDt, sectionWhere, sectionParams });
  } else if (type === 'tardiness') {
    tardiness = await loadTardiness({ ...yearScope, section, maskPhones, late, fromDt, toDt, sectionWhere, sectionParams });
    tardinessFrequency = await loadTardinessFrequency({ ...yearScope, late, fromDt, toDt, sectionWhere, sectionParams });
  } else if (type === 'sms-audit') {
    smsAudit = await loadSmsAudit({ maskPhones, fromDt, toDt });
  } else if (type === 'trends') {
    trends = await loadTrends({ dayPresence, activeStudents, fromDt, toDt });
  } else if (type === 'student') {
    studentRecord = await loadStudentRecord(query.studentId, {
      late,
      early,
      fromDt,
      toDt,
      schoolDays,
      presentByDay,
      maskPhones,
      ...yearScope,
    });
  } else if (type === 'sf1') {
    schoolRegister = await loadSchoolRegister({ ...yearScope, sectionWhere, sectionParams });
  }

  return {
    schoolName: settings.school_name || 'TapIn School',
    from: fromStr,
    to: toStr,
    schoolYear,
    generatedAt: new Date().toISOString(),
    type,
    section,
    maskPhones,
    sections,
    studentId: query.studentId,
    studentRecord,
    cutoffs: { late, early },
    summary: {
      scans: scanRow?.c ?? 0,
      in: totalIn,
      out: scanRow?.outs ?? 0,
      late: lateTotal,
      early: earlyTotal,
      absent: absentTotal,
      present,
      sms: smsRow?.c ?? 0,
      smsSent: smsRow?.sent ?? 0,
      days: daily.length,
      schoolDays,
      activeStudents,
      attendanceRate,
      ada,
      onTime,
      onTimePct,
      latePct,
      atRiskCount,
    },
    daily,
    perStudent,
    perSection,
    register,
    absentee,
    absenteeTotals,
    tardiness,
    tardinessFrequency,
    smsAudit,
    trends,
    schoolRegister,
  };
}

// ---- School Register (DepEd SF1, school-wide) -------------------------------
// The admin's official enrolment register: every active learner in the selected
// school year, grouped by grade/section and ordered by grade. No date range —
// it's a snapshot of who is enrolled. Birthdate is the one official SF1 column
// we don't store, so it renders blank on the form.
async function loadSchoolRegister(args: {
  yearJoin: string;
  yearParams: unknown[];
  secExpr: string;
  sectionWhere: string;
  sectionParams: unknown[];
}): Promise<SchoolRegisterSection[]> {
  const rows = await db.query<
    {
      student_id: number;
      student_no: string;
      full_name: string;
      lrn: string;
      gender: string;
      guardian_address: string;
      guardian_name: string;
      parent_phone: string;
      grade_section: string;
    }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, s.lrn, s.gender,
            s.guardian_address, s.guardian_name, s.parent_phone,
            ${args.secExpr} grade_section
     FROM students s ${args.yearJoin}
     WHERE s.is_active = 1${args.sectionWhere}
     ORDER BY ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name`,
    [...args.yearParams, ...args.sectionParams],
  );

  const groups = new Map<string, SchoolRegisterSection>();
  for (const r of rows) {
    const sec = r.grade_section || '—';
    let group = groups.get(sec);
    if (!group) {
      group = { gradeSection: sec, rows: [], male: 0, female: 0 };
      groups.set(sec, group);
    }
    const isMale = /^m/i.test(r.gender);
    if (isMale) group.male++;
    else group.female++;
    const row: SchoolRegisterRow = {
      studentId: r.student_id,
      studentNo: r.student_no,
      lrn: r.lrn,
      fullName: r.full_name,
      sex: isMale ? 'M' : 'F',
      address: r.guardian_address,
      guardian: r.guardian_name,
      contact: r.parent_phone,
    };
    group.rows.push(row);
  }
  // Keep grade order (the SQL already ordered by grade → section → name).
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Summary-card drilldowns (click a stat card → who is behind this number?)
// ---------------------------------------------------------------------------

interface DrilldownScope {
  fromStr: string;
  toStr: string;
  fromDt: string;
  toDt: string;
  late: string;
  early: string;
  maskPhones: boolean;
  /** Gate-used days in the range (denominator for attendance rates). */
  schoolDays: number;
  sectionWhere: string;
  sectionParams: unknown[];
  yearJoin: string;
  yearParams: unknown[];
  secExpr: string;
}

function drilldownRow(r: {
  student_id: number;
  student_no: string;
  full_name: string;
  grade_section: string;
  parent_phone: string;
  value: number;
  value2?: number;
  value3?: number;
  time?: string | null;
}, maskPhones: boolean): ReportDrilldownRow {
  return {
    studentId: r.student_id,
    studentNo: r.student_no,
    fullName: r.full_name,
    gradeSection: r.grade_section,
    parentPhone: phoneOf(r.parent_phone, maskPhones),
    value: r.value,
    value2: r.value2,
    value3: r.value3,
    time: r.time ?? undefined,
  };
}

/** Every student with ≥1 scan — total / IN / OUT counts. */
async function ddScans(args: DrilldownScope): Promise<ReportDrilldownRow[]> {
  const rows = await db.query<
    { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string; total: number; ins: number; outs: number }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            COUNT(a.id) total,
            COALESCE(SUM(a.entry_type = 'IN'), 0) ins,
            COALESCE(SUM(a.entry_type = 'OUT'), 0) outs
     FROM students s ${args.yearJoin}
     LEFT JOIN attendance_logs a ON a.student_id = s.id AND a.scanned_at BETWEEN ? AND ?
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     HAVING total > 0
     ORDER BY total DESC, ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name`,
    [...args.yearParams, args.fromDt, args.toDt, ...args.sectionParams],
  );
  return rows.map((r) =>
    drilldownRow({ ...r, value: r.total, value2: r.ins, value3: r.outs }, args.maskPhones),
  );
}

/** Students with ≥1 IN scan — IN count + last IN time (newest arrival first). */
async function ddIn(args: DrilldownScope): Promise<ReportDrilldownRow[]> {
  const rows = await db.query<
    { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string; ins: number; last_in: string | null }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            COUNT(a.id) ins, DATE_FORMAT(MAX(a.scanned_at), '%H:%i') last_in
     FROM students s ${args.yearJoin}
     JOIN attendance_logs a ON a.student_id = s.id AND a.entry_type = 'IN' AND a.scanned_at BETWEEN ? AND ?
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     ORDER BY MAX(a.scanned_at) DESC`,
    [...args.yearParams, args.fromDt, args.toDt, ...args.sectionParams],
  );
  return rows.map((r) => drilldownRow({ ...r, value: r.ins, time: r.last_in }, args.maskPhones));
}

/** Students with ≥1 OUT scan — OUT count + last OUT time (newest departure first). */
async function ddOut(args: DrilldownScope): Promise<ReportDrilldownRow[]> {
  const rows = await db.query<
    { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string; outs: number; last_out: string | null }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            COUNT(a.id) outs, DATE_FORMAT(MAX(a.scanned_at), '%H:%i') last_out
     FROM students s ${args.yearJoin}
     JOIN attendance_logs a ON a.student_id = s.id AND a.entry_type = 'OUT' AND a.scanned_at BETWEEN ? AND ?
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     ORDER BY MAX(a.scanned_at) DESC`,
    [...args.yearParams, args.fromDt, args.toDt, ...args.sectionParams],
  );
  return rows.map((r) => drilldownRow({ ...r, value: r.outs, time: r.last_out }, args.maskPhones));
}

/** Students with flagged-late IN scans — times late + total minutes late. */
async function ddLate(args: DrilldownScope): Promise<ReportDrilldownRow[]> {
  if (!args.late) return [];
  const rows = await db.query<
    { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string; late_count: number; late_mins: number }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            COUNT(*) late_count,
            COALESCE(SUM(TIMESTAMPDIFF(MINUTE, TIMESTAMP(DATE(a.scanned_at), ?), a.scanned_at)), 0) late_mins
     FROM students s ${args.yearJoin}
     JOIN attendance_logs a ON a.student_id = s.id AND a.entry_type = 'IN' AND a.scanned_at BETWEEN ? AND ?
       AND TIME(a.scanned_at) > ?
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     ORDER BY late_count DESC, late_mins DESC, ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name`,
    // Text order: SELECT late cutoff, yearJoin, BETWEEN, TIME > cutoff, section.
    [args.late, ...args.yearParams, args.fromDt, args.toDt, args.late, ...args.sectionParams],
  );
  return rows.map((r) =>
    drilldownRow({ ...r, value: r.late_count, value2: r.late_mins }, args.maskPhones),
  );
}

/** Students with flagged-early OUT scans — times early. */
async function ddEarly(args: DrilldownScope): Promise<ReportDrilldownRow[]> {
  if (!args.early) return [];
  const rows = await db.query<
    { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string; early_count: number }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            COUNT(*) early_count
     FROM students s ${args.yearJoin}
     JOIN attendance_logs a ON a.student_id = s.id AND a.entry_type = 'OUT' AND a.scanned_at BETWEEN ? AND ?
       AND TIME(a.scanned_at) < ?
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     ORDER BY early_count DESC, ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name`,
    [...args.yearParams, args.fromDt, args.toDt, args.early, ...args.sectionParams],
  );
  return rows.map((r) => drilldownRow({ ...r, value: r.early_count }, args.maskPhones));
}

/** Students absent on ≥1 school day — days absent (worst first). */
async function ddAbsent(args: DrilldownScope): Promise<ReportDrilldownRow[]> {
  const rows = await db.query<
    { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string; days_absent: number }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone, COUNT(*) days_absent
     FROM students s ${args.yearJoin}
     JOIN (SELECT DISTINCT DATE(scanned_at) day FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?) d
     WHERE s.is_active = 1${args.sectionWhere}
       AND NOT EXISTS (SELECT 1 FROM attendance_logs a
                       WHERE a.student_id = s.id AND a.scanned_at BETWEEN ? AND ? AND DATE(a.scanned_at) = d.day)
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     ORDER BY days_absent DESC, ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name
     LIMIT ${DETAIL_ROW_CAP}`,
    [...args.yearParams, args.fromDt, args.toDt, ...args.sectionParams, args.fromDt, args.toDt],
  );
  return rows.map((r) => drilldownRow({ ...r, value: r.days_absent }, args.maskPhones));
}

/** Presence per student — shared by the present / attendance / at-risk metrics. */
async function ddPresence(args: DrilldownScope): Promise<
  { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string; present_days: number }[]
> {
  return db.query(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            COUNT(DISTINCT DATE(a.scanned_at)) present_days
     FROM students s ${args.yearJoin}
     LEFT JOIN attendance_logs a ON a.student_id = s.id AND a.scanned_at BETWEEN ? AND ?
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone`,
    [...args.yearParams, args.fromDt, args.toDt, ...args.sectionParams],
  );
}

/** Students with ≥1 on-time IN scan — on-time arrival count. */
async function ddOnTime(args: DrilldownScope): Promise<ReportDrilldownRow[]> {
  const rows = await db.query<
    { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string; on_time: number }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            COUNT(a.id) on_time
     FROM students s ${args.yearJoin}
     JOIN attendance_logs a ON a.student_id = s.id AND a.entry_type = 'IN' AND a.scanned_at BETWEEN ? AND ?
       AND (? = '' OR TIME(a.scanned_at) <= ?)
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     ORDER BY on_time DESC, ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name`,
    // Text order: yearJoin, JOIN BETWEEN, the two on-time cutoff placeholders.
    [...args.yearParams, args.fromDt, args.toDt, args.late, args.late, ...args.sectionParams],
  );
  return rows.map((r) => drilldownRow({ ...r, value: r.on_time }, args.maskPhones));
}

/** Students who received parent-alert SMS in the range — SMS count. */
async function ddSms(args: DrilldownScope): Promise<ReportDrilldownRow[]> {
  // Each SMS resolves to a student via its attendance link, else by recipient
  // phone among active students (covers automated absence alerts that have no
  // linked scan).
  const rows = await db.query<
    { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string; sms_count: number }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone, COUNT(x.id) sms_count
     FROM students s ${args.yearJoin}
     LEFT JOIN (
       SELECT sm.id, COALESCE(al.student_id, ps.id) student_id
       FROM sms_logs sm
       LEFT JOIN attendance_logs al ON al.id = sm.attendance_id
       LEFT JOIN students ps ON ps.parent_phone = sm.parent_phone AND ps.is_active = 1 AND ps.parent_phone <> ''
       WHERE sm.created_at BETWEEN ? AND ?
     ) x ON x.student_id = s.id
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     HAVING sms_count > 0
     ORDER BY sms_count DESC, ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name`,
    [...args.yearParams, args.fromDt, args.toDt, ...args.sectionParams],
  );
  return rows.map((r) => drilldownRow({ ...r, value: r.sms_count }, args.maskPhones));
}

/**
 * One summary stat card's student-level breakdown. Mirrors the summary's own
 * math (same range cap, section/school-year scoping, late/early cutoffs,
 * 80% at-risk threshold) so the drilldown always agrees with the card it came
 * from.
 */
export async function getReportDrilldown(query: ReportDrilldownQuery): Promise<ReportDrilldownResult> {
  const today = fmtDay(new Date());
  const metric: ReportDrilldownMetric = query?.metric ?? 'present';
  const section = (query?.section ?? '').trim() || '';
  const maskPhones = !!query?.maskPhones;

  let from = parseDay(query?.from) ?? parseDay(today)!;
  let to = parseDay(query?.to) ?? from;
  if (from.getTime() > to.getTime()) [from, to] = [to, from];
  if (to.getTime() - from.getTime() > (MAX_RANGE_DAYS - 1) * 86400000) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
  }
  const fromStr = fmtDay(from);
  const toStr = fmtDay(to);
  const fromDt = `${fromStr} 00:00:00`;
  const toDt = `${toStr} 23:59:59`;
  const { late, early } = flagCutoffs(settingsStore.get());
  const schoolYear = (query?.schoolYear ?? '').trim();
  const yearJoin = schoolYear
    ? `LEFT JOIN enrollments e ON e.student_id = s.id AND e.school_year = ?`
    : '';
  const yearParams: unknown[] = schoolYear ? [schoolYear] : [];
  const secExpr = schoolYear ? `COALESCE(NULLIF(e.grade_section, ''), s.grade_section)` : 's.grade_section';
  const sectionWhere = section ? ` AND ${secExpr} = ?` : '';
  const sectionParams: unknown[] = section ? [section] : [];

  const schoolDays = await (async () => {
    const [row] = await db.query<{ c: number }[]>(
      `SELECT COUNT(DISTINCT DATE(scanned_at)) c FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?`,
      [fromDt, toDt],
    );
    return row?.c ?? 0;
  })();

  const scope: DrilldownScope = {
    fromStr,
    toStr,
    fromDt,
    toDt,
    late,
    early,
    maskPhones,
    schoolDays,
    sectionWhere,
    sectionParams,
    yearJoin,
    yearParams,
    secExpr,
  };

  let rows: ReportDrilldownRow[] = [];
  if (metric === 'scans') rows = await ddScans(scope);
  else if (metric === 'in') rows = await ddIn(scope);
  else if (metric === 'out') rows = await ddOut(scope);
  else if (metric === 'late') rows = await ddLate(scope);
  else if (metric === 'early') rows = await ddEarly(scope);
  else if (metric === 'absent') rows = await ddAbsent(scope);
  else if (metric === 'onTime') rows = await ddOnTime(scope);
  else if (metric === 'sms') rows = await ddSms(scope);
  else if (metric === 'present' || metric === 'attendance' || metric === 'atRisk') {
    const presence = await ddPresence(scope);
    const absentDays = (p: number) => Math.max(0, schoolDays - p);
    if (metric === 'present') {
      rows = presence
        .filter((r) => r.present_days > 0)
        .map((r) =>
          drilldownRow(
            {
              ...r,
              value: r.present_days,
              value2: schoolDays > 0 ? Math.round((r.present_days / schoolDays) * 1000) / 10 : undefined,
            },
            maskPhones,
          ),
        );
    } else if (metric === 'attendance') {
      rows = presence.map((r) =>
        drilldownRow(
          {
            ...r,
            value: r.present_days,
            value2: absentDays(r.present_days),
            value3: schoolDays > 0 ? Math.round((r.present_days / schoolDays) * 1000) / 10 : undefined,
          },
          maskPhones,
        ),
      );
      rows.sort((a, b) => (b.value3 ?? -1) - (a.value3 ?? -1));
    } else {
      // at-risk: active students below the 80% threshold, worst first.
      rows = presence
        .filter((r) => schoolDays > 0 && r.present_days / schoolDays < 0.8)
        .map((r) =>
          drilldownRow(
            {
              ...r,
              value: Math.round((r.present_days / schoolDays) * 1000) / 10,
              value2: absentDays(r.present_days),
            },
            maskPhones,
          ),
        );
      rows.sort((a, b) => a.value - b.value || (b.value2 ?? 0) - (a.value2 ?? 0));
    }
  }

  return { metric, from: fromStr, to: toStr, rows };
}

// ---------------------------------------------------------------------------
// Per-type loaders
// ---------------------------------------------------------------------------

interface StudentScope {
  section?: string;
  maskPhones: boolean;
  sectionWhere: string;
  sectionParams: unknown[];
  /** Year-scoping: LEFT JOIN enrollments e + params + section expression. */
  yearJoin: string;
  yearParams: unknown[];
  secExpr: string;
}

function phoneOf(phone: string, maskPhones: boolean): string {
  return maskPhones ? maskPhone(phone) : phone;
}

async function loadPerStudent(
  args: StudentScope & { late: string; fromDt: string; toDt: string; schoolDays: number; midTime: string },
): Promise<PerStudentRow[]> {
  const mid = args.midTime; // e.g. '12:00:00'
  const lateSub = args.late
    ? `LEFT JOIN (
         SELECT student_id,
                SUM(TIMESTAMPDIFF(MINUTE, TIMESTAMP(DATE(scanned_at), ?), scanned_at)) late_mins,
                SUM(CASE WHEN TIME(scanned_at) < ? THEN TIMESTAMPDIFF(MINUTE, TIMESTAMP(DATE(scanned_at), ?), scanned_at) ELSE 0 END) late_mins_am,
                SUM(CASE WHEN TIME(scanned_at) >= ? THEN TIMESTAMPDIFF(MINUTE, TIMESTAMP(DATE(scanned_at), ?), scanned_at) ELSE 0 END) late_mins_pm
         FROM attendance_logs WHERE scanned_at BETWEEN ? AND ? AND entry_type = 'IN' AND TIME(scanned_at) > ?
         GROUP BY student_id
       ) lm ON lm.student_id = s.id`
    : '';
  const lateMinsSel = args.late ? 'COALESCE(lm.late_mins, 0)' : '0';
  const lateMinsAmSel = args.late ? 'COALESCE(lm.late_mins_am, 0)' : '0';
  const lateMinsPmSel = args.late ? 'COALESCE(lm.late_mins_pm, 0)' : '0';
  // Params for lateSub: cutoff, mid, cutoff, mid, cutoff, fromDt, toDt, cutoff
  const lateParams = args.late ? [args.late, mid, args.late, mid, args.late, args.fromDt, args.toDt, args.late] : [];
  const rows = await db.query<
    {
      student_id: number;
      student_no: string;
      full_name: string;
      grade_section: string;
      parent_phone: string;
      present_days: number;
      late_days: number;
      late_days_am: number;
      late_days_pm: number;
      total_in: number;
      total_in_am: number;
      total_in_pm: number;
      total_out: number;
      total_out_am: number;
      total_out_pm: number;
      present_days_am: number;
      present_days_pm: number;
      late_mins: number;
      late_mins_am: number;
      late_mins_pm: number;
      sms_count: number;
      last_status: string | null;
    }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN DATE(a.scanned_at) END) present_days,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? THEN DATE(a.scanned_at) END) late_days,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? AND TIME(a.scanned_at) < ? THEN DATE(a.scanned_at) END) late_days_am,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? AND TIME(a.scanned_at) >= ? THEN DATE(a.scanned_at) END) late_days_pm,
            COALESCE(SUM(a.entry_type = 'IN'), 0) total_in,
            COALESCE(SUM(a.entry_type = 'IN' AND TIME(a.scanned_at) < ?), 0) total_in_am,
            COALESCE(SUM(a.entry_type = 'IN' AND TIME(a.scanned_at) >= ?), 0) total_in_pm,
            COALESCE(SUM(a.entry_type = 'OUT'), 0) total_out,
            COALESCE(SUM(a.entry_type = 'OUT' AND TIME(a.scanned_at) < ?), 0) total_out_am,
            COALESCE(SUM(a.entry_type = 'OUT' AND TIME(a.scanned_at) >= ?), 0) total_out_pm,
            COUNT(DISTINCT CASE WHEN a.id IS NOT NULL AND TIME(a.scanned_at) < ? THEN DATE(a.scanned_at) END) present_days_am,
            COUNT(DISTINCT CASE WHEN a.id IS NOT NULL AND TIME(a.scanned_at) >= ? THEN DATE(a.scanned_at) END) present_days_pm,
            ${lateMinsSel} late_mins,
            ${lateMinsAmSel} late_mins_am,
            ${lateMinsPmSel} late_mins_pm,
            COALESCE(ssm.sms_count, 0) sms_count,
            ssm.last_status last_status
     FROM students s ${args.yearJoin}
     LEFT JOIN attendance_logs a ON a.student_id = s.id AND a.scanned_at BETWEEN ? AND ?
     ${lateSub}
     LEFT JOIN (SELECT al.student_id, COUNT(*) sms_count,
                       SUBSTRING_INDEX(GROUP_CONCAT(sm.status ORDER BY sm.id DESC), ',', 1) last_status
                FROM sms_logs sm JOIN attendance_logs al ON al.id = sm.attendance_id
                WHERE al.scanned_at BETWEEN ? AND ? GROUP BY al.student_id) ssm ON ssm.student_id = s.id
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     ORDER BY ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name`,
    // Placeholder order: late cutoffs (×4 for late/late_am/late_pm + original), midTime for am/pm splits, lateSub params, sms subquery.
    [
      // late_days: ? <> '' AND TIME > ?
      args.late, args.late,
      // late_days_am: ? <> '' AND TIME > ? AND TIME < ?
      args.late, args.late, mid,
      // late_days_pm: ? <> '' AND TIME > ? AND TIME >= ?
      args.late, args.late, mid,
      // total_in_am: TIME < ?
      mid,
      // total_in_pm: TIME >= ?
      mid,
      // total_out_am: TIME < ?
      mid,
      // total_out_pm: TIME >= ?
      mid,
      // present_days_am: TIME < ?
      mid,
      // present_days_pm: TIME >= ?
      mid,
      // yearJoin params, FROM...BETWEEN
      ...args.yearParams, args.fromDt, args.toDt,
      // lateSub params
      ...lateParams,
      // sms subquery BETWEEN
      args.fromDt, args.toDt,
      // sectionWhere params
      ...args.sectionParams,
    ],
  );
  const schoolDays = args.schoolDays;
  return rows.map((r) => {
    const absentAm = Math.max(0, schoolDays - r.present_days_am);
    const absentPm = Math.max(0, schoolDays - r.present_days_pm);
    return {
      studentId: r.student_id,
      studentNo: r.student_no,
      fullName: r.full_name,
      gradeSection: r.grade_section,
      parentPhone: phoneOf(r.parent_phone, args.maskPhones),
      daysPresent: r.present_days,
      daysLate: r.late_days,
      daysLateAm: r.late_days_am,
      daysLatePm: r.late_days_pm,
      daysAbsent: Math.max(0, schoolDays - r.present_days),
      daysAbsentAm: absentAm,
      daysAbsentPm: absentPm,
      attendanceRate: schoolDays > 0 ? (r.present_days / schoolDays) * 100 : null,
      totalIn: r.total_in,
      totalInAm: r.total_in_am,
      totalInPm: r.total_in_pm,
      totalOut: r.total_out,
      totalOutAm: r.total_out_am,
      totalOutPm: r.total_out_pm,
      totalMinutesLate: r.late_mins ?? 0,
      totalMinutesLateAm: r.late_mins_am ?? 0,
      totalMinutesLatePm: r.late_mins_pm ?? 0,
      smsCount: r.sms_count,
      lastSmsStatus: (r.last_status as SmsStatus) || null,
    };
  });
}

async function loadPerSection(args: {
  late: string;
  early: string;
  fromDt: string;
  toDt: string;
  schoolDays: number;
  yearJoin: string;
  yearParams: unknown[];
  secExpr: string;
}): Promise<PerSectionRow[]> {
  // Compute the midpoint between AM session end and PM session start
  // to split scans into AM vs PM.
  const settings = settingsStore.get();
  const parseHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const regAmOut = settings.am_time_out ? parseHHMM(settings.am_time_out) : NaN;
  let midMin = !Number.isNaN(regAmOut) ? regAmOut : 720;
  if (Number.isNaN(regAmOut)) {
    const regAmIn = settings.am_time_in ? parseHHMM(settings.am_time_in) : NaN;
    const regPmOut = settings.pm_time_out ? parseHHMM(settings.pm_time_out) : NaN;
    if (!Number.isNaN(regAmIn) && !Number.isNaN(regPmOut)) midMin = Math.round((regAmIn + regPmOut) / 2);
  }
  const midStr = `${String(Math.floor(midMin / 60)).padStart(2, '0')}:${String(midMin % 60).padStart(2, '0')}:00`;
  // AM/PM late cutoffs
  const regGrace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  const regAmInMin = settings.am_time_in ? parseHHMM(settings.am_time_in) : NaN;
  const regPmInMin = settings.pm_time_in ? parseHHMM(settings.pm_time_in) : NaN;
  const regAmOutMin = settings.am_time_out ? parseHHMM(settings.am_time_out) : NaN;
  const regPmOutMin = settings.pm_time_out ? parseHHMM(settings.pm_time_out) : NaN;
  const toHms = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`;
  const amLateCut = Number.isNaN(regAmInMin) ? '' : toHms(regAmInMin + regGrace);
  const pmLateCut = Number.isNaN(regPmInMin) ? '' : toHms(regPmInMin + regGrace);
  const amEarlyCut = Number.isNaN(regAmOutMin) ? '' : toHms(regAmOutMin);
  const pmEarlyCut = Number.isNaN(regPmOutMin) ? '' : toHms(regPmOutMin);

  const enrolledRows = await db.query<{ grade_section: string; c: number }[]>(
    `SELECT ${args.secExpr} grade_section, COUNT(*) c FROM students s ${args.yearJoin}
     WHERE s.is_active = 1 GROUP BY ${args.secExpr}`,
    [...args.yearParams],
  );
  const presentRows = await db.query<{ grade_section: string; present: number }[]>(
    `SELECT ${args.secExpr} grade_section, COUNT(DISTINCT a.student_id) present
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ? GROUP BY ${args.secExpr}`,
    [...args.yearParams, args.fromDt, args.toDt],
  );
  const flagRows = await db.query<{ grade_section: string; late: number; early: number }[]>(
    `SELECT ${args.secExpr} grade_section,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? THEN a.student_id END) late,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'OUT' AND ? <> '' AND TIME(a.scanned_at) < ? THEN a.student_id END) early
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ? GROUP BY ${args.secExpr}`,
    [...args.yearParams, args.late, args.late, args.early, args.early, args.fromDt, args.toDt],
  );
  // AM/PM flag counts
  const amFlagRows = await db.query<{ grade_section: string; late_am: number; early_am: number }[]>(
    `SELECT ${args.secExpr} grade_section,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? AND TIME(a.scanned_at) < ? THEN a.student_id END) late_am,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'OUT' AND ? <> '' AND TIME(a.scanned_at) < ? AND TIME(a.scanned_at) < ? THEN a.student_id END) early_am
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ? GROUP BY ${args.secExpr}`,
    [...args.yearParams, amLateCut, amLateCut, midStr, amEarlyCut, amEarlyCut, midStr, args.fromDt, args.toDt],
  );
  const pmFlagRows = await db.query<{ grade_section: string; late_pm: number; early_pm: number }[]>(
    `SELECT ${args.secExpr} grade_section,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? AND TIME(a.scanned_at) >= ? THEN a.student_id END) late_pm,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'OUT' AND ? <> '' AND TIME(a.scanned_at) < ? AND TIME(a.scanned_at) >= ? THEN a.student_id END) early_pm
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ? GROUP BY ${args.secExpr}`,
    [...args.yearParams, pmLateCut, pmLateCut, midStr, pmEarlyCut, pmEarlyCut, midStr, args.fromDt, args.toDt],
  );
  // AM/PM present counts
  const amPresentRows = await db.query<{ grade_section: string; present: number }[]>(
    `SELECT ${args.secExpr} grade_section, COUNT(DISTINCT a.student_id) present
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ? AND TIME(a.scanned_at) < ?
     GROUP BY ${args.secExpr}`,
    [...args.yearParams, args.fromDt, args.toDt, midStr],
  );
  const pmPresentRows = await db.query<{ grade_section: string; present: number }[]>(
    `SELECT ${args.secExpr} grade_section, COUNT(DISTINCT a.student_id) present
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ? AND TIME(a.scanned_at) >= ?
     GROUP BY ${args.secExpr}`,
    [...args.yearParams, args.fromDt, args.toDt, midStr],
  );
  // IN/OUT totals and AM/PM splits
  const inoutRows = await db.query<{ grade_section: string; total_in: number; total_out: number; in_am: number; in_pm: number; out_am: number; out_pm: number }[]>(
    `SELECT ${args.secExpr} grade_section,
            COUNT(CASE WHEN a.entry_type = 'IN' THEN 1 END) total_in,
            COUNT(CASE WHEN a.entry_type = 'OUT' THEN 1 END) total_out,
            COUNT(CASE WHEN a.entry_type = 'IN' AND TIME(a.scanned_at) < ? THEN 1 END) in_am,
            COUNT(CASE WHEN a.entry_type = 'IN' AND TIME(a.scanned_at) >= ? THEN 1 END) in_pm,
            COUNT(CASE WHEN a.entry_type = 'OUT' AND TIME(a.scanned_at) < ? THEN 1 END) out_am,
            COUNT(CASE WHEN a.entry_type = 'OUT' AND TIME(a.scanned_at) >= ? THEN 1 END) out_pm
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ? GROUP BY ${args.secExpr}`,
    [...args.yearParams, midStr, midStr, midStr, midStr, args.fromDt, args.toDt],
  );
  const daySectionPresent = await db.query<{ grade_section: string; present: number }[]>(
    `SELECT ${args.secExpr} grade_section, COUNT(DISTINCT a.student_id) present
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ?
     GROUP BY DATE(a.scanned_at), ${args.secExpr}`,
    [...args.yearParams, args.fromDt, args.toDt],
  );
  const sumBySection = new Map<string, number>();
  for (const r of daySectionPresent) sumBySection.set(r.grade_section, (sumBySection.get(r.grade_section) ?? 0) + r.present);

  const enrolled = new Map(enrolledRows.map((r) => [r.grade_section, r.c]));
  const present = new Map(presentRows.map((r) => [r.grade_section, r.present]));
  const flags = new Map(flagRows.map((r) => [r.grade_section, r]));
  const amFlags = new Map(amFlagRows.map((r) => [r.grade_section, r]));
  const pmFlags = new Map(pmFlagRows.map((r) => [r.grade_section, r]));
  const amPresent = new Map(amPresentRows.map((r) => [r.grade_section, r.present]));
  const pmPresent = new Map(pmPresentRows.map((r) => [r.grade_section, r.present]));
  const inout = new Map(inoutRows.map((r) => [r.grade_section, r]));
  const sections = new Set([...enrolled.keys(), ...present.keys()]);
  return [...sections]
    .sort((a, b) => gradeNum(a) - gradeNum(b) || a.localeCompare(b))
    .map((gradeSection) => {
      const enrolledCount = enrolled.get(gradeSection) ?? 0;
      const presentCount = present.get(gradeSection) ?? 0;
      const sumPres = sumBySection.get(gradeSection) ?? 0;
      const rate =
        enrolledCount > 0 && args.schoolDays > 0 ? (sumPres / (enrolledCount * args.schoolDays)) * 100 : null;
      const presentAm = amPresent.get(gradeSection) ?? 0;
      const presentPm = pmPresent.get(gradeSection) ?? 0;
      const io = inout.get(gradeSection);
      return {
        gradeSection,
        enrolled: enrolledCount,
        present: presentCount,
        absent: Math.max(0, enrolledCount - presentCount),
        late: flags.get(gradeSection)?.late ?? 0,
        lateAm: amFlags.get(gradeSection)?.late_am ?? 0,
        latePm: pmFlags.get(gradeSection)?.late_pm ?? 0,
        early: flags.get(gradeSection)?.early ?? 0,
        earlyAm: amFlags.get(gradeSection)?.early_am ?? 0,
        earlyPm: pmFlags.get(gradeSection)?.early_pm ?? 0,
        attendanceRate: rate,
        presentAm,
        presentPm,
        absentAm: Math.max(0, enrolledCount - presentAm),
        absentPm: Math.max(0, enrolledCount - presentPm),
        totalIn: io?.total_in ?? 0,
        totalInAm: io?.in_am ?? 0,
        totalInPm: io?.in_pm ?? 0,
        totalOut: io?.total_out ?? 0,
        totalOutAm: io?.out_am ?? 0,
        totalOutPm: io?.out_pm ?? 0,
      };
    });
}

async function loadRegister(args: {
  late: string;
  fromDt: string;
  toDt: string;
  sectionWhere: string;
  sectionParams: unknown[];
  yearJoin: string;
  yearParams: unknown[];
  secExpr: string;
}): Promise<ReportRegister> {
  const rangeDays = Math.round((new Date(args.toDt.slice(0, 10)).getTime() - new Date(args.fromDt.slice(0, 10)).getTime()) / 86400000) + 1;
  const capped = rangeDays > REGISTER_MAX_DAYS;
  const windowTo = new Date(args.toDt.slice(0, 10));
  const windowFrom = capped ? addDays(windowTo, -(REGISTER_MAX_DAYS - 1)) : new Date(args.fromDt.slice(0, 10));
  const fromDt = `${fmtDay(windowFrom)} 00:00:00`;
  const toDt = `${fmtDay(windowTo)} 23:59:59`;

  const studentRows = await db.query<{ student_id: number; student_no: string; full_name: string; grade_section: string }[]>(
    `SELECT * FROM (
      SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section
      FROM students s ${args.yearJoin}
      WHERE s.is_active = 1${args.sectionWhere}
    ) sub GROUP BY sub.student_id
    ORDER BY ${gradeOrd('sub.grade_section')}, sub.grade_section, sub.full_name`,
    [...args.yearParams, ...args.sectionParams],
  );
  // Compute the midpoint between am_time_out and pm_time_in to split
  // morning vs afternoon scans.  Falls back to '12:00:00' when not configured.
  const settings = settingsStore.get();
  const parseHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const regAmOut = settings.am_time_out ? parseHHMM(settings.am_time_out) : NaN;
  let midMin = !Number.isNaN(regAmOut) ? regAmOut : 720;
  if (Number.isNaN(regAmOut)) {
    const regAmIn = settings.am_time_in ? parseHHMM(settings.am_time_in) : NaN;
    const regPmOut = settings.pm_time_out ? parseHHMM(settings.pm_time_out) : NaN;
    if (!Number.isNaN(regAmIn) && !Number.isNaN(regPmOut)) midMin = Math.round((regAmIn + regPmOut) / 2);
  }
  const midH = String(Math.floor(midMin / 60)).padStart(2, '0');
  const midM = String(midMin % 60).padStart(2, '0');
  const midTime = `${midH}:${midM}:00`;
  // Per-session late/early cutoffs for AM and PM.
  const regGrace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  const regAmInMin = settings.am_time_in ? parseHHMM(settings.am_time_in) : NaN;
  const regPmInMin = settings.pm_time_in ? parseHHMM(settings.pm_time_in) : NaN;
  const regAmOutMin = settings.am_time_out ? parseHHMM(settings.am_time_out) : NaN;
  const regPmOutMin = settings.pm_time_out ? parseHHMM(settings.pm_time_out) : NaN;
  const regToHms = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`;
  const amLateCutoff = Number.isNaN(regAmInMin) ? '' : regToHms(regAmInMin + regGrace);
  const pmLateCutoff = Number.isNaN(regPmInMin) ? '' : regToHms(regPmInMin + regGrace);
  const amEarlyCutoff = Number.isNaN(regAmOutMin) ? '' : regToHms(regAmOutMin);
  const pmEarlyCutoff = Number.isNaN(regPmOutMin) ? '' : regToHms(regPmOutMin);

  const scanRows = await db.query<
    { student_id: number; day: string; first_in: string | null; last_out: string | null;
      morning_in: string | null; morning_out: string | null;
      afternoon_in: string | null; afternoon_out: string | null;
      am_late: number; pm_late: number; am_early: number; pm_early: number }[]
  >(
    `SELECT s.id student_id, DATE_FORMAT(a.scanned_at, '%Y-%m-%d') day,
            DATE_FORMAT(MIN(CASE WHEN a.entry_type = 'IN' THEN a.scanned_at END), '%H:%i') first_in,
            DATE_FORMAT(MAX(CASE WHEN a.entry_type = 'OUT' THEN a.scanned_at END), '%H:%i') last_out,
            DATE_FORMAT(MIN(CASE WHEN a.entry_type = 'IN' AND TIME(a.scanned_at) < ? THEN a.scanned_at END), '%H:%i') morning_in,
            DATE_FORMAT(MAX(CASE WHEN a.entry_type = 'OUT' AND TIME(a.scanned_at) < ? THEN a.scanned_at END), '%H:%i') morning_out,
            DATE_FORMAT(MIN(CASE WHEN a.entry_type = 'IN' AND TIME(a.scanned_at) >= ? THEN a.scanned_at END), '%H:%i') afternoon_in,
            DATE_FORMAT(MAX(CASE WHEN a.entry_type = 'OUT' AND TIME(a.scanned_at) >= ? THEN a.scanned_at END), '%H:%i') afternoon_out,
            SUM(CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? AND TIME(a.scanned_at) < ? THEN 1 ELSE 0 END) am_late,
            SUM(CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? AND TIME(a.scanned_at) >= ? THEN 1 ELSE 0 END) pm_late,
            SUM(CASE WHEN a.entry_type = 'OUT' AND ? <> '' AND TIME(a.scanned_at) < ? AND TIME(a.scanned_at) < ? THEN 1 ELSE 0 END) am_early,
            SUM(CASE WHEN a.entry_type = 'OUT' AND ? <> '' AND TIME(a.scanned_at) < ? AND TIME(a.scanned_at) >= ? THEN 1 ELSE 0 END) pm_early
     FROM students s ${args.yearJoin}
     LEFT JOIN attendance_logs a ON a.student_id = s.id AND a.scanned_at BETWEEN ? AND ?
     WHERE s.is_active = 1 AND a.id IS NOT NULL${args.sectionWhere}
     GROUP BY s.id, DATE_FORMAT(a.scanned_at, '%Y-%m-%d')`,
    [midTime, midTime, midTime, midTime,
     amLateCutoff, amLateCutoff, midTime,
     pmLateCutoff, pmLateCutoff, midTime,
     amEarlyCutoff, amEarlyCutoff, midTime,
     pmEarlyCutoff, pmEarlyCutoff, midTime,
     ...args.yearParams, fromDt, toDt, ...args.sectionParams],
  );
  const scanWithDay = scanRows.filter((r) => r.day !== null);
  const days = [...new Set(scanWithDay.map((r) => r.day as string))].sort();
  const rows: RegisterRow[] = scanWithDay.map((r) => ({
    studentId: r.student_id,
    day: r.day as string,
    firstIn: r.first_in,
    lastOut: r.last_out,
    morningIn: r.morning_in,
    morningOut: r.morning_out,
    afternoonIn: r.afternoon_in,
    afternoonOut: r.afternoon_out,
    amLate: (r.am_late ?? 0) > 0,
    pmLate: (r.pm_late ?? 0) > 0,
    amEarly: (r.am_early ?? 0) > 0,
    pmEarly: (r.pm_early ?? 0) > 0,
  }));
  return {
    windowFrom: fmtDay(windowFrom),
    windowTo: fmtDay(windowTo),
    capped,
    days,
    students: studentRows.map((s) => ({
      studentId: s.student_id,
      studentNo: s.student_no,
      fullName: s.full_name,
      gradeSection: s.grade_section,
    })),
    rows,
  };
}

async function loadAbsentee(
  args: StudentScope & { fromDt: string; toDt: string },
): Promise<AbsenteeRow[]> {
  // Compute the midpoint for AM/PM session split.
  const settings = settingsStore.get();
  const parseHM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const amOutMin = settings.am_time_out ? parseHM(settings.am_time_out) : NaN;
  let midMin = !Number.isNaN(amOutMin) ? amOutMin : 720;
  if (Number.isNaN(amOutMin)) {
    const amInMin = settings.am_time_in ? parseHM(settings.am_time_in) : NaN;
    const pmOutMin = settings.pm_time_out ? parseHM(settings.pm_time_out) : NaN;
    if (!Number.isNaN(amInMin) && !Number.isNaN(pmOutMin)) midMin = Math.round((amInMin + pmOutMin) / 2);
  }
  const midHH = String(Math.floor(midMin / 60)).padStart(2, '0');
  const midMM = String(midMin % 60).padStart(2, '0');
  const midTime = `${midHH}:${midMM}`;

  const rows = await db.query<
    {
      student_id: number;
      student_no: string;
      full_name: string;
      grade_section: string;
      parent_phone: string;
      day: string;
      sms_sent: number;
      am_present: number;
      pm_present: number;
    }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone, d.day,
            COALESCE(sc.am_present, 0) am_present, COALESCE(sc.pm_present, 0) pm_present,
            EXISTS(SELECT 1 FROM sms_logs sm JOIN attendance_logs al ON al.id = sm.attendance_id
                   WHERE al.student_id = s.id AND DATE(al.scanned_at) = d.day) sms_sent
     FROM students s ${args.yearJoin}
     JOIN (SELECT DISTINCT DATE(scanned_at) day FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?) d
     LEFT JOIN (
       SELECT student_id, DATE(scanned_at) day,
              MAX(CASE WHEN TIME(scanned_at) < ? THEN 1 ELSE 0 END) am_present,
              MAX(CASE WHEN TIME(scanned_at) >= ? THEN 1 ELSE 0 END) pm_present
       FROM attendance_logs
       WHERE scanned_at BETWEEN ? AND ?
       GROUP BY student_id, DATE(scanned_at)
     ) sc ON sc.student_id = s.id AND sc.day = d.day
     WHERE s.is_active = 1${args.sectionWhere}
       AND (COALESCE(sc.am_present, 0) = 0 OR COALESCE(sc.pm_present, 0) = 0)
     ORDER BY d.day DESC, ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name
     LIMIT ${DETAIL_ROW_CAP}`,
    [...args.yearParams, args.fromDt, args.toDt, midTime, midTime, args.fromDt, args.toDt, ...args.sectionParams],
  );
  return rows.map((r) => ({
    studentId: r.student_id,
    studentNo: r.student_no,
    fullName: r.full_name,
    gradeSection: r.grade_section,
    parentPhone: phoneOf(r.parent_phone, args.maskPhones),
    day: r.day,
    smsSent: r.sms_sent === 1,
    session: r.am_present === 0 && r.pm_present === 0 ? 'FULL' : r.am_present === 0 ? 'AM' : 'PM',
  }));
}

async function loadAbsenteeTotals(
  args: StudentScope & { fromDt: string; toDt: string },
): Promise<AbsenteeTotalsRow[]> {
  // Compute the midpoint for AM/PM session split.
  const settings = settingsStore.get();
  const parseHM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const amOutMin = settings.am_time_out ? parseHM(settings.am_time_out) : NaN;
  let midMin = !Number.isNaN(amOutMin) ? amOutMin : 720;
  if (Number.isNaN(amOutMin)) {
    const amInMin = settings.am_time_in ? parseHM(settings.am_time_in) : NaN;
    const pmOutMin = settings.pm_time_out ? parseHM(settings.pm_time_out) : NaN;
    if (!Number.isNaN(amInMin) && !Number.isNaN(pmOutMin)) midMin = Math.round((amInMin + pmOutMin) / 2);
  }
  const midHH = String(Math.floor(midMin / 60)).padStart(2, '0');
  const midMM = String(midMin % 60).padStart(2, '0');
  const midTime = `${midHH}:${midMM}`;

  const rows = await db.query<
    {
      student_id: number;
      student_no: string;
      full_name: string;
      grade_section: string;
      parent_phone: string;
      days_absent: number;
      days_absent_am: number;
      days_absent_pm: number;
    }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            COUNT(*) days_absent,
            SUM(CASE WHEN COALESCE(sc.am_present, 0) = 0 THEN 1 ELSE 0 END) days_absent_am,
            SUM(CASE WHEN COALESCE(sc.pm_present, 0) = 0 THEN 1 ELSE 0 END) days_absent_pm
     FROM students s ${args.yearJoin}
     JOIN (SELECT DISTINCT DATE(scanned_at) day FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?) d
     LEFT JOIN (
       SELECT student_id, DATE(scanned_at) day,
              MAX(CASE WHEN TIME(scanned_at) < ? THEN 1 ELSE 0 END) am_present,
              MAX(CASE WHEN TIME(scanned_at) >= ? THEN 1 ELSE 0 END) pm_present
       FROM attendance_logs
       WHERE scanned_at BETWEEN ? AND ?
       GROUP BY student_id, DATE(scanned_at)
     ) sc ON sc.student_id = s.id AND sc.day = d.day
     WHERE s.is_active = 1${args.sectionWhere}
       AND (COALESCE(sc.am_present, 0) = 0 OR COALESCE(sc.pm_present, 0) = 0)
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}, s.parent_phone
     ORDER BY days_absent DESC, ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name
     LIMIT ${DETAIL_ROW_CAP}`,
    [...args.yearParams, args.fromDt, args.toDt, midTime, midTime, args.fromDt, args.toDt, ...args.sectionParams],
  );
  return rows.map((r) => ({
    studentId: r.student_id,
    studentNo: r.student_no,
    fullName: r.full_name,
    gradeSection: r.grade_section,
    parentPhone: phoneOf(r.parent_phone, args.maskPhones),
    daysAbsent: r.days_absent,
    daysAbsentAm: r.days_absent_am,
    daysAbsentPm: r.days_absent_pm,
  }));
}

async function loadTardinessFrequency(
  args: {
    late: string;
    fromDt: string;
    toDt: string;
    sectionWhere: string;
    sectionParams: unknown[];
    yearJoin: string;
    yearParams: unknown[];
    secExpr: string;
  },
): Promise<TardinessFrequencyRow[]> {
  if (!args.late) return [];
  const rows = await db.query<
    {
      student_id: number;
      student_no: string;
      full_name: string;
      grade_section: string;
      late_count: number;
    }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, COUNT(*) late_count
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ? AND a.entry_type = 'IN' AND TIME(a.scanned_at) > ?
       ${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, ${args.secExpr}
     ORDER BY late_count DESC, ${gradeOrd(args.secExpr)}, ${args.secExpr}, s.full_name
     LIMIT ${DETAIL_ROW_CAP}`,
    [...args.yearParams, args.fromDt, args.toDt, args.late, ...args.sectionParams],
  );
  return rows.map((r) => ({
    studentId: r.student_id,
    studentNo: r.student_no,
    fullName: r.full_name,
    gradeSection: r.grade_section,
    lateCount: r.late_count,
  }));
}

async function loadTardiness(
  args: StudentScope & { late: string; fromDt: string; toDt: string },
): Promise<TardinessRow[]> {
  if (!args.late) return [];
  const rows = await db.query<
    {
      id: number;
      student_no: string;
      full_name: string;
      grade_section: string;
      parent_phone: string;
      day: string;
      scanned_time: string;
      minutes_late: number;
    }[]
  >(
    `SELECT a.id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone,
            DATE_FORMAT(a.scanned_at, '%Y-%m-%d') day,
            DATE_FORMAT(a.scanned_at, '%H:%i') scanned_time,
            TIMESTAMPDIFF(MINUTE, TIMESTAMP(DATE(a.scanned_at), ?), a.scanned_at) minutes_late
     FROM students s ${args.yearJoin} JOIN attendance_logs a ON a.student_id = s.id
     WHERE a.scanned_at BETWEEN ? AND ? AND a.entry_type = 'IN' AND TIME(a.scanned_at) > ?
       ${args.sectionWhere}
     ORDER BY a.scanned_at DESC
     LIMIT ${DETAIL_ROW_CAP}`,
    // Text order: SELECT-clause minutes-late cutoff, yearJoin, BETWEEN, late, section.
    [args.late, ...args.yearParams, args.fromDt, args.toDt, args.late, ...args.sectionParams],
  );
  return rows.map((r) => ({
    id: r.id,
    studentNo: r.student_no,
    fullName: r.full_name,
    gradeSection: r.grade_section,
    parentPhone: phoneOf(r.parent_phone, args.maskPhones),
    day: r.day,
    scannedTime: r.scanned_time,
    minutesLate: r.minutes_late,
  }));
}

async function loadStudentRecord(
  studentId: number | undefined,
  args: {
    late: string;
    early: string;
    fromDt: string;
    toDt: string;
    schoolDays: number;
    /** day → distinct-present count (school days have present > 0). */
    presentByDay: Map<string, number>;
    maskPhones: boolean;
    yearJoin: string;
    yearParams: unknown[];
    secExpr: string;
  },
): Promise<StudentRecord | null> {
  if (!studentId) return null;
  const [stu] = await db.query<
    { student_id: number; student_no: string; full_name: string; grade_section: string; parent_phone: string }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, ${args.secExpr} grade_section, s.parent_phone
     FROM students s ${args.yearJoin} WHERE s.id = ?`,
    [...args.yearParams, studentId],
  );
  if (!stu) return null;

  const scans = await db.query<
    {
      id: number;
      entry_type: 'IN' | 'OUT';
      day: string;
      time: string;
      source: string;
      flag: string;
      mins_late: number | null;
    }[]
  >(
    `SELECT a.id, a.entry_type, DATE_FORMAT(a.scanned_at, '%Y-%m-%d') day,
            DATE_FORMAT(a.scanned_at, '%H:%i') time, a.source,
            CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? THEN 'LATE'
                 WHEN a.entry_type = 'OUT' AND ? <> '' AND TIME(a.scanned_at) < ? THEN 'EARLY'
                 ELSE '' END flag,
            CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ?
                 THEN TIMESTAMPDIFF(MINUTE, TIMESTAMP(DATE(a.scanned_at), ?), a.scanned_at) END mins_late
     FROM attendance_logs a
     WHERE a.student_id = ? AND a.scanned_at BETWEEN ? AND ?
     ORDER BY a.scanned_at ASC
     LIMIT ${DETAIL_ROW_CAP}`,
    // Text order: flag CASE (late×2, early×2), mins_late CASE (late×3), WHERE.
    [args.late, args.late, args.early, args.early, args.late, args.late, args.late, studentId, args.fromDt, args.toDt],
  );
  const [smsRow] = await db.query<{ c: number; last_status: string | null }[]>(
    `SELECT COUNT(*) c, SUBSTRING_INDEX(GROUP_CONCAT(sm.status ORDER BY sm.id DESC), ',', 1) last_status
     FROM sms_logs sm JOIN attendance_logs al ON al.id = sm.attendance_id
     WHERE al.student_id = ? AND al.scanned_at BETWEEN ? AND ?`,
    [studentId, args.fromDt, args.toDt],
  );

  // Group scans by day (already ascending by scanned_at) and total the summary.
  const byDay = new Map<string, StudentScanRow[]>();
  const presentDays = new Set<string>();
  const lateDays = new Set<string>();
  const lateDaysAm = new Set<string>();
  const lateDaysPm = new Set<string>();
  let totalIn = 0;
  let totalInAm = 0;
  let totalInPm = 0;
  let totalOut = 0;
  let totalOutAm = 0;
  let totalOutPm = 0;
  let totalMinutesLate = 0;
  let totalMinutesLateAm = 0;
  let totalMinutesLatePm = 0;
  for (const r of scans) {
    const row: StudentScanRow = {
      id: r.id,
      time: r.time,
      entryType: r.entry_type,
      flag: r.flag as StudentScanRow['flag'],
      source: r.source as StudentScanRow['source'],
      ...(r.mins_late != null ? { minsLate: r.mins_late } : {}),
    };
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day)!.push(row);
    if (r.entry_type === 'IN') {
      totalIn++;
      if (r.flag === 'LATE') {
        lateDays.add(r.day);
        totalMinutesLate += r.mins_late ?? 0;
      }
    } else {
      totalOut++;
    }
    presentDays.add(r.day);
  }
  // We'll compute AM/PM totals after we know the midpoint (below).

  // One row per calendar day: present/late/absent plus the day's scans.
  const from = parseDay(args.fromDt.slice(0, 10))!;
  const to = parseDay(args.toDt.slice(0, 10))!;
  // Midpoint for morning/afternoon split using AM/PM times
  const studentSettings = settingsStore.get();
  const parseHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const stdAmOut = studentSettings.am_time_out ? parseHHMM(studentSettings.am_time_out) : NaN;
  let midMin = !Number.isNaN(stdAmOut) ? stdAmOut : 720;
  if (Number.isNaN(stdAmOut)) {
    const stdAmIn = studentSettings.am_time_in ? parseHHMM(studentSettings.am_time_in) : NaN;
    const stdPmOut = studentSettings.pm_time_out ? parseHHMM(studentSettings.pm_time_out) : NaN;
    if (!Number.isNaN(stdAmIn) && !Number.isNaN(stdPmOut)) midMin = Math.round((stdAmIn + stdPmOut) / 2);
  }
  const midHH = String(Math.floor(midMin / 60)).padStart(2, '0');
  const midMM = String(midMin % 60).padStart(2, '0');
  const midStr = `${midHH}:${midMM}`;

  // Compute AM/PM IN/OUT totals and late day splits using the midpoint.
  for (const [day, dayScans] of byDay) {
    for (const sc of dayScans) {
      const isAm = sc.time < midStr;
      if (sc.entryType === 'IN') {
        if (isAm) totalInAm++; else totalInPm++;
        if (sc.flag === 'LATE') {
          if (isAm) lateDaysAm.add(day); else lateDaysPm.add(day);
          if (sc.minsLate != null) {
            if (isAm) totalMinutesLateAm += sc.minsLate; else totalMinutesLatePm += sc.minsLate;
          }
        }
      } else {
        if (isAm) totalOutAm++; else totalOutPm++;
      }
    }
  }

  const days: StudentDayRow[] = [];
  for (let d = new Date(from); d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    const key = fmtDay(d);
    const dayScans = byDay.get(key) ?? [];
    const am = dayScans.filter((s) => s.time < midStr);
    const pm = dayScans.filter((s) => s.time >= midStr);
    days.push({
      day: key,
      schoolDay: (args.presentByDay.get(key) ?? 0) > 0,
      present: dayScans.length > 0,
      late: dayScans.some((s) => s.flag === 'LATE'),
      early: dayScans.some((s) => s.flag === 'EARLY'),
      amLate: am.some((s) => s.entryType === 'IN' && s.flag === 'LATE'),
      pmLate: pm.some((s) => s.entryType === 'IN' && s.flag === 'LATE'),
      amEarly: am.some((s) => s.entryType === 'OUT' && s.flag === 'EARLY'),
      pmEarly: pm.some((s) => s.entryType === 'OUT' && s.flag === 'EARLY'),
      amPresent: am.length > 0,
      pmPresent: pm.length > 0,
      firstIn: dayScans.find((s) => s.entryType === 'IN')?.time ?? null,
      lastOut: [...dayScans].reverse().find((s) => s.entryType === 'OUT')?.time ?? null,
      morningIn: am.find((s) => s.entryType === 'IN')?.time ?? null,
      morningOut: [...am].reverse().find((s) => s.entryType === 'OUT')?.time ?? null,
      afternoonIn: pm.find((s) => s.entryType === 'IN')?.time ?? null,
      afternoonOut: [...pm].reverse().find((s) => s.entryType === 'OUT')?.time ?? null,
      scans: dayScans,
    });
  }

  // Compute AM/PM absent days (school days with zero AM / zero PM scans).
  let daysAbsentAm = 0;
  let daysAbsentPm = 0;
  for (let d = new Date(from); d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    const key = fmtDay(d);
    const isSchoolDay = (args.presentByDay.get(key) ?? 0) > 0;
    if (!isSchoolDay) continue;
    const dayScans = byDay.get(key) ?? [];
    if (!dayScans.some((s) => s.time < midStr)) daysAbsentAm++;
    if (!dayScans.some((s) => s.time >= midStr)) daysAbsentPm++;
  }

  return {
    studentId: stu.student_id,
    studentNo: stu.student_no,
    fullName: stu.full_name,
    gradeSection: stu.grade_section,
    parentPhone: args.maskPhones ? maskPhone(stu.parent_phone) : stu.parent_phone,
    summary: {
      daysPresent: presentDays.size,
      daysLate: lateDays.size,
      daysLateAm: lateDaysAm.size,
      daysLatePm: lateDaysPm.size,
      daysAbsent: Math.max(0, args.schoolDays - presentDays.size),
      daysAbsentAm,
      daysAbsentPm,
      attendanceRate: args.schoolDays > 0 ? (presentDays.size / args.schoolDays) * 100 : null,
      totalIn,
      totalInAm,
      totalInPm,
      totalOut,
      totalOutAm,
      totalOutPm,
      totalMinutesLate,
      totalMinutesLateAm,
      totalMinutesLatePm,
      smsCount: smsRow?.c ?? 0,
      lastSmsStatus: (smsRow?.last_status as SmsStatus) || null,
    },
    days,
  };
}

async function loadSmsAudit(args: { maskPhones: boolean; fromDt: string; toDt: string }): Promise<{
  daily: SmsAuditDay[];
  failures: SmsFailureRow[];
}> {
  const daily = await db.query<SmsAuditDay[]>(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') day, COUNT(*) total,
            COALESCE(SUM(status = 'SENT'), 0) sent,
            COALESCE(SUM(status = 'PENDING'), 0) pending,
            COALESCE(SUM(status = 'FAILED'), 0) failed
     FROM sms_logs WHERE created_at BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d') ORDER BY day`,
    [args.fromDt, args.toDt],
  );
  const failures = await db.query<
    {
      id: number;
      parent_phone: string;
      full_name: string | null;
      provider: string | null;
      attempts: number;
      error: string | null;
      created_at: string;
    }[]
  >(
    `SELECT sm.id, sm.parent_phone, s.full_name, sm.provider, sm.attempts, sm.error,
            DATE_FORMAT(sm.created_at, '%Y-%m-%d %H:%i') created_at
     FROM sms_logs sm
     LEFT JOIN attendance_logs a ON a.id = sm.attendance_id
     LEFT JOIN students s ON s.id = a.student_id
     WHERE sm.status = 'FAILED' AND sm.created_at BETWEEN ? AND ?
     ORDER BY sm.id DESC
     LIMIT ${SMS_FAILURE_CAP}`,
    [args.fromDt, args.toDt],
  );
  return {
    daily,
    failures: failures.map((r) => ({
      id: r.id,
      parentPhone: phoneOf(r.parent_phone, args.maskPhones),
      fullName: r.full_name,
      provider: r.provider,
      attempts: r.attempts,
      error: r.error,
      createdAt: r.created_at,
    })),
  };
}

async function loadTrends(args: {
  dayPresence: { day: string; present: number }[];
  activeStudents: number;
  fromDt: string;
  toDt: string;
}): Promise<ReportTrends> {
  // Weekly buckets (ISO weeks, Monday start) and day-of-week, both from the
  // already-computed daily distinct-present counts.
  const isoWeek = (day: string): { start: string; key: string } => {
    const [y, m, d] = day.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dow = (date.getDay() + 6) % 7; // Monday = 0
    const start = addDays(date, -dow);
    return { start: fmtDay(start), key: fmtDay(start) };
  };

  const weekly = new Map<string, { weekStart: string; days: number; presentDays: number }>();
  const dow = Array.from({ length: 7 }, (_, weekday) => ({ weekday, days: 0, presentDays: 0 }));
  for (const r of args.dayPresence) {
    const { key, start } = isoWeek(r.day);
    const w = weekly.get(key) ?? { weekStart: start, days: 0, presentDays: 0 };
    w.days++;
    w.presentDays += r.present;
    weekly.set(key, w);
    const [yy, mm, dd] = r.day.split('-').map(Number);
    const weekday = (new Date(yy, mm - 1, dd).getDay() + 6) % 7;
    dow[weekday].days++;
    dow[weekday].presentDays += r.present;
  }

  const gateHours = await db.query<{ hour: number; entry_type: 'IN' | 'OUT'; c: number }[]>(
    `SELECT HOUR(scanned_at) hour, entry_type, COUNT(*) c
     FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?
     GROUP BY HOUR(scanned_at), entry_type`,
    [args.fromDt, args.toDt],
  );
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const row = gateHours.filter((h) => h.hour === hour);
    return {
      hour,
      in: row.filter((r) => r.entry_type === 'IN').reduce((s, r) => s + r.c, 0),
      out: row.filter((r) => r.entry_type === 'OUT').reduce((s, r) => s + r.c, 0),
    };
  });

  const rate = (presentDays: number, days: number): number | null =>
    days > 0 && args.activeStudents > 0 ? (presentDays / (args.activeStudents * days)) * 100 : null;

  return {
    weekly: [...weekly.values()]
      .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
      .map((w) => ({ ...w, attendanceRate: rate(w.presentDays, w.days) })),
    dayOfWeek: dow.map((d) => ({ ...d, attendanceRate: rate(d.presentDays, d.days) })),
    gateHours: hours,
  };
}
