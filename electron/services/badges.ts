// Attendance badges (FEATURE_IMPROVEMENT_PLAN 7.8 — BADGE_RANKING_PLAN.md rev. 2+).
//
// Positive / lenient model: a student earns an "Attendance Champion" badge for
// every window (week → Bronze, month → Silver, quarter → Gold, school year →
// Platinum) in which they were present every NON-EXCUSED school day, and a
// "Punctuality Champion" badge when they were also never LATE/EARLY on a
// non-excused day. Excused days (sick, religious observance, school-recognized
// activity) are neutral — they never break a badge. A window needs at least
// BADGE_MIN_SCHOOL_DAYS non-excused school days to count at all. Stored rows
// are authoritative-recomputed from the source data, so manual log corrections
// and excuse edits self-heal badges.
//
// Window math (Mon–Sun week, calendar month, calendar quarter, school year
// Jun 1 → Mar 31) lives in shared/badge-windows.ts and is shared with the
// browser mock so demo mode always agrees with the real backend.
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { computeScanFlag } from './bell-times';
import {
  BADGE_MIN_SCHOOL_DAYS,
  addDays,
  currentBadgePeriods,
  fmtDay,
  parseDay,
  recomputeBadgePeriods,
  type BadgePeriod,
  type BadgeWindowKind,
} from '../../shared/badge-windows';
import { BADGE_INFO } from '../../shared/types';
import type {
  Badge,
  BadgeCode,
  BadgeLeaderboardRow,
  BadgeWeekProgress,
  Excuse,
  ExcuseCategory,
  Settings,
  StudentBadgeSummary,
} from '../../shared/types';

const RECOMPUTE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

interface BadgeRow {
  id: number;
  student_id: number;
  school_year: string;
  badge_code: BadgeCode;
  week_start: string;
  earned_at: string;
}
interface ExcuseRow {
  id: number;
  student_id: number;
  excuse_date: string;
  category: ExcuseCategory;
  note: string;
}
interface ScanRow {
  entry_type: 'IN' | 'OUT';
  scanned_at: Date | string;
}

/** The DB stores every window's start in the `week_start` column (kept for
 *  backward compatibility); `periodStart` is its generic name in the API. */
const toBadge = (r: BadgeRow): Badge => ({
  id: r.id,
  studentId: r.student_id,
  schoolYear: r.school_year,
  badgeCode: r.badge_code,
  periodStart: fmtDay(parseDay(r.week_start)),
  earnedAt: r.earned_at,
});
const toExcuse = (r: ExcuseRow): Excuse => ({
  id: r.id,
  studentId: r.student_id,
  excuseDate: fmtDay(parseDay(r.excuse_date)),
  category: r.category,
  note: r.note || '',
});

export async function currentSchoolYearName(): Promise<string> {
  const rows = await db.query<{ name: string }[]>(
    'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
  );
  return rows[0]?.name ?? String(new Date().getFullYear());
}

// ---- Self-heal -------------------------------------------------------------
// The app boot applies these tables via SCHEMA_SQL (db/schema.ts), but the
// badge service can start before that pass finishes — or the DB can connect
// after an offline boot — so re-ensure them cheaply (CREATE IF NOT EXISTS is
// a metadata-only no-op when they already exist). Mirrors db/schema.ts; keep
// in sync if the schema changes.
let badgeTablesEnsured = false;
async function ensureBadgeTables(): Promise<void> {
  if (badgeTablesEnsured || !db.isOnline()) return;
  await db.query(`CREATE TABLE IF NOT EXISTS student_badges (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id INT UNSIGNED NOT NULL,
    school_year VARCHAR(32) NOT NULL,
    badge_code VARCHAR(16) NOT NULL,
    week_start DATE NOT NULL,
    earned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_student_badge (student_id, school_year, badge_code, week_start),
    KEY idx_badges_year (school_year),
    CONSTRAINT fk_badge_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS excuses (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id INT UNSIGNED NOT NULL,
    excuse_date DATE NOT NULL,
    category ENUM('SICK','RELIGIOUS','SCHOOL_ACTIVITY','OTHER') NOT NULL DEFAULT 'OTHER',
    note VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_excuse_student_date (student_id, excuse_date),
    KEY idx_excuses_date (excuse_date),
    CONSTRAINT fk_excuse_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  badgeTablesEnsured = true;
}

// ---- Window evaluation ------------------------------------------------------

/** One window's outcome for a student. */
interface PeriodResult {
  kind: BadgeWindowKind;
  /** YYYY-MM-DD start of the window (the stored period key). */
  periodKey: string;
  /** Non-excused school days (on/after the join day) in the window. */
  requiredDays: number;
  /** Distinct days the student scanned in the window (on/after join day). */
  presentDays: number;
  /** School days in the window the school has excused for the student. */
  excusedDays: number;
  /** True once the attendance badge can no longer be earned this window. */
  attendanceMissed: boolean;
  /** True when a LATE/EARLY flag exists on a non-excused day this window. */
  punctualityMissed: boolean;
  attendanceComplete: boolean;
  punctualityComplete: boolean;
}

const ATT_CODE: Record<BadgeWindowKind, BadgeCode> = {
  week: 'ATT_W',
  month: 'ATT_M',
  quarter: 'ATT_Q',
  year: 'ATT_Y',
};
const PUNCT_CODE: Record<BadgeWindowKind, BadgeCode> = {
  week: 'PUNCT_W',
  month: 'PUNCT_M',
  quarter: 'PUNCT_Q',
  year: 'PUNCT_Y',
};

/** The badge codes a completed window earns (attendance + maybe punctuality). */
function codesFor(res: Pick<PeriodResult, 'kind' | 'attendanceComplete' | 'punctualityComplete'>): BadgeCode[] {
  const codes: BadgeCode[] = [];
  if (res.attendanceComplete) codes.push(ATT_CODE[res.kind]);
  if (res.punctualityComplete) codes.push(PUNCT_CODE[res.kind]);
  return codes;
}

/** Evaluates many windows for one student against a single set of source
 *  queries (school days / scans / excuses fetched once for the whole span).
 *  School days use the gate-used heuristic shared with absence.ts + report.ts;
 *  LATE/EARLY reuse bell-times.ts so badges can never disagree with Logs. */
async function evaluatePeriods(
  studentId: number,
  periods: BadgePeriod[],
  settings: Settings,
  joinKey: string | null,
): Promise<PeriodResult[]> {
  if (!periods.length) return [];
  // The periods are grouped by kind (weeks, then months, …), not sorted by
  // start date — always query the TRUE earliest start / latest end so a long
  // window (e.g. the school-year one) is never evaluated against a truncated
  // range of school days.
  let firstStart = periods[0].start;
  let lastEnd = periods[0].end;
  for (const p of periods) {
    if (p.start.getTime() < firstStart.getTime()) firstStart = p.start;
    if (p.end.getTime() > lastEnd.getTime()) lastEnd = p.end;
  }
  const firstKey = fmtDay(firstStart);
  const lastEndKey = fmtDay(lastEnd);
  const [schoolRows, scanRows, excRows] = await Promise.all([
    db.query<{ d: string }[]>(
      'SELECT DISTINCT DATE(scanned_at) d FROM attendance_logs WHERE scanned_at >= ? AND scanned_at < ?',
      [firstKey, lastEndKey],
    ),
    db.query<ScanRow[]>(
      `SELECT entry_type, scanned_at FROM attendance_logs
       WHERE student_id = ? AND scanned_at >= ? AND scanned_at < ?`,
      [studentId, firstKey, lastEndKey],
    ),
    db.query<{ excuse_date: string }[]>(
      'SELECT excuse_date FROM excuses WHERE student_id = ? AND excuse_date >= ? AND excuse_date < ?',
      [studentId, firstKey, lastEndKey],
    ),
  ]);
  const schoolSet = new Set(schoolRows.map((r) => fmtDay(parseDay(r.d))));
  const excSet = new Set(excRows.map((r) => fmtDay(parseDay(r.excuse_date))));
  const presentDays = new Set<string>();
  const punctMissedDays = new Set<string>();
  for (const sc of scanRows) {
    const at = toDate(sc.scanned_at);
    const d = fmtDay(at);
    presentDays.add(d);
    if (!excSet.has(d) && computeScanFlag(sc.entry_type, at, settings)) punctMissedDays.add(d);
  }

  return periods.map((period) => {
    const startKey = period.key;
    const endKey = fmtDay(period.end);
    const inRange = (d: string) => d >= startKey && d < endKey;
    const afterJoin = (d: string) => !joinKey || d >= joinKey;
    const requiredDays = [...schoolSet].filter((d) => inRange(d) && afterJoin(d) && !excSet.has(d)).length;
    const present = [...presentDays].filter((d) => inRange(d) && afterJoin(d)).length;
    const punctualityMissed = [...punctMissedDays].some((d) => inRange(d) && afterJoin(d));
    const active = requiredDays >= BADGE_MIN_SCHOOL_DAYS[period.kind];
    const attendanceComplete = active && present >= requiredDays;
    return {
      kind: period.kind,
      periodKey: period.key,
      requiredDays,
      presentDays: present,
      excusedDays: [...schoolSet].filter((d) => inRange(d) && excSet.has(d)).length,
      attendanceMissed: active && !attendanceComplete,
      punctualityMissed,
      attendanceComplete,
      punctualityComplete: attendanceComplete && !punctualityMissed,
    };
  });
}

/** Diffes `results` against the stored rows for (student, school year) and
 *  inserts/deletes rows so badges always equal what is currently earned.
 *  When `currentOnly` is given (kiosk path), only those period keys are
 *  reconciled; older periods' stored rows are left untouched. Returns the
 *  first badge this call inserted (the kiosk celebrates it). */
async function syncBadges(
  studentId: number,
  year: string,
  results: PeriodResult[],
  currentOnly: Set<string> | null,
): Promise<Badge | null> {
  const earned: Array<{ code: BadgeCode; periodKey: string }> = [];
  for (const res of results) {
    for (const code of codesFor(res)) earned.push({ code, periodKey: res.periodKey });
  }
  const stored = await db.query<BadgeRow[]>(
    'SELECT * FROM student_badges WHERE student_id = ? AND school_year = ?',
    [studentId, year],
  );
  const want = new Map(earned.map((e) => [`${e.code}|${e.periodKey}`, e]));
  const have = new Map(stored.map((r) => [`${r.badge_code}|${fmtDay(parseDay(r.week_start))}`, r]));
  let newlyEarned: Badge | null = null;
  for (const key of want.keys()) {
    if (!have.has(key)) {
      const e = want.get(key)!;
      const res = await db.execute(
        'INSERT INTO student_badges (student_id, school_year, badge_code, week_start) VALUES (?, ?, ?, ?)',
        [studentId, year, e.code, e.periodKey],
      );
      if (!newlyEarned) {
        newlyEarned = {
          id: res.insertId,
          studentId,
          schoolYear: year,
          badgeCode: e.code,
          periodStart: e.periodKey,
          earnedAt: new Date().toISOString(),
        };
      }
    }
  }
  for (const key of have.keys()) {
    if (!want.has(key)) {
      const row = have.get(key)!;
      if (!currentOnly || currentOnly.has(fmtDay(parseDay(row.week_start)))) {
        await db.execute('DELETE FROM student_badges WHERE id = ?', [row.id]);
      }
    }
  }
  return newlyEarned;
}

/** Evaluates one student's CURRENT windows (week + month + quarter + school
 *  year) and syncs their badge rows. Returns the summary plus `newlyEarned`
 *  when a scan completed a window (the kiosk celebrates that). */
export async function evaluateStudentToday(studentId: number): Promise<StudentBadgeSummary> {
  await ensureBadgeTables();
  const id = Number(studentId);
  const settings = settingsStore.get();
  const year = await currentSchoolYearName();
  const now = new Date();

  const [stud] = await db.query<{ is_active: number }[]>('SELECT is_active FROM students WHERE id = ?', [id]);
  if (!stud || !stud.is_active) return { badges: [], currentWeek: null, newlyEarned: null };

  // Join day: the student's first scan ever — new enrollees aren't penalized
  // for school days before they joined.
  const [join] = await db.query<{ d: string | null }[]>(
    'SELECT MIN(DATE(scanned_at)) d FROM attendance_logs WHERE student_id = ?',
    [id],
  );
  const joinDay = join?.d ? parseDay(join.d) : null;
  const joinKey = joinDay ? fmtDay(joinDay) : null;

  const periods = currentBadgePeriods(year, now);
  const results = await evaluatePeriods(id, periods, settings, joinKey);
  const currentKeys = new Set(periods.map((p) => p.key));
  const newlyEarned = await syncBadges(id, year, results, currentKeys);

  const badges = (
    await db.query<BadgeRow[]>(
      'SELECT * FROM student_badges WHERE student_id = ? AND school_year = ? ORDER BY week_start DESC, badge_code',
      [id, year],
    )
  ).map(toBadge);

  const weekRes = results.find((r) => r.kind === 'week') ?? null;
  const currentWeek: BadgeWeekProgress | null = weekRes
    ? {
        weekStart: weekRes.periodKey,
        weekEnd: fmtDay(addDays(parseDay(weekRes.periodKey), 6)),
        requiredDays: weekRes.requiredDays,
        presentDays: weekRes.presentDays,
        excusedDays: weekRes.excusedDays,
        attendanceMissed: weekRes.attendanceMissed,
        punctualityMissed: weekRes.punctualityMissed,
        attendanceComplete: weekRes.attendanceComplete,
        punctualityComplete: weekRes.punctualityComplete,
      }
    : null;

  return { badges, currentWeek, newlyEarned };
}

/** Full authoritative resync of one student's badges for the current year —
 *  every week/month/quarter from their join day (clamped to the school year)
 *  to today plus the school-year window is re-derived and stored rows are
 *  diffed (self-heals after log corrections / excuse edits). */
export async function recomputeStudent(studentId: number): Promise<void> {
  const id = Number(studentId);
  const year = await currentSchoolYearName();
  const settings = settingsStore.get();
  const [stud] = await db.query<{ is_active: number }[]>('SELECT is_active FROM students WHERE id = ?', [id]);
  if (!stud || !stud.is_active) {
    await db.execute('DELETE FROM student_badges WHERE student_id = ? AND school_year = ?', [id, year]);
    return;
  }
  const [join] = await db.query<{ d: string | null }[]>(
    'SELECT MIN(DATE(scanned_at)) d FROM attendance_logs WHERE student_id = ?',
    [id],
  );
  const joinDay = join?.d ? parseDay(join.d) : null;
  const joinKey = joinDay ? fmtDay(joinDay) : null;
  const periods = recomputeBadgePeriods(year, joinDay, new Date());
  const results = await evaluatePeriods(id, periods, settings, joinKey);
  await syncBadges(id, year, results, null);
}

/** Maintenance pass: resync every active student's badges. */
export async function recomputeAllBadges(): Promise<number> {
  if (!db.isOnline()) return 0;
  await ensureBadgeTables();
  const rows = await db.query<{ id: number }[]>('SELECT id FROM students WHERE is_active = 1');
  let done = 0;
  for (const r of rows) {
    try {
      await recomputeStudent(r.id);
      done++;
    } catch (err) {
      console.error(`[tapin] badge recompute failed for student ${r.id}:`, err);
    }
  }
  return done;
}

// ---- Reads / writes for the admin + leaderboard ----------------------------
export async function listBadges(schoolYear?: string): Promise<Badge[]> {
  await ensureBadgeTables();
  const year = schoolYear ?? (await currentSchoolYearName());
  const rows = await db.query<BadgeRow[]>(
    'SELECT * FROM student_badges WHERE school_year = ? ORDER BY week_start DESC, badge_code',
    [year],
  );
  return rows.map(toBadge);
}

/** Ranking of badge-earning students (highest score first). Sections resolve
 *  through the selected school year's enrollments (falling back to the live
 *  section) so past-year rankings match how that year's classes were grouped. */
export async function badgeLeaderboard(topN = 10, section?: string, schoolYear?: string): Promise<BadgeLeaderboardRow[]> {
  await ensureBadgeTables();
  const year = schoolYear ?? (await currentSchoolYearName());
  const sectionFilter = (section ?? '').trim();
  // Points live in BADGE_INFO (shared/types.ts) — generate the SQL CASE from
  // it so the leaderboard score can never drift from the badge catalog.
  const scoreCase = (Object.keys(BADGE_INFO) as BadgeCode[])
    .map((code) => `WHEN '${code}' THEN ${BADGE_INFO[code].points}`)
    .join(' ');
  return db.query<BadgeLeaderboardRow[]>(
    `SELECT s.id studentId,
            COALESCE(e.grade_section, s.grade_section) gradeSection,
            s.full_name fullName,
            s.student_no studentNo,
            COUNT(b.id) badgeCount,
            COALESCE(SUM(b.badge_code LIKE 'ATT_%'), 0) attendanceBadges,
            COALESCE(SUM(b.badge_code LIKE 'PUNCT_%'), 0) punctualityBadges,
            COALESCE(SUM(CASE b.badge_code ${scoreCase} ELSE 0 END), 0) score
     FROM students s
     LEFT JOIN enrollments e ON e.student_id = s.id AND e.school_year = ?
     LEFT JOIN student_badges b ON b.student_id = s.id AND b.school_year = ?
     WHERE s.is_active = 1
       AND (? = '' OR COALESCE(e.grade_section, s.grade_section) = ?)
     GROUP BY s.id, s.full_name, s.grade_section, s.student_no, e.grade_section
     HAVING badgeCount > 0
     ORDER BY score DESC, badgeCount DESC, s.full_name ASC
     LIMIT ?`,
    [year, year, sectionFilter, sectionFilter, Math.max(1, Number(topN) || 10)],
  );
}

export async function listExcuses(studentId: number): Promise<Excuse[]> {
  await ensureBadgeTables();
  const rows = await db.query<ExcuseRow[]>(
    'SELECT * FROM excuses WHERE student_id = ? ORDER BY excuse_date DESC',
    [Number(studentId)],
  );
  return rows.map(toExcuse);
}

export async function addExcuse(
  studentId: number,
  excuseDate: string,
  category: ExcuseCategory,
  note?: string,
): Promise<Excuse> {
  await ensureBadgeTables();
  const id = Number(studentId);
  const date = fmtDay(parseDay(excuseDate));
  const cat: ExcuseCategory = (['SICK', 'RELIGIOUS', 'SCHOOL_ACTIVITY', 'OTHER'] as ExcuseCategory[]).includes(
    category as ExcuseCategory,
  )
    ? category
    : 'OTHER';
  await db.execute(
    `INSERT INTO excuses (student_id, excuse_date, category, note) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE category = VALUES(category), note = VALUES(note)`,
    [id, date, cat, String(note || '').slice(0, 255)],
  );
  const [row] = await db.query<ExcuseRow[]>(
    'SELECT * FROM excuses WHERE student_id = ? AND excuse_date = ?',
    [id, date],
  );
  return toExcuse(row);
}

/** Removes an excuse and returns the affected student id (for self-heal). */
export async function removeExcuse(excuseId: number): Promise<number | null> {
  await ensureBadgeTables();
  const [row] = await db.query<ExcuseRow[]>('SELECT * FROM excuses WHERE id = ?', [Number(excuseId)]);
  if (row) await db.execute('DELETE FROM excuses WHERE id = ?', [Number(excuseId)]);
  return row ? row.student_id : null;
}

// ---- Service lifecycle (periodic recompute, mirrors absence.ts) ------------
let timer: NodeJS.Timeout | null = null;
let onDbStatus: ((s: { online: boolean }) => void) | null = null;

export function startBadgeService(): void {
  // Boot pass — no-ops harmlessly if the DB isn't ready yet.
  void recomputeAllBadges().catch(() => undefined);
  timer = setInterval(() => {
    void recomputeAllBadges().catch(() => undefined);
  }, RECOMPUTE_INTERVAL_MS);
  // Re-run right after the DB reconnects (e.g. kiosk started offline).
  onDbStatus = (s) => {
    if (s.online) void recomputeAllBadges().catch(() => undefined);
  };
  db.on('status', onDbStatus);
}

export function stopBadgeService(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (onDbStatus) db.removeListener('status', onDbStatus);
  onDbStatus = null;
}
