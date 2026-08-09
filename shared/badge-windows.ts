// Pure calendar math for attendance-badge windows: week (Mon–Sun), calendar
// month, calendar quarter, and the school year (Jun 1 → Mar 31 — the common
// PH academic calendar — derived from the school-year name like "2026 - 2027").
// Shared by the Electron evaluator (electron/services/badges.ts) and the
// browser mock (src/lib/api.ts) so both always agree on window boundaries.
// Keep this file dependency-free.

export type BadgeWindowKind = 'week' | 'month' | 'quarter' | 'year';

/** Minimum non-excused school days a window must contain before a badge is
 *  awarded — holiday-heavy windows don't hand out empty badges. */
export const BADGE_MIN_SCHOOL_DAYS: Record<BadgeWindowKind, number> = {
  week: 3,
  month: 8,
  quarter: 15,
  year: 40,
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in local time. */
export function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parses a YYYY-MM-DD string as a LOCAL date (never UTC-shifted). */
export function parseDay(raw: string | Date): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** First day of the month `n` months after `d` (stable across month lengths). */
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Monday 00:00 (local) of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  return addDays(m, -((m.getDay() + 6) % 7));
}

/** First day of `d`'s calendar month, 00:00 local. */
export function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** First day of `d`'s calendar quarter (Jan/Apr/Jul/Oct), 00:00 local. */
export function quarterStart(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

export interface SchoolYearPeriod {
  /** Inclusive — Jun 1 of the first year. */
  start: Date;
  /** Exclusive — Apr 1 of the following year (covers through Mar 31). */
  end: Date;
}

/** The school-year window for a name like "2026 - 2027": Jun 1 of the first
 *  year through Mar 31 of the second. Falls back to the calendar year when
 *  the name doesn't parse (e.g. a bare "2026"). */
export function schoolYearPeriod(yearName: string, now: Date): SchoolYearPeriod {
  const m = /^(\d{4})\s*[-–—]\s*(\d{4})$/.exec(String(yearName || '').trim());
  if (m) {
    const y1 = Number(m[1]);
    const y2 = Number(m[2]);
    if (y2 === y1 + 1) {
      return { start: new Date(y1, 5, 1), end: new Date(y2, 3, 1) };
    }
  }
  return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear() + 1, 0, 1) };
}

/** One badge evaluation window. `end` is exclusive. */
export interface BadgePeriod {
  kind: BadgeWindowKind;
  /** YYYY-MM-DD of the window's start — the period key persisted in the DB
   *  (student_badges.week_start holds it for every window kind). */
  key: string;
  start: Date;
  end: Date;
}

/** The four windows that contain `now` (week, month, quarter, school year). */
export function currentBadgePeriods(yearName: string, now: Date): BadgePeriod[] {
  const week = mondayOf(now);
  const month = monthStart(now);
  const quarter = quarterStart(now);
  const year = schoolYearPeriod(yearName, now);
  return [
    { kind: 'week', key: fmtDay(week), start: week, end: addDays(week, 7) },
    { kind: 'month', key: fmtDay(month), start: month, end: addMonths(month, 1) },
    { kind: 'quarter', key: fmtDay(quarter), start: quarter, end: addMonths(quarter, 3) },
    { kind: 'year', key: fmtDay(year.start), start: year.start, end: year.end },
  ];
}

/** Every window a full recompute must re-derive: all weeks, months and
 *  calendar quarters from the student's join day (clamped to the current
 *  school year's start) up to now, plus the school-year window itself.
 *  Windows that begin before the school year are skipped — their badges
 *  belong to the previous school year's (frozen) rows. */
export function recomputeBadgePeriods(yearName: string, joinDay: Date | null, now: Date): BadgePeriod[] {
  const year = schoolYearPeriod(yearName, now);
  const from = joinDay && joinDay.getTime() > year.start.getTime() ? joinDay : year.start;
  const periods: BadgePeriod[] = [];
  for (let w = mondayOf(from); w.getTime() < now.getTime(); w = addDays(w, 7)) {
    if (w.getTime() < year.start.getTime()) continue;
    periods.push({ kind: 'week', key: fmtDay(w), start: w, end: addDays(w, 7) });
  }
  for (let m = monthStart(from); m.getTime() < now.getTime(); m = addMonths(m, 1)) {
    if (m.getTime() < year.start.getTime()) continue;
    periods.push({ kind: 'month', key: fmtDay(m), start: m, end: addMonths(m, 1) });
  }
  for (let q = quarterStart(from); q.getTime() < now.getTime(); q = addMonths(q, 3)) {
    if (q.getTime() < year.start.getTime()) continue;
    periods.push({ kind: 'quarter', key: fmtDay(q), start: q, end: addMonths(q, 3) });
  }
  if (year.start.getTime() <= now.getTime()) {
    periods.push({ kind: 'year', key: fmtDay(year.start), start: year.start, end: year.end });
  }
  return periods;
}
