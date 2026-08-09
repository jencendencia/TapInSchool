// Automatic daily adviser reports (scheduled email).
//
// Every day at adviser_report_time (e.g. 20:00), each section adviser is
// emailed their section's per-student attendance report for the CURRENT day
// (midnight → send time). The schedule is a plain wall-clock check, so the
// kiosk does not need to be running at the exact minute — if it boots after
// the send time and today's report has not been sent yet, it sends
// immediately. `adviser_report_last_run` (date) guards against duplicate
// sends, and days with no gate activity (weekend / holiday / kiosk off) are
// skipped so advisers don't get empty zero reports.
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { sendAdviserReportEmails } from './report-email';
import { parseTime } from './bell-times';
import type { Settings } from '../../shared/types';

const CHECK_INTERVAL_MS = 60 * 1000;

export interface AdviserReportRunResult {
  ran: boolean;
  sent: number;
  skipped: number;
  failed: number;
}

function fmtDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
 *  concurrent second entry would email the same day's reports twice. */
let inFlight = false;

/** Sends today's per-student reports to every adviser with an email. */
export async function runAdviserReport(): Promise<AdviserReportRunResult> {
  const settings = settingsStore.get();
  const none: AdviserReportRunResult = { ran: false, sent: 0, skipped: 0, failed: 0 };
  if (!settings.adviser_report_enabled || !db.isOnline()) return none;
  if (!isPastSendTime(settings)) return none;

  const today = fmtDay(new Date());
  // Once per day — the guard is recorded even on partial failures so a failed
  // adviser doesn't make the scheduler re-fire every minute (the admin can
  // resend manually from Reports).
  if (settings.adviser_report_last_run === today) return none;
  if (inFlight) return none;
  inFlight = true;
  try {
    // Skip days the gate was never used (weekend / holiday / kiosk off) —
    // otherwise advisers would get a zero-scan report with nothing in it.
    // Recording the date here also stops the per-minute polling until tomorrow.
    const [gate] = await db.query<{ c: number }[]>('SELECT COUNT(*) c FROM attendance_logs WHERE DATE(scanned_at) = ?', [today]);
    if (!gate || gate.c === 0) {
      await settingsStore.update({ adviser_report_last_run: today });
      return none;
    }

    // Same-day report: midnight → now (the send time). Per-section reports,
    // phones unmasked so advisers can follow up with parents. Section
    // groupings reflect the current school year's enrollments.
    const res = await sendAdviserReportEmails(today, today, settings);
    await settingsStore.update({ adviser_report_last_run: today });
    console.log(
      `[tapin] adviser report: ${res.sent} sent, ${res.skipped} skipped, ${res.failed} failed — ${res.message}`,
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
