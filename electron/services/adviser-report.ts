// Automatic adviser reports (scheduled email).
//
// At adviser_report_time (e.g. 20:00), each section adviser is emailed their
// section's per-student attendance report covering the CURRENT period, chosen
// by the adviser_report_frequency setting:
//   daily   → today (midnight → send time)
//   weekly  → this ISO week (Monday → send time)
//   monthly → this calendar month (1st → send time)
// The schedule is a plain wall-clock check, so the kiosk does not need to be
// running at the exact minute — if it boots after the send time and no report
// has been sent for the current period yet, it sends immediately.
// `adviser_report_last_run` (date) guards against duplicate sends: the guard
// is compared per period, so a daily report can't go out twice today, a
// weekly one twice this week, etc. Periods with no gate activity (weekend /
// holiday / kiosk off) are skipped so advisers don't get empty zero reports.
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { sendAdviserReportEmails } from './report-email';
import { parseTime } from './bell-times';
import type { AdviserReportFrequency, Settings } from '../../shared/types';

const CHECK_INTERVAL_MS = 60 * 1000;

export interface AdviserReportRunResult {
  ran: boolean;
  sent: number;
  skipped: number;
  failed: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday of the week containing `d` (local time), as 'YYYY-MM-DD'. */
function mondayOf(d: Date): string {
  const monday = new Date(d);
  // getDay(): 0 = Sunday … 6 = Saturday; mapping Sunday to 7 makes the
  // "days back to Monday" arithmetic work for every day of the week.
  monday.setDate(d.getDate() - ((d.getDay() || 7) - 1));
  return fmtDay(monday);
}

/** First day of the current reporting period ('YYYY-MM-DD'), inclusive. */
function periodStart(frequency: AdviserReportFrequency, today: Date): string {
  if (frequency === 'weekly') return mondayOf(today);
  if (frequency === 'monthly') return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
  return fmtDay(today);
}

/**
 * Period key of a last-run date under the current frequency: two dates share a
 * key exactly when they fall in the same report period (day / week / month),
 * which is what prevents duplicate sends. Empty input → '' (never matches).
 */
function periodKey(frequency: AdviserReportFrequency, lastRun: string): string {
  if (!lastRun) return '';
  if (frequency === 'daily') return lastRun;
  const d = new Date(`${lastRun}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  if (frequency === 'weekly') return mondayOf(d);
  return lastRun.slice(0, 7);
}

/** True once the local clock has reached the configured send time. */
function isPastSendTime(settings: Settings): boolean {
  const target = settings.adviser_report_time ? parseTime(settings.adviser_report_time) : NaN;
  if (Number.isNaN(target)) return false;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= target;
}

/** Serializes runs: the boot attempt, the DB-status listener and the interval
 *  can all fire close together, and the email send is NOT idempotent — a
 *  concurrent second entry would email the same period's reports twice. */
let inFlight = false;

/** Sends the current period's per-student reports to every adviser with an email. */
export async function runAdviserReport(): Promise<AdviserReportRunResult> {
  const settings = settingsStore.get();
  const none: AdviserReportRunResult = { ran: false, sent: 0, skipped: 0, failed: 0 };
  if (!settings.adviser_report_enabled || !db.isOnline()) return none;
  if (!isPastSendTime(settings)) return none;

  const frequency: AdviserReportFrequency = settings.adviser_report_frequency ?? 'daily';
  const today = new Date();
  const todayStr = fmtDay(today);
  // Once per period — the guard is recorded even on partial failures so a
  // failed adviser doesn't make the scheduler re-fire every minute (the admin
  // can resend manually from Reports).
  if (periodKey(frequency, settings.adviser_report_last_run) === periodKey(frequency, todayStr)) return none;
  if (inFlight) return none;
  inFlight = true;
  try {
    // Skip periods the gate was never used (weekend / holiday / kiosk off) —
    // otherwise advisers would get a zero-scan report with nothing in it.
    // Recording the date here also stops the per-minute polling until the
    // next period.
    const start = periodStart(frequency, today);
    const [gate] = await db.query<{ c: number }[]>(
      `SELECT COUNT(*) c FROM attendance_logs
       WHERE scanned_at >= ? AND scanned_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [start, todayStr],
    );
    if (!gate || gate.c === 0) {
      await settingsStore.update({ adviser_report_last_run: todayStr });
      return none;
    }

    // Report covers the current period (day / week / month) up to the send
    // time. Per-section reports, phones unmasked so advisers can follow up
    // with parents. Section groupings reflect the current school year's
    // enrollments.
    const res = await sendAdviserReportEmails(start, todayStr, settings);
    await settingsStore.update({ adviser_report_last_run: todayStr });
    console.log(
      `[tapin] adviser report (${frequency}): ${res.sent} sent, ${res.skipped} skipped, ${res.failed} failed — ${res.message}`,
    );
    return { ran: true, sent: res.sent, skipped: res.skipped, failed: res.failed };
  } catch (err) {
    console.error('[tapin] adviser report failed:', err);
    return none;
  } finally {
    inFlight = false;
  }
}

let timer: NodeJS.Timeout | null = null;
let onDbStatus: ((s: { online: boolean }) => void) | null = null;

export function startAdviserReportService(): void {
  // Boot attempt — no-ops harmlessly if disabled / offline / before the time.
  void runAdviserReport().catch(() => undefined);
  timer = setInterval(() => {
    void runAdviserReport().catch(() => undefined);
  }, CHECK_INTERVAL_MS);
  // Re-attempt right after the DB reconnects (e.g. kiosk started offline).
  onDbStatus = (s) => {
    if (s.online) void runAdviserReport().catch(() => undefined);
  };
  db.on('status', onDbStatus);
}

export function stopAdviserReportService(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (onDbStatus) db.removeListener('status', onDbStatus);
  onDbStatus = null;
}
