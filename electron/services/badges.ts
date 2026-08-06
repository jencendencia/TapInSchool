// Weekly attendance badges (FEATURE_IMPROVEMENT_PLAN 7.8 — BADGE_RANKING_PLAN.md rev. 2).
//
// Positive / lenient model: a student earns an "Attendance Champion" badge
// (ATT_W) for a calendar week (Mon–Sun) in which they were present every
// NON-EXCUSED school day, and a "Punctuality Champion" badge (PUNCT_W) when
// they were also never LATE/EARLY on a non-excused day. Excused days (sick,
// religious observance, school-recognized activity) are neutral — they never
// break a badge. A week needs ≥ MIN_WEEK_SCHOOL_DAYS non-excused school days
// to count at all. Stored rows are authoritative-recomputed from the source
// data, so manual log corrections and excuse edits self-heal badges.
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { computeScanFlag } from './bell-times';
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

/** A week only counts when it has at least this many non-excused school days. */
export const MIN_WEEK_SCHOOL_DAYS = 3;
const RECOMPUTE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');
export function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDay(raw: string | Date): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}
function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}
/** Monday 00:00 (local) of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  return addDays(m, -((m.getDay() + 6) % 7));
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

const toBadge = (r: BadgeRow): Badge => ({
  id: r.id,
  studentId: r.student_id,
  schoolYear: r.school_year,
  badgeCode: r.badge_code,
  weekStart: fmtDay(parseDay(r.week_start)),
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

/** Evaluates one student's CURRENT week and syncs its badge rows. Returns the
 *  summary plus `newlyEarned` when this call inserted a fresh badge (the kiosk
 *  celebrates that). Stored rows for the week are deleted when no longer
 *  earned, so badges always match the source data (authoritative recompute). */
export async function evaluateStudentToday(studentId: number): Promise<StudentBadgeSummary> {
  await ensureBadgeTables();
  const id = Number(studentId);
  const settings = settingsStore.get();
  const year = await currentSchoolYearName();
  const now = new Date();
  const weekStart = mondayOf(now);
  const weekEnd = addDays(weekStart, 7);

  const [stud] = await db.query<{ is_active: number }[]>('SELECT is_active FROM students WHERE id = ?', [id]);
  if (!stud || !stud.is_active) return { badges: [], currentWeek: null, newlyEarned: null };

  // Join day: the student's first scan ever — new enrollees aren't penalized
  // for school days before they joined.
  const [join] = await db.query<{ d: string | null }[]>(
    'SELECT MIN(DATE(scanned_at)) d FROM attendance_logs WHERE student_id = ?',
    [id],
  );
  const joinDay = join?.d ? parseDay(join.d) : null;

  const week = await evaluateWeek(id, weekStart, weekEnd, settings, joinDay);
  const weekKey = fmtDay(weekStart);
  const wanted: BadgeCode[] = [];
  if (week.attendanceComplete) wanted.push('ATT_W');
  if (week.punctualityComplete) wanted.push('PUNCT_W');

  const stored = await db.query<BadgeRow[]>(
    'SELECT * FROM student_badges WHERE student_id = ? AND school_year = ? AND week_start = ?',
    [id, year, weekKey],
  );
  const have = new Set(stored.map((r) => r.badge_code));
  let newlyEarned: Badge | null = null;
  for (const code of wanted) {
    if (!have.has(code)) {
      const res = await db.execute(
        'INSERT INTO student_badges (student_id, school_year, badge_code, week_start) VALUES (?, ?, ?, ?)',
        [id, year, code, weekKey],
      );
      newlyEarned = {
        id: res.insertId,
        studentId: id,
        schoolYear: year,
        badgeCode: code,
        weekStart: weekKey,
        earnedAt: new Date().toISOString(),
      };
    }
  }
  for (const code of have) {
    if (!wanted.includes(code)) {
      await db.execute(
        'DELETE FROM student_badges WHERE student_id = ? AND school_year = ? AND badge_code = ? AND week_start = ?',
        [id, year, code, weekKey],
      );
    }
  }

  const badges = (
    await db.query<BadgeRow[]>(
      'SELECT * FROM student_badges WHERE student_id = ? AND school_year = ? ORDER BY week_start DESC, badge_code',
      [id, year],
    )
  ).map(toBadge);
  return { badges, currentWeek: week, newlyEarned };
}

/** Weekly progress for one student: required vs present days + flag check. */
async function evaluateWeek(
  studentId: number,
  weekStart: Date,
  weekEnd: Date,
  settings: Settings,
  joinDay: Date | null,
): Promise<BadgeWeekProgress> {
  const startKey = fmtDay(weekStart);
  const endKey = fmtDay(weekEnd);
  // School days (gate-used heuristic, shared with absence 4.2 + REPORTS_PLAN).
  const schoolRows = await db.query<{ d: string }[]>(
    'SELECT DISTINCT DATE(scanned_at) d FROM attendance_logs WHERE scanned_at >= ? AND scanned_at < ?',
    [startKey, endKey],
  );
  const schoolDays = schoolRows.map((r) => fmtDay(parseDay(r.d)));
  const excRows = await db.query<{ excuse_date: string }[]>(
    'SELECT excuse_date FROM excuses WHERE student_id = ? AND excuse_date >= ? AND excuse_date < ?',
    [studentId, startKey, endKey],
  );
  const excused = new Set(excRows.map((r) => fmtDay(parseDay(r.excuse_date))));
  const scans = await db.query<ScanRow[]>(
    `SELECT entry_type, scanned_at FROM attendance_logs
     WHERE student_id = ? AND scanned_at >= ? AND scanned_at < ?`,
    [studentId, startKey, endKey],
  );

  const joinKey = joinDay ? fmtDay(joinDay) : null;
  const required = schoolDays.filter((d) => !excused.has(d) && (!joinKey || d >= joinKey));
  const present = new Set<string>();
  let punctualityMissed = false;
  for (const sc of scans) {
    const d = fmtDay(parseDay(toDate(sc.scanned_at)));
    if (!joinKey || d >= joinKey) present.add(d);
    if (!excused.has(d) && computeScanFlag(sc.entry_type, toDate(sc.scanned_at), settings)) {
      punctualityMissed = true;
    }
  }
  const requiredDays = required.length;
  const presentDays = present.size;
  const active = requiredDays >= MIN_WEEK_SCHOOL_DAYS;
  const attendanceComplete = active && presentDays >= requiredDays;
  return {
    weekStart: startKey,
    weekEnd: fmtDay(addDays(weekEnd, -1)),
    requiredDays,
    presentDays,
    excusedDays: schoolDays.filter((d) => excused.has(d)).length,
    attendanceMissed: active && !attendanceComplete,
    punctualityMissed,
    attendanceComplete,
    punctualityComplete: attendanceComplete && !punctualityMissed,
  };
}

/** Full authoritative resync of one student's badges for the current year —
 *  every week from their join day to today is re-derived and stored rows are
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
  const start = mondayOf(joinDay ?? new Date());
  const end = mondayOf(new Date());
  const endExclusive = addDays(end, 7);

  const [schoolRows, scanRows, excRows] = await Promise.all([
    db.query<{ d: string }[]>(
      'SELECT DISTINCT DATE(scanned_at) d FROM attendance_logs WHERE scanned_at >= ? AND scanned_at < ?',
      [fmtDay(start), fmtDay(endExclusive)],
    ),
    db.query<ScanRow[]>(
      `SELECT entry_type, scanned_at FROM attendance_logs
       WHERE student_id = ? AND scanned_at >= ? AND scanned_at < ?`,
      [id, fmtDay(start), fmtDay(endExclusive)],
    ),
    db.query<{ excuse_date: string }[]>(
      'SELECT excuse_date FROM excuses WHERE student_id = ? AND excuse_date >= ? AND excuse_date < ?',
      [id, fmtDay(start), fmtDay(endExclusive)],
    ),
  ]);
  const schoolSet = new Set(schoolRows.map((r) => fmtDay(parseDay(r.d))));
  const excSet = new Set(excRows.map((r) => fmtDay(parseDay(r.excuse_date))));
  const joinKey = joinDay ? fmtDay(joinDay) : '';

  const presentByWeek = new Map<string, Set<string>>();
  const punctMissedByWeek = new Set<string>();
  for (const sc of scanRows) {
    const d = toDate(sc.scanned_at);
    const wk = fmtDay(mondayOf(d));
    const day = fmtDay(d);
    if (!presentByWeek.has(wk)) presentByWeek.set(wk, new Set());
    presentByWeek.get(wk)!.add(day);
    if (!excSet.has(day) && computeScanFlag(sc.entry_type, d, settings)) punctMissedByWeek.add(wk);
  }

  const earned: Array<{ code: BadgeCode; weekStart: string }> = [];
  for (let w = start; w.getTime() <= end.getTime(); w = addDays(w, 7)) {
    const wk = fmtDay(w);
    const wkEnd = fmtDay(addDays(w, 7));
    const required = [...schoolSet].filter(
      (d) => d >= wk && d < wkEnd && !excSet.has(d) && (!joinKey || d >= joinKey),
    ).length;
    const present = presentByWeek.get(wk)?.size ?? 0;
    const active = required >= MIN_WEEK_SCHOOL_DAYS;
    const attOk = active && present >= required;
    if (attOk) earned.push({ code: 'ATT_W', weekStart: wk });
    if (attOk && !punctMissedByWeek.has(wk)) earned.push({ code: 'PUNCT_W', weekStart: wk });
  }

  const stored = await db.query<BadgeRow[]>(
    'SELECT * FROM student_badges WHERE student_id = ? AND school_year = ?',
    [id, year],
  );
  const want = new Map(earned.map((e) => [`${e.code}|${e.weekStart}`, e]));
  const have = new Map(stored.map((r) => [`${r.badge_code}|${fmtDay(parseDay(r.week_start))}`, r]));
  for (const key of want.keys()) {
    if (!have.has(key)) {
      await db.execute(
        'INSERT INTO student_badges (student_id, school_year, badge_code, week_start) VALUES (?, ?, ?, ?)',
        [id, year, want.get(key)!.code, want.get(key)!.weekStart],
      );
    }
  }
  for (const key of have.keys()) {
    if (!want.has(key)) await db.execute('DELETE FROM student_badges WHERE id = ?', [have.get(key)!.id]);
  }
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

export async function badgeLeaderboard(topN = 10): Promise<BadgeLeaderboardRow[]> {
  await ensureBadgeTables();
  const year = await currentSchoolYearName();
  return db.query<BadgeLeaderboardRow[]>(
    `SELECT s.id studentId, s.full_name fullName, s.grade_section gradeSection, s.student_no studentNo,
            COUNT(b.id) badgeCount,
            COALESCE(SUM(b.badge_code = 'ATT_W'), 0) attendanceWeeks,
            COALESCE(SUM(b.badge_code = 'PUNCT_W'), 0) punctualityWeeks
     FROM students s
     LEFT JOIN student_badges b ON b.student_id = s.id AND b.school_year = ?
     WHERE s.is_active = 1
     GROUP BY s.id, s.full_name, s.grade_section, s.student_no
     HAVING badgeCount > 0
     ORDER BY badgeCount DESC, s.full_name ASC
     LIMIT ?`,
    [year, Math.max(1, Number(topN) || 10)],
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
