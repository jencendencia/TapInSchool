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
  ReportQuery,
  ReportRegister,
  ReportTrends,
  SmsAuditDay,
  SmsFailureRow,
  SmsStatus,
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
  const sectionWhere = section ? ` AND s.grade_section = ?` : '';
  const sectionParams: unknown[] = section ? [section] : [];

  const count = async (sql: string, params?: unknown[]): Promise<number> => {
    const [row] = await db.query<{ c: number }[]>(sql, params);
    return row?.c ?? 0;
  };

  // ---- Always-computed pieces (summary + daily) ---------------------------
  const sectionsRows = await db.query<{ grade_section: string }[]>(
    `SELECT DISTINCT grade_section FROM students WHERE grade_section <> '' ORDER BY grade_section`,
  );
  const sections = sectionsRows.map((r) => r.grade_section);

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

  const dailyRows = await db.query<
    { day: string; scans: number; ins: number; outs: number; late: number; early: number }[]
  >(
    `SELECT DATE_FORMAT(scanned_at, '%Y-%m-%d') day,
            COUNT(*) scans,
            COALESCE(SUM(entry_type = 'IN'), 0) ins,
            COALESCE(SUM(entry_type = 'OUT'), 0) outs,
            COALESCE(SUM(entry_type = 'IN' AND ? <> '' AND TIME(scanned_at) > ?), 0) late,
            COALESCE(SUM(entry_type = 'OUT' AND ? <> '' AND TIME(scanned_at) < ?), 0) early
     FROM attendance_logs
     WHERE scanned_at BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(scanned_at, '%Y-%m-%d')
     ORDER BY day`,
    [late, late, early, early, fromDt, toDt],
  );
  const byDay = new Map(dailyRows.map((r) => [r.day, r]));
  const daily = [];
  // Absence is scan-derived per REPORTS_PLAN §2 (user decision): an active
  // student with zero scans on a gate-used day is absent that day. Non-gate
  // days (weekends/holidays) count as neither present nor absent.
  for (let d = new Date(from); d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    const key = fmtDay(d);
    const r = byDay.get(key);
    const presentDay = presentByDay.get(key) ?? 0;
    daily.push({
      day: key,
      scans: r?.scans ?? 0,
      in: r?.ins ?? 0,
      out: r?.outs ?? 0,
      late: r?.late ?? 0,
      early: r?.early ?? 0,
      absent: r ? Math.max(0, activeStudents - presentDay) : 0,
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

  if (type === 'per-student') {
    perStudent = await loadPerStudent({ section, maskPhones, late, fromDt, toDt, schoolDays, sectionWhere, sectionParams });
  } else if (type === 'per-section') {
    perSection = await loadPerSection({ late, early, fromDt, toDt, schoolDays });
  } else if (type === 'register') {
    register = await loadRegister({ late, fromDt, toDt, sectionWhere, sectionParams });
  } else if (type === 'absentee') {
    absentee = await loadAbsentee({ section, maskPhones, fromDt, toDt, sectionWhere, sectionParams });
    absenteeTotals = await loadAbsenteeTotals({ maskPhones, fromDt, toDt, sectionWhere, sectionParams });
  } else if (type === 'tardiness') {
    tardiness = await loadTardiness({ section, maskPhones, late, fromDt, toDt, sectionWhere, sectionParams });
    tardinessFrequency = await loadTardinessFrequency({ late, fromDt, toDt, sectionWhere, sectionParams });
  } else if (type === 'sms-audit') {
    smsAudit = await loadSmsAudit({ maskPhones, fromDt, toDt });
  } else if (type === 'trends') {
    trends = await loadTrends({ dayPresence, activeStudents, fromDt, toDt });
  }

  return {
    schoolName: settings.school_name || 'TapIn School',
    from: fromStr,
    to: toStr,
    generatedAt: new Date().toISOString(),
    type,
    section,
    maskPhones,
    sections,
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
  };
}

// ---------------------------------------------------------------------------
// Per-type loaders
// ---------------------------------------------------------------------------

interface StudentScope {
  section?: string;
  maskPhones: boolean;
  sectionWhere: string;
  sectionParams: unknown[];
}

function phoneOf(phone: string, maskPhones: boolean): string {
  return maskPhones ? maskPhone(phone) : phone;
}

async function loadPerStudent(
  args: StudentScope & { late: string; fromDt: string; toDt: string; schoolDays: number },
): Promise<PerStudentRow[]> {
  const lateSub = args.late
    ? `LEFT JOIN (SELECT student_id, SUM(TIMESTAMPDIFF(MINUTE, TIMESTAMP(DATE(scanned_at), ?), scanned_at)) late_mins
                  FROM attendance_logs WHERE scanned_at BETWEEN ? AND ? AND entry_type = 'IN' AND TIME(scanned_at) > ?
                  GROUP BY student_id) lm ON lm.student_id = s.id`
    : '';
  const lateMinsSel = args.late ? 'COALESCE(lm.late_mins, 0)' : '0';
  const lateParams = args.late ? [args.late, args.fromDt, args.toDt, args.late] : [];
  const rows = await db.query<
    {
      student_id: number;
      student_no: string;
      full_name: string;
      grade_section: string;
      parent_phone: string;
      present_days: number;
      late_days: number;
      total_in: number;
      total_out: number;
      late_mins: number;
      sms_count: number;
      last_status: string | null;
    }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, s.grade_section, s.parent_phone,
            COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN DATE(a.scanned_at) END) present_days,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? THEN DATE(a.scanned_at) END) late_days,
            COALESCE(SUM(a.entry_type = 'IN'), 0) total_in,
            COALESCE(SUM(a.entry_type = 'OUT'), 0) total_out,
            ${lateMinsSel} late_mins,
            COALESCE(ssm.sms_count, 0) sms_count,
            ssm.last_status last_status
     FROM students s
     LEFT JOIN attendance_logs a ON a.student_id = s.id AND a.scanned_at BETWEEN ? AND ?
     ${lateSub}
     LEFT JOIN (SELECT al.student_id, COUNT(*) sms_count,
                       SUBSTRING_INDEX(GROUP_CONCAT(sm.status ORDER BY sm.id DESC), ',', 1) last_status
                FROM sms_logs sm JOIN attendance_logs al ON al.id = sm.attendance_id
                WHERE al.scanned_at BETWEEN ? AND ? GROUP BY al.student_id) ssm ON ssm.student_id = s.id
     WHERE s.is_active = 1${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, s.grade_section, s.parent_phone
     ORDER BY s.grade_section, s.full_name`,
    [args.late, args.late, args.fromDt, args.toDt, ...lateParams, args.fromDt, args.toDt, ...args.sectionParams],
  );
  const schoolDays = args.schoolDays;
  return rows.map((r) => ({
    studentId: r.student_id,
    studentNo: r.student_no,
    fullName: r.full_name,
    gradeSection: r.grade_section,
    parentPhone: phoneOf(r.parent_phone, args.maskPhones),
    daysPresent: r.present_days,
    daysLate: r.late_days,
    daysAbsent: Math.max(0, schoolDays - r.present_days),
    attendanceRate: schoolDays > 0 ? (r.present_days / schoolDays) * 100 : null,
    totalIn: r.total_in,
    totalOut: r.total_out,
    totalMinutesLate: r.late_mins ?? 0,
    smsCount: r.sms_count,
    lastSmsStatus: (r.last_status as SmsStatus) || null,
  }));
}

async function loadPerSection(args: {
  late: string;
  early: string;
  fromDt: string;
  toDt: string;
  schoolDays: number;
}): Promise<PerSectionRow[]> {
  const enrolledRows = await db.query<{ grade_section: string; c: number }[]>(
    `SELECT grade_section, COUNT(*) c FROM students WHERE is_active = 1 GROUP BY grade_section`,
  );
  const presentRows = await db.query<{ grade_section: string; present: number }[]>(
    `SELECT s.grade_section, COUNT(DISTINCT a.student_id) present
     FROM attendance_logs a JOIN students s ON s.id = a.student_id
     WHERE a.scanned_at BETWEEN ? AND ? GROUP BY s.grade_section`,
    [args.fromDt, args.toDt],
  );
  const flagRows = await db.query<{ grade_section: string; late: number; early: number }[]>(
    `SELECT s.grade_section,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'IN' AND ? <> '' AND TIME(a.scanned_at) > ? THEN a.student_id END) late,
            COUNT(DISTINCT CASE WHEN a.entry_type = 'OUT' AND ? <> '' AND TIME(a.scanned_at) < ? THEN a.student_id END) early
     FROM attendance_logs a JOIN students s ON s.id = a.student_id
     WHERE a.scanned_at BETWEEN ? AND ? GROUP BY s.grade_section`,
    [args.late, args.late, args.early, args.early, args.fromDt, args.toDt],
  );
  const daySectionPresent = await db.query<{ grade_section: string; present: number }[]>(
    `SELECT s.grade_section, COUNT(DISTINCT a.student_id) present
     FROM attendance_logs a JOIN students s ON s.id = a.student_id
     WHERE a.scanned_at BETWEEN ? AND ?
     GROUP BY DATE(a.scanned_at), s.grade_section`,
    [args.fromDt, args.toDt],
  );
  const sumBySection = new Map<string, number>();
  for (const r of daySectionPresent) sumBySection.set(r.grade_section, (sumBySection.get(r.grade_section) ?? 0) + r.present);

  const enrolled = new Map(enrolledRows.map((r) => [r.grade_section, r.c]));
  const present = new Map(presentRows.map((r) => [r.grade_section, r.present]));
  const flags = new Map(flagRows.map((r) => [r.grade_section, r]));
  const sections = new Set([...enrolled.keys(), ...present.keys()]);
  return [...sections]
    .sort()
    .map((gradeSection) => {
      const enrolledCount = enrolled.get(gradeSection) ?? 0;
      const presentCount = present.get(gradeSection) ?? 0;
      const sumPres = sumBySection.get(gradeSection) ?? 0;
      const rate =
        enrolledCount > 0 && args.schoolDays > 0 ? (sumPres / (enrolledCount * args.schoolDays)) * 100 : null;
      return {
        gradeSection,
        enrolled: enrolledCount,
        present: presentCount,
        absent: Math.max(0, enrolledCount - presentCount),
        late: flags.get(gradeSection)?.late ?? 0,
        early: flags.get(gradeSection)?.early ?? 0,
        attendanceRate: rate,
      };
    });
}

async function loadRegister(args: {
  late: string;
  fromDt: string;
  toDt: string;
  sectionWhere: string;
  sectionParams: unknown[];
}): Promise<ReportRegister> {
  const rangeDays = Math.round((new Date(args.toDt.slice(0, 10)).getTime() - new Date(args.fromDt.slice(0, 10)).getTime()) / 86400000) + 1;
  const capped = rangeDays > REGISTER_MAX_DAYS;
  const windowTo = new Date(args.toDt.slice(0, 10));
  const windowFrom = capped ? addDays(windowTo, -(REGISTER_MAX_DAYS - 1)) : new Date(args.fromDt.slice(0, 10));
  const fromDt = `${fmtDay(windowFrom)} 00:00:00`;
  const toDt = `${fmtDay(windowTo)} 23:59:59`;

  const studentRows = await db.query<{ student_id: number; student_no: string; full_name: string; grade_section: string }[]>(
    `SELECT id student_id, student_no, full_name, grade_section FROM students
     WHERE is_active = 1${args.sectionWhere} ORDER BY grade_section, full_name`,
    args.sectionParams,
  );
  const scanRows = await db.query<
    { student_id: number; day: string; first_in: string | null; last_out: string | null }[]
  >(
    `SELECT s.id student_id, DATE_FORMAT(a.scanned_at, '%Y-%m-%d') day,
            DATE_FORMAT(MIN(CASE WHEN a.entry_type = 'IN' THEN a.scanned_at END), '%H:%i') first_in,
            DATE_FORMAT(MAX(CASE WHEN a.entry_type = 'OUT' THEN a.scanned_at END), '%H:%i') last_out     FROM students s
     LEFT JOIN attendance_logs a ON a.student_id = s.id AND a.scanned_at BETWEEN ? AND ?
     -- a.id IS NOT NULL drops the LEFT-JOIN rows for students with zero scans
     -- in the window - those would have day = NULL and crash the matrix
     -- renderer (null.slice). Absent students still appear via the students list.
     WHERE s.is_active = 1 AND a.id IS NOT NULL${args.sectionWhere}
     -- GROUP BY must use the SAME expression as the SELECT day column, else
     -- MySQL rejects the query under sql_mode=only_full_group_by (errno 1055).
     GROUP BY s.id, DATE_FORMAT(a.scanned_at, '%Y-%m-%d')`,
    [fromDt, toDt, ...args.sectionParams],
  );
  const scanWithDay = scanRows.filter((r) => r.day !== null);
  const days = [...new Set(scanWithDay.map((r) => r.day as string))].sort();
  const rows: RegisterRow[] = scanWithDay.map((r) => ({ studentId: r.student_id, day: r.day as string, firstIn: r.first_in, lastOut: r.last_out }));
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
  const rows = await db.query<
    {
      student_id: number;
      student_no: string;
      full_name: string;
      grade_section: string;
      parent_phone: string;
      day: string;
      sms_sent: number;
    }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, s.grade_section, s.parent_phone, d.day,
            EXISTS(SELECT 1 FROM sms_logs sm JOIN attendance_logs al ON al.id = sm.attendance_id
                   WHERE al.student_id = s.id AND DATE(al.scanned_at) = d.day) sms_sent
     FROM students s
     JOIN (SELECT DISTINCT DATE(scanned_at) day FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?) d
     WHERE s.is_active = 1${args.sectionWhere}
       AND NOT EXISTS (SELECT 1 FROM attendance_logs a
                       WHERE a.student_id = s.id AND a.scanned_at BETWEEN ? AND ? AND DATE(a.scanned_at) = d.day)
     ORDER BY d.day DESC, s.grade_section, s.full_name
     LIMIT ${DETAIL_ROW_CAP}`,
    [args.fromDt, args.toDt, args.fromDt, args.toDt, ...args.sectionParams],
  );
  return rows.map((r) => ({
    studentId: r.student_id,
    studentNo: r.student_no,
    fullName: r.full_name,
    gradeSection: r.grade_section,
    parentPhone: phoneOf(r.parent_phone, args.maskPhones),
    day: r.day,
    smsSent: r.sms_sent === 1,
  }));
}

async function loadAbsenteeTotals(
  args: StudentScope & { fromDt: string; toDt: string },
): Promise<AbsenteeTotalsRow[]> {
  const rows = await db.query<
    {
      student_id: number;
      student_no: string;
      full_name: string;
      grade_section: string;
      parent_phone: string;
      days_absent: number;
    }[]
  >(
    `SELECT s.id student_id, s.student_no, s.full_name, s.grade_section, s.parent_phone, COUNT(*) days_absent
     FROM students s
     JOIN (SELECT DISTINCT DATE(scanned_at) day FROM attendance_logs WHERE scanned_at BETWEEN ? AND ?) d
     WHERE s.is_active = 1${args.sectionWhere}
       AND NOT EXISTS (SELECT 1 FROM attendance_logs a
                       WHERE a.student_id = s.id AND a.scanned_at BETWEEN ? AND ? AND DATE(a.scanned_at) = d.day)
     GROUP BY s.id, s.student_no, s.full_name, s.grade_section, s.parent_phone
     ORDER BY days_absent DESC, s.grade_section, s.full_name
     LIMIT ${DETAIL_ROW_CAP}`,
    [args.fromDt, args.toDt, args.fromDt, args.toDt, ...args.sectionParams],
  );
  return rows.map((r) => ({
    studentId: r.student_id,
    studentNo: r.student_no,
    fullName: r.full_name,
    gradeSection: r.grade_section,
    parentPhone: phoneOf(r.parent_phone, args.maskPhones),
    daysAbsent: r.days_absent,
  }));
}

async function loadTardinessFrequency(
  args: { late: string; fromDt: string; toDt: string; sectionWhere: string; sectionParams: unknown[] },
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
    `SELECT s.id student_id, s.student_no, s.full_name, s.grade_section, COUNT(*) late_count
     FROM attendance_logs a JOIN students s ON s.id = a.student_id
     WHERE a.scanned_at BETWEEN ? AND ? AND a.entry_type = 'IN' AND TIME(a.scanned_at) > ?
       ${args.sectionWhere}
     GROUP BY s.id, s.student_no, s.full_name, s.grade_section
     ORDER BY late_count DESC, s.grade_section, s.full_name
     LIMIT ${DETAIL_ROW_CAP}`,
    [args.fromDt, args.toDt, args.late, ...args.sectionParams],
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
    `SELECT a.id, s.student_no, s.full_name, s.grade_section, s.parent_phone,
            DATE_FORMAT(a.scanned_at, '%Y-%m-%d') day,
            DATE_FORMAT(a.scanned_at, '%H:%i') scanned_time,
            TIMESTAMPDIFF(MINUTE, TIMESTAMP(DATE(a.scanned_at), ?), a.scanned_at) minutes_late
     FROM attendance_logs a JOIN students s ON s.id = a.student_id
     WHERE a.scanned_at BETWEEN ? AND ? AND a.entry_type = 'IN' AND TIME(a.scanned_at) > ?
       ${args.sectionWhere}
     ORDER BY a.scanned_at DESC
     LIMIT ${DETAIL_ROW_CAP}`,
    [args.late, args.fromDt, args.toDt, args.late, ...args.sectionParams],
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
     ORDER BY sm.created_at DESC
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
