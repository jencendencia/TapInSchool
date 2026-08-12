// Persisted per-machine database connection (userData/db-config.json).
// The Connect-to-database dialog writes it; configureDbFromDisk() applies it
// at boot so a machine remembers its server across restarts (it overrides .env
// / OS env). The file lives in userData and is never committed to the repo.
import { app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { applySavedConfig, type DbConfig } from './connection';

function configFilePath(): string {
  return path.join(app.getPath('userData'), 'db-config.json');
}

/**
 * Applies the saved connection (if any) BEFORE the pool is created, so a
 * reconnect survives app restarts. Called from main.ts at boot — must run
 * after app is ready (userData path).
 */
export async function configureDbFromDisk(): Promise<void> {
  try {
    const raw = await fs.readFile(configFilePath(), 'utf8');
    const data = JSON.parse(raw) as Partial<DbConfig>;
    if (data && typeof data.host === 'string' && data.host.trim() && typeof data.database === 'string' && data.database.trim()) {
      applySavedConfig({
        host: data.host,
        port: Number(data.port) || 3306,
        user: String(data.user ?? 'root') || 'root',
        password: String(data.password ?? ''),
        database: data.database,
      });
    }
  } catch {
    // No saved config yet (first run) or an unreadable file — use .env / defaults.
  }
}

export async function saveDbConfig(cfg: DbConfig): Promise<void> {
  await fs.writeFile(configFilePath(), JSON.stringify(cfg, null, 2), 'utf8');
}

export async function clearDbConfig(): Promise<void> {
  try {
    await fs.unlink(configFilePath());
  } catch {
    // Nothing saved — that's fine.
  }
}
