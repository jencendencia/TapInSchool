// Bell-time / attendance-flag helpers (Phase 2, 4.1).
//
// Single source of truth for how the configurable school bell times turn a
// scan into a quality flag:
//   - AM IN  scan at/after am_time_in + grace minutes  -> LATE
//   - AM OUT scan before am_time_out                   -> EARLY
//   - PM IN  scan at/after pm_time_in + grace minutes  -> LATE
//   - PM OUT scan before pm_time_out                   -> EARLY
// Flags are computed on the fly from the scan timestamp, so changing bell times
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

/** The AM/PM boundary: any scan at or after am_time_out is PM, before it is AM. */
export function midpointMinutes(settings: Settings): number {
  const amOut = settings.am_time_out ? parseTime(settings.am_time_out) : NaN;
  if (!Number.isNaN(amOut)) return amOut;
  // Fallback: midpoint of am_time_in and pm_time_out
  const amIn = settings.am_time_in ? parseTime(settings.am_time_in) : NaN;
  const pmOut = settings.pm_time_out ? parseTime(settings.pm_time_out) : NaN;
  if (!Number.isNaN(amIn) && !Number.isNaN(pmOut)) return Math.round((amIn + pmOut) / 2);
  return 720;
}

/**
 * The late / early cutoffs as 'HH:MM:SS' strings (or '' when disabled).
 * Uses am_time_in + grace for late, pm_time_out for early.
 */
export function flagCutoffs(settings: Settings): { late: string; early: string } {
  const inMin = settings.am_time_in ? parseTime(settings.am_time_in) : NaN;
  const outMin = settings.pm_time_out ? parseTime(settings.pm_time_out) : NaN;
  const grace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  return {
    late: Number.isNaN(inMin) ? '' : toHms(inMin + grace),
    early: Number.isNaN(outMin) ? '' : toHms(outMin),
  };
}

/** Computes the flag for a scan at the given local time using AM/PM session bell times. */
export function computeScanFlag(entryType: EntryType, d: Date, settings: Settings): AttendanceFlag {
  const grace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  const m = minutesOfDay(d);
  const mid = midpointMinutes(settings);
  const isAm = m < mid;
  if (isAm) {
    const amInMin = settings.am_time_in ? parseTime(settings.am_time_in) : NaN;
    const amOutMin = settings.am_time_out ? parseTime(settings.am_time_out) : NaN;
    if (entryType === 'IN' && !Number.isNaN(amInMin) && m > amInMin + grace) return 'LATE';
    if (entryType === 'OUT' && !Number.isNaN(amOutMin) && m < amOutMin) return 'EARLY';
  } else {
    const pmInMin = settings.pm_time_in ? parseTime(settings.pm_time_in) : NaN;
    const pmOutMin = settings.pm_time_out ? parseTime(settings.pm_time_out) : NaN;
    if (entryType === 'IN' && !Number.isNaN(pmInMin) && m > pmInMin + grace) return 'LATE';
    if (entryType === 'OUT' && !Number.isNaN(pmOutMin) && m < pmOutMin) return 'EARLY';
  }
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
