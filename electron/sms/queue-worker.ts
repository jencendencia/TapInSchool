// Asynchronous SMS dispatch worker. Polls PENDING rows every 1 second (PRD
// requirement: non-blocking UI), sends through the currently configured
// provider, and marks SENT/FAILED. Failures retry up to 5 times, then move to
// FAILED (retryable manually from the SMS Outbox).
import { db } from '../db/connection';
import { randomUUID } from 'crypto';
import { settingsStore } from '../db/settings';
import { getProvider } from './providers';
import { getRecentActivity } from '../services/attendance';
import { withJobLock } from '../services/job-lock';
import type { ActivityItem, SmsLog } from '../../shared/types';

const CLAIM_LEASE_MINUTES = 2;
const RETENTION_DAYS = 90;
const DEFAULT_BATCH_SIZE = 6;
const MAX_BATCH_SIZE = 18;

export class SmsQueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly workerId = `sms-${randomUUID()}`;
  private lastRetentionAt = 0;
  onActivity: ((items: ActivityItem[]) => void) | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!db.isOnline()) return;
      // Leader election covers only recovery and claiming. Timeout 0 means
      // another machine gets the next chance on the following tick.
      const rows = await withJobLock('tapin:sms-queue', async () => {
        const settings = settingsStore.get();
        const provider = getProvider(settings.sms_provider);
        const modemCount = provider.getRecommendedConcurrency?.(settings) ?? 1;
        const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(DEFAULT_BATCH_SIZE, modemCount * 3));
        // Recover abandoned claims before taking new work. A lease prevents a
        // crashed worker from leaving rows permanently stuck in IN_PROGRESS.
        await db.execute(
          `UPDATE sms_logs SET status = 'PENDING', claimed_by = NULL, claimed_at = NULL
           WHERE status = 'IN_PROGRESS'
             AND (claimed_at IS NULL OR claimed_at < DATE_SUB(NOW(3), INTERVAL ${CLAIM_LEASE_MINUTES} MINUTE))`,
        );
        // Claim rows under the short distributed lock, then send outside it.
        // Ownership prevents another machine from updating or dispatching our
        // rows while the modem/API is busy.
        // Scale work with the configured modem pool while keeping a hard cap.
        await db.execute(
          `UPDATE sms_logs SET status = 'IN_PROGRESS', claimed_by = ?, claimed_at = NOW(3)
           WHERE status = 'PENDING' ORDER BY id ASC LIMIT ${batchSize}`,
          [this.workerId],
        );
        const rows = await db.query<SmsLog[]>(
          "SELECT * FROM sms_logs WHERE status = 'IN_PROGRESS' AND claimed_by = ? ORDER BY id ASC",
          [this.workerId],
        );
        return rows;
      });
      if (!rows || rows.length === 0) return;

      const settings = settingsStore.get();
      const provider = getProvider(settings.sms_provider);
      // Dispatch in parallel — the GSM provider's send() is already
      // serialized per-modem instance, so concurrent calls fan out across
      // different modems for parallel throughput.
      await Promise.all(
        rows.map(async (row) => {
          try {
            await provider.send(settings, row.parent_phone, row.message);
            await db.execute(
              "UPDATE sms_logs SET status = 'SENT', provider = ?, sent_at = NOW(), attempts = attempts + 1, error = NULL, claimed_by = NULL, claimed_at = NULL WHERE id = ? AND status = 'IN_PROGRESS' AND claimed_by = ?",
              [provider.id, row.id, this.workerId],
            );
          } catch (err) {
            const attempts = row.attempts + 1;
            const failed = attempts >= 5;
            await db.execute('UPDATE sms_logs SET attempts = ?, error = ?, status = ?, claimed_by = NULL, claimed_at = NULL WHERE id = ? AND status = \'IN_PROGRESS\' AND claimed_by = ?', [
              attempts,
              (err as Error).message.slice(0, 500),
              failed ? 'FAILED' : 'PENDING',
              row.id,
              this.workerId,
            ]);
            // Brief back-off so a dead GSM module isn't hammered every second.
            await new Promise((r) => setTimeout(r, 800));
          }
        }),
      );
      if (this.onActivity) {
        this.onActivity(await getRecentActivity(5));
      }
      if (Date.now() - this.lastRetentionAt >= 24 * 60 * 60 * 1000) {
        this.lastRetentionAt = Date.now();
        await db.execute(
          `DELETE FROM sms_logs WHERE status = 'SENT' AND sent_at < DATE_SUB(NOW(), INTERVAL ${RETENTION_DAYS} DAY)`,
        );
      }
    } catch {
      // Transient DB error — try again next tick.
    } finally {
      this.running = false;
    }
  }
}
