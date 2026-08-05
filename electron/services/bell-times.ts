// Bell-time / attendance-flag helpers (Phase 2, 4.1).
//
// Single source of truth for how the configurable school bell times turn a
// scan into a quality flag:
//   - IN  scan at/after bell_time_in + grace minutes  -> LATE
//   - OUT scan before bell_time_out                   -> EARLY
// An empty bell_time string disables that flag. Flags are computed on the fly
// from the scan timestamp (no attendance_logs column), so changing bell times
// retroactively re-labels history — which is the desired behavior for reports.
import type { AttendanceFlag, EntryType, Settings } from '../../shared/types';

/** Parses an 'HH:MM' (or 'HH:MM:SS') string to minutes-of-day; NaN if invalid. */
export function parseTime(raw: string): number {
  const parts = String(raw || '').split(':').map((p) => Number(p));
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return NaN;
  return parts[0] * 60 + parts[1];
}

/** Formats minutes-of-day as an 'HH:MM:SS' string usable in TIME() comparisons. */
export function toHms(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:00`;
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * The late / early cutoffs as 'HH:MM:SS' strings (or '' when disabled).
 * These match the semantics of computeScanFlag() and can be passed directly to
 * SQL TIME(scanned_at) comparisons so list/overview queries label rows the
 * exact same way the live scan path does.
 */
export function flagCutoffs(settings: Settings): { late: string; early: string } {
  const inMin = settings.bell_time_in ? parseTime(settings.bell_time_in) : NaN;
  const outMin = settings.bell_time_out ? parseTime(settings.bell_time_out) : NaN;
  const grace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  return {
    late: Number.isNaN(inMin) ? '' : toHms(inMin + grace),
    early: Number.isNaN(outMin) ? '' : toHms(outMin),
  };
}

/** Computes the flag for a scan at the given local time. */
export function computeScanFlag(entryType: EntryType, d: Date, settings: Settings): AttendanceFlag {
  const { late, early } = flagCutoffs(settings);
  const m = minutesOfDay(d);
  if (entryType === 'IN' && late && m > parseTime(late)) return 'LATE';
  if (entryType === 'OUT' && early && m < parseTime(early)) return 'EARLY';
  return '';
}

/** SQL CASE expression that labels a row's flag from its scanned_at value. */
export function flagSelectSql(): string {
  return `CASE
           WHEN a.entry_type = 'IN'  AND ? <> '' AND TIME(a.scanned_at) > ? THEN 'LATE'
           WHEN a.entry_type = 'OUT' AND ? <> '' AND TIME(a.scanned_at) < ? THEN 'EARLY'
           ELSE '' END AS flag`;
}

/** Parameters for flagSelectSql(), in statement order: [late, late, early, early]. */
export function flagSelectParams(settings: Settings): unknown[] {
  const { late, early } = flagCutoffs(settings);
  return [late, late, early, early];
}
