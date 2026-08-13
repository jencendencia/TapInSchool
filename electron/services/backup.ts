// Automatic database backups (P0-3.2). On app start and every 12 hours the
// MySQL database is dumped to a JSON snapshot under userData/backups/ and old
// backups are pruned (keeps the N most recent), so a failing drive doesn't
// silently lose attendance data.
import { app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { db } from '../db/connection';
import { withJobLock } from './job-lock';

const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;
const KEEP_BACKUPS = 14;

function backupsDir(): string {
  return path.join(app.getPath('userData'), 'backups');
}

/**
 * Dumps every table into a single JSON snapshot file. Returns the written
 * path, or null when the DB is offline / the backup failed.
 */
export async function createBackup(): Promise<string | null> {
  if (!db.isOnline()) return null;
  // Leader election: the backup is a snapshot of the SHARED database, so only
  // one machine should dump it per cycle — otherwise N machines each read the
  // whole DB every 12 h. Timeout 0 = skip when a peer is already backing up
  // (the next cycle, or the boot snapshot, still covers it).
  return withJobLock('tapin:backup', async () => {
    try {
      // Explicit alias: MySQL's information_schema columns use uppercase
      // canonical names (TABLE_NAME), so without `AS table_name` the row key
      // would be undefined and the snapshot loop would crash.
      const tables = await db.query<{ table_name: string }[]>(
        'SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY TABLE_NAME',
      );
      // NOTE: dumps all rows including student photos (data URIs); for a
      // school-sized DB this is a few MB. If logs grow huge, scope this to
      // attendance_logs/sms_logs only (see FEATURE_IMPROVEMENT_PLAN.md 3.2).
      const snapshot: { exportedAt: string; tables: Record<string, unknown[]> } = {
        exportedAt: new Date().toISOString(),
        tables: {},
      };
      let totalRows = 0;
      for (const { table_name: name } of tables) {
        // Escape backticks so an odd table name can't break the statement.
        const rows = await db.query<unknown[]>(`SELECT * FROM \`${name.replace(/`/g, '``')}\``);
        snapshot.tables[name] = rows;
        totalRows += rows.length;
      }
      const dir = backupsDir();
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `backup-${timestamp()}.json`);
      await fs.writeFile(file, JSON.stringify(snapshot));
      await pruneBackups(dir);
      console.log(`[tapin] backup written: ${file} (${totalRows} rows)`);
      return file;
    } catch (err) {
      console.error('[tapin] backup failed:', err);
      return null;
    }
  });
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

async function pruneBackups(dir: string): Promise<void> {
  try {
    const files = (await fs.readdir(dir))
      .filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
      .sort();
    const excess = files.length - KEEP_BACKUPS;
    if (excess > 0) {
      await Promise.all(
        files.slice(0, excess).map((f) => fs.unlink(path.join(dir, f)).catch(() => undefined)),
      );
    }
  } catch {
    // Directory doesn't exist yet.
  }
}

let timer: NodeJS.Timeout | null = null;

const onFirstOnline = (s: { online: boolean }) => {
  if (!s.online) return;
  db.removeListener('status', onFirstOnline);
  void createBackup();
};

export function startBackupService(): void {
  // Boot backup as soon as the DB first comes online (the connection may
  // still be establishing when this service starts).
  if (db.isOnline()) void createBackup();
  else db.on('status', onFirstOnline);
  timer = setInterval(() => void createBackup(), BACKUP_INTERVAL_MS);
}

export function stopBackupService(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
