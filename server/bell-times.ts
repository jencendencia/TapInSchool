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
  bell_time_in: string;
  bell_time_out: string;
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

/** The late / early cutoffs as 'HH:MM:SS' strings (or '' when disabled). */
export function flagCutoffs(settings: BellSettings): { late: string; early: string } {
  const inMin = settings.bell_time_in ? parseTime(settings.bell_time_in) : NaN;
  const outMin = settings.bell_time_out ? parseTime(settings.bell_time_out) : NaN;
  const grace = Math.max(0, Number(settings.bell_grace_minutes) || 0);
  return {
    late: Number.isNaN(inMin) ? '' : toHms(inMin + grace),
    early: Number.isNaN(outMin) ? '' : toHms(outMin),
  };
}

/** Computes the flag for a scan at the given local time. */
export function computeScanFlag(entryType: EntryType, d: Date, settings: BellSettings): AttendanceFlag {
  const { late, early } = flagCutoffs(settings);
  const m = d.getHours() * 60 + d.getMinutes();
  if (entryType === 'IN' && late && m > parseTime(late)) return 'LATE';
  if (entryType === 'OUT' && early && m < parseTime(early)) return 'EARLY';
  return '';
}

/** Minutes past the late cutoff for a LATE IN scan (0 when on time). */
export function minutesLate(d: Date, settings: BellSettings): number {
  const { late } = flagCutoffs(settings);
  if (!late) return 0;
  const m = d.getHours() * 60 + d.getMinutes();
  const cutoff = parseTime(late);
  return Math.max(0, m - cutoff);
}
