// Bell-time / attendance-flag helpers — copied from TapIn School so LATE /
// EARLY flags computed here can never disagree with the kiosk's labels.
//
//   - IN  scan at/after bell_time_in + grace minutes  -> LATE
//   - OUT scan before bell_time_out                   -> EARLY
// An empty bell_time string disables that flag. Flags are computed on the fly
// from the scan timestamp, so changing bell times retroactively re-labels
// history (the desired behavior for reports).
import type { AttendanceFlag, EntryType } from '../shared/types';

/** The bell-time subset the teacher app reads from the shared settings table. */
export interface BellSettings {
  am_time_in: string;
  am_time_out: string;
  pm_time_in: string;
  pm_time_out: string;
  bell_grace_minutes: number;
}

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

/** The AM/PM boundary: any scan at or after am_time_out is PM, before it is AM. */
export function midpointMinutes(settings: BellSettings): number {
  const amOut = settings.am_time_out ? parseTime(settings.am_time_out) : NaN;
  if (!Number.isNaN(amOut)) return amOut;
  // Fallback: midpoint of am_time_in and pm_time_out
  const amIn = settings.am_time_in ? parseTime(settings.am_time_in) : NaN;
  const pmOut = settings.pm_time_out ? parseTime(settings.pm_time_out) : NaN;
  if (!Number.isNaN(amIn) && !Number.isNaN(pmOut)) return Math.round((amIn + pmOut) / 2);
  return 720; // noon default
}

/** The late / early cutoffs as 'HH:MM:SS' strings (or '' when disabled). */
export function flagCutoffs(settings: BellSettings): { late: string; early: string } {
  // Use AM time_in for late cutoff (overall school start + grace)
  const inMin = settings.am_time_in ? parseTime(settings.am_time_in) : NaN;
  // Use PM time_out for early cutoff (overall school end)
  const outMin = settings.pm_time_out ? parseTime(settings.pm_time_out) : NaN;
  const grace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  return {
    late: Number.isNaN(inMin) ? '' : toHms(inMin + grace),
    early: Number.isNaN(outMin) ? '' : toHms(outMin),
  };
}

/** Computes the flag for a scan at the given local time using AM/PM session bell times. */
export function computeScanFlag(entryType: EntryType, d: Date, settings: BellSettings): AttendanceFlag {
  const grace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  const m = d.getHours() * 60 + d.getMinutes();
  const mid = midpointMinutes(settings);
  const isAm = m < mid;
  if (isAm) {
    // AM session: IN after am_time_in + grace = LATE; OUT before am_time_out = EARLY
    const amInMin = settings.am_time_in ? parseTime(settings.am_time_in) : NaN;
    const amOutMin = settings.am_time_out ? parseTime(settings.am_time_out) : NaN;
    if (entryType === 'IN' && !Number.isNaN(amInMin) && m > amInMin + grace) return 'LATE';
    if (entryType === 'OUT' && !Number.isNaN(amOutMin) && m < amOutMin) return 'EARLY';
  } else {
    // PM session: IN after pm_time_in + grace = LATE; OUT before pm_time_out = EARLY
    const pmInMin = settings.pm_time_in ? parseTime(settings.pm_time_in) : NaN;
    const pmOutMin = settings.pm_time_out ? parseTime(settings.pm_time_out) : NaN;
    if (entryType === 'IN' && !Number.isNaN(pmInMin) && m > pmInMin + grace) return 'LATE';
    if (entryType === 'OUT' && !Number.isNaN(pmOutMin) && m < pmOutMin) return 'EARLY';
  }
  return '';
}

/** Minutes past the late cutoff for a LATE IN scan (0 when on time). */
export function minutesLate(d: Date, settings: BellSettings): number {
  const grace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  const m = d.getHours() * 60 + d.getMinutes();
  const mid = midpointMinutes(settings);
  const isAm = m < mid;
  if (isAm) {
    const amInMin = settings.am_time_in ? parseTime(settings.am_time_in) : NaN;
    if (Number.isNaN(amInMin)) return 0;
    return Math.max(0, m - (amInMin + grace));
  }
  const pmInMin = settings.pm_time_in ? parseTime(settings.pm_time_in) : NaN;
  if (Number.isNaN(pmInMin)) return 0;
  return Math.max(0, m - (pmInMin + grace));
}
