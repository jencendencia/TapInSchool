// Clock drift monitoring (P0-3.7). Attendance timestamps come from MySQL
// NOW() while online and the device clock while offline, so a drifting kiosk
// clock produces misleading times. We compare the local clock against the DB
// server periodically and surface a note (e.g. in the kiosk's Database status
// dot) when they diverge. Admins should keep Windows time sync enabled
// (w32time / NTP) — see README.
import { db } from '../db/connection';

const DRIFT_WARNING_MS = 120_000; // 2 minutes
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

let lastDriftMs = 0;

/** Local clock minus DB server clock in ms (positive = local clock ahead). */
export async function measureClockDrift(): Promise<number> {
  if (!db.isOnline()) return lastDriftMs;
  try {
    // Epoch comparison (UNIX_TIMESTAMP) is timezone-independent: a MySQL
    // server running on UTC (e.g. Docker) must not be reported as "drifting".
    const [row] = await db.query<{ now: number }[]>('SELECT UNIX_TIMESTAMP(NOW()) * 1000 AS now');
    const serverMs = Number(row?.now);
    if (!Number.isNaN(serverMs)) lastDriftMs = Date.now() - serverMs;
  } catch {
    // DB down — keep the last known value.
  }
  return lastDriftMs;
}

/** Human-readable drift note, or null when the clocks are within tolerance. */
export function clockDriftNote(): string | null {
  if (Math.abs(lastDriftMs) < DRIFT_WARNING_MS) return null;
  const mins = Math.max(1, Math.abs(Math.round(lastDriftMs / 60000)));
  return `clock drift ~${mins} min (${lastDriftMs > 0 ? 'ahead' : 'behind'}) — check Windows time sync`;
}

/** Appends the drift note to a DB status detail string (e.g. kiosk dot title). */
export function decorateDbDetail(detail: string): string {
  const note = clockDriftNote();
  return note ? `${detail} · ${note}` : detail;
}

export function startClockDriftCheck(onStatusChanged: () => void): void {
  void measureClockDrift().then(onStatusChanged);
  db.on('status', (s: { online: boolean }) => {
    if (s.online) void measureClockDrift().then(onStatusChanged);
  });
  setInterval(() => {
    void measureClockDrift().then(onStatusChanged);
  }, CHECK_INTERVAL_MS);
}
