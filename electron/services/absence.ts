// Automated absence detection (Phase 2, 4.2).
//
// After dismissal (bell_time_out + 60 min buffer), active students with no
// scan that day are recorded as ABSENT and students whose first IN was after
// the late cutoff as LATE, in absence_logs. Optionally notifies parents by
// SMS (absence_sms setting) using the configured template with {{action}} =
// "was marked absent today". The "gate was used that day" heuristic skips
// weekends / holidays / days the kiosk never ran, so nobody is falsely
// flagged. Runs at boot and every 15 minutes; missed days (up to 3) are
// backfilled the next time the service runs so a kiosk that was off over the
// weekend still catches Monday/Friday absences.
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { withJobLock } from './job-lock';
import { withRetry } from './db-retry';
import { flagCutoffs, parseTime } from './bell-times';
import { buildSmsMessage, resolveTemplate } from '../sms/message-builder';
import type { Settings } from '../../shared/types';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const DETECT_BUFFER_MIN = 60; // minutes after bell_time_out before detection runs
const BACKFILL_CAP = 3;

export interface AbsenceRunResult {
  ran: boolean;
  absent: number;
  late: number;
  sms: number;
}

function fmtDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDay(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** True once the dismissal buffer has passed (local clock). No dismissal
 *  time configured → treat detection as always eligible (absence_detect is
 *  the master switch, and the gate-used heuristic still guards holidays). */
function isPastCutoff(settings: Settings): boolean {
  const outMin = settings.bell_time_out ? parseTime(settings.bell_time_out) : NaN;
  if (Number.isNaN(outMin)) return true;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= outMin + DETECT_BUFFER_MIN;
}

/** True once the configured absence_sms_time has been reached (local clock).
 *  Used to defer SMS enqueueing until the admin-specified time (e.g. 18:00)
 *  while absence DETECTION can still run after the dismissal buffer. */
function isPastSmsTime(settings: Settings): boolean {
  const smsTime = settings.absence_sms_time ? parseTime(settings.absence_sms_time) : NaN;
  if (Number.isNaN(smsTime)) return true; // no time set → send immediately
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= smsTime;
}

/** Flags every active student for one day and enqueues absence SMS. */
async function runForDay(day: Date, settings: Settings): Promise<{ absent: number; late: number; sms: number }> {
  const dayStr = fmtDay(day);
  const out = { absent: 0, late: 0, sms: 0 };

  // Skip days the gate was never used (weekend / holiday / kiosk was off) —
  // otherwise every student would be falsely marked absent.
  const [gate] = await db.query<{ c: number }[]>(
    'SELECT COUNT(*) c FROM attendance_logs WHERE DATE(scanned_at) = ?',
    [dayStr],
  );
  if (!gate || gate.c === 0) return out;

  const { late } = flagCutoffs(settings);
  const absent = await db.query<
    { id: number; full_name: string; grade_section: string; parent_phone: string }[]
  >(
    `SELECT s.id, s.full_name, s.grade_section, s.parent_phone
     FROM students s
     WHERE s.is_active = 1 AND NOT EXISTS (
       SELECT 1 FROM attendance_logs a WHERE a.student_id = s.id AND DATE(a.scanned_at) = ?)`,
    [dayStr],
  );
  const lateList = late
    ? await db.query<{ id: number; full_name: string; grade_section: string; parent_phone: string }[]>(
        `SELECT s.id, s.full_name, s.grade_section, s.parent_phone
         FROM students s
         JOIN (
           SELECT student_id, MIN(scanned_at) first_in FROM attendance_logs
           WHERE entry_type = 'IN' AND DATE(scanned_at) = ? GROUP BY student_id
         ) f ON f.student_id = s.id
         WHERE s.is_active = 1 AND TIME(f.first_in) > ?`,
        [dayStr, late],
      )
    : [];

  // Existing rows for the day, so re-runs never double-flag or double-SMS.
  const existing = await db.query<{ student_id: number; status: string; sms_sent: number }[]>(
    'SELECT student_id, status, sms_sent FROM absence_logs WHERE day = ?',
    [dayStr],
  );
  const existingMap = new Map(existing.map((e) => [String(e.student_id), e]));

  const template = resolveTemplate(settings);
  const smsEnabled = settings.absence_sms;
  // Parents are only notified for the current day — a backfilled day (e.g.
  // the kiosk was off yesterday) is recorded silently so no one gets a
  // misleading "absent today" message for a past date.  SMS is also gated
  // on the admin-configured absence_sms_time so notifications go out at
  // the expected hour (e.g. 18:00) rather than immediately after dismissal.
  const smsToday = smsEnabled && dayStr === fmtDay(new Date()) && isPastSmsTime(settings);

  const upsert = async (
    student: { id: number; full_name: string; grade_section: string; parent_phone: string },
    status: 'ABSENT' | 'LATE',
  ) => {
    const prev = existingMap.get(String(student.id));
    // SMS only for ABSENT on the current day, and only once per student/day.
    // The SMS insert + absence upsert commit in ONE transaction (retried on
    // deadlock), so a retry can never double-notify a parent.
    const shouldSms =
      status === 'ABSENT' && smsToday && student.parent_phone && (!prev || prev.status !== 'ABSENT' || !prev.sms_sent);
    // withConnection returns null only when the pool is gone (offline) — the
    // caller already checked db.isOnline(), so treat that as nothing sent.
    const result = await withRetry(() =>
      db.withConnection(async (conn) => {
        await conn.beginTransaction();
        try {
          let smsSent = 0;
          if (shouldSms) {
            const message = buildSmsMessage(template, {
              fullName: student.full_name,
              gradeSection: student.grade_section,
              scannedAt: new Date(),
              school: settings.school_name,
              absence: true,
            });
            await conn.execute(
              "INSERT INTO sms_logs (attendance_id, parent_phone, message, status) VALUES (NULL, ?, ?, 'PENDING')",
              [student.parent_phone, message],
            );
            smsSent = 1;
          }
          await conn.execute(
            `INSERT INTO absence_logs (student_id, day, status, sms_sent) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE status = VALUES(status), sms_sent = IF(absence_logs.sms_sent = 1, 1, VALUES(sms_sent))`,
            [student.id, dayStr, status, smsSent],
          );
          await conn.commit();
          return { smsSent };
        } catch (err) {
          await conn.rollback().catch(() => undefined);
          throw err;
        }
      }),
    );
    const smsSent = result?.smsSent ?? 0;
    if (smsSent) out.sms++;
    if (status === 'ABSENT') out.absent++;
    else out.late++;
  };

  for (const s of absent) await upsert(s, 'ABSENT');
  for (const s of lateList) await upsert(s, 'LATE');
  return out;
}

/** Runs detection for any eligible days since the last run. */
export async function runAbsenceDetection(): Promise<AbsenceRunResult> {
  const settings = settingsStore.get();
  if (!settings.absence_detect || !db.isOnline()) return { ran: false, absent: 0, late: 0, sms: 0 };

  // Leader election: only one machine flags absences + enqueues the parent
  // SMS per day, so two machines can't both notify a parent or double-flag.
  // Timeout 0 = skip this cycle when a peer is already running it (the
  // absence_last_run guard in the DB still covers the day either way).
  return (
    (await withJobLock('tapin:absence', async () => {
      const today = new Date();
      const lastRun = settings.absence_last_run ? parseDay(settings.absence_last_run) : null;
      const days: Date[] = [];
      if (lastRun) {
        let d = addDays(lastRun, 1);
        while (d.getTime() < today.getTime() && days.length < BACKFILL_CAP) {
          days.push(d);
          d = addDays(d, 1);
        }
      }
      // Today only counts once dismissal + buffer has passed.
      if (isPastCutoff(settings)) days.push(today);

      if (days.length === 0) return { ran: false, absent: 0, late: 0, sms: 0 };

      const totals = { absent: 0, late: 0, sms: 0 };
      for (const day of days) {
        try {
          const r = await runForDay(day, settings);
          totals.absent += r.absent;
          totals.late += r.late;
          totals.sms += r.sms;
        } catch (err) {
          console.error(`[tapin] absence detection failed for ${fmtDay(day)}:`, err);
        }
      }
      await settingsStore.update({ absence_last_run: fmtDay(today) });
      return { ran: true, ...totals };
    })) ?? { ran: false, absent: 0, late: 0, sms: 0 }
  );
}

let timer: NodeJS.Timeout | null = null;
let onDbStatus: ((s: { online: boolean }) => void) | null = null;

export function startAbsenceService(): void {
  // Boot attempt — no-ops harmlessly if settings aren't loaded / DB offline yet.
  void runAbsenceDetection().catch(() => undefined);
  timer = setInterval(() => {
    void runAbsenceDetection().catch(() => undefined);
  }, CHECK_INTERVAL_MS);
  // Re-attempt right after the DB reconnects (e.g. kiosk started offline).
  onDbStatus = (s) => {
    if (s.online) void runAbsenceDetection().catch(() => undefined);
  };
  db.on('status', onDbStatus);
}

export function stopAbsenceService(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (onDbStatus) db.removeListener('status', onDbStatus);
  onDbStatus = null;
}
