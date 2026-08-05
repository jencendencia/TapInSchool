// Asynchronous SMS dispatch worker. Polls PENDING rows every 1 second (PRD
// requirement: non-blocking UI), sends through the currently configured
// provider, and marks SENT/FAILED. Failures retry up to 5 times, then move to
// FAILED (retryable manually from the SMS Outbox).
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { getProvider } from './providers';
import { getRecentActivity } from '../services/attendance';
import type { ActivityItem, SmsLog } from '../../shared/types';

export class SmsQueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
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
      const settings = settingsStore.get();
      const provider = getProvider(settings.sms_provider);
      const rows = await db.query<SmsLog[]>(
        'SELECT * FROM sms_logs WHERE status = ? ORDER BY id ASC LIMIT 3',
        ['PENDING'],
      );
      if (rows.length === 0) return;
      for (const row of rows) {
        try {
          await provider.send(settings, row.parent_phone, row.message);
          await db.execute(
            "UPDATE sms_logs SET status = 'SENT', provider = ?, sent_at = NOW(), attempts = attempts + 1, error = NULL WHERE id = ?",
            [provider.id, row.id],
          );
        } catch (err) {
          const attempts = row.attempts + 1;
          const failed = attempts >= 5;
          await db.execute('UPDATE sms_logs SET attempts = ?, error = ?, status = ? WHERE id = ?', [
            attempts,
            (err as Error).message.slice(0, 500),
            failed ? 'FAILED' : 'PENDING',
            row.id,
          ]);
          // Brief back-off so a dead GSM module isn't hammered every second.
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      if (this.onActivity) {
        this.onActivity(await getRecentActivity(5));
      }
    } catch {
      // Transient DB error — try again next tick.
    } finally {
      this.running = false;
    }
  }
}
