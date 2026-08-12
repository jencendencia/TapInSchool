// MySQL connection manager. Keeps a pool alive, reports online/offline status
// through an EventEmitter, and self-heals with a retry loop so the kiosk can
// start before the database is reachable (offline-first).
//
// Config resolution (first that has a value wins — see
// NETWORK_DATABASE_CONNECTION.md):
//   1. Saved connection — userData/db-config.json, applied via
//      applySavedConfig() before db.start() (set from the title-bar dialog).
//   2. OS environment variables / .env — DB_HOST, DB_PORT, DB_USER, ...
//   3. Built-in defaults (127.0.0.1 / 3306 / root / tapin_school).
import { createPool, type Pool, type PoolConnection } from 'mysql2/promise';
import { EventEmitter } from 'events';

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function envConfig(): DbConfig {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tapin_school',
  };
}

/** The saved per-machine connection (db-config.json) when one exists. */
let savedConfig: DbConfig | null = null;

/** The currently effective config: a saved connection overrides env/defaults. */
export function currentConfig(): DbConfig {
  return savedConfig ? { ...envConfig(), ...savedConfig } : envConfig();
}

/** Copy of the saved connection, or null when the machine has none. */
export function getSavedConfig(): DbConfig | null {
  return savedConfig ? { ...savedConfig } : null;
}

/** Applies a saved connection BEFORE any pool is created (startup path). */
export function applySavedConfig(cfg: DbConfig | null): void {
  savedConfig = cfg ? { ...cfg } : null;
}

export interface DbStatus {
  online: boolean;
  detail: string;
}

class Database extends EventEmitter {
  private pool: Pool | null = null;
  private online = false;
  private detail = 'Not connected';
  private retryTimer: NodeJS.Timeout | null = null;
  private started = false;
  /**
   * Monotonic token so a slower, superseded connect() attempt (an old retry
   * still in flight when the admin switches servers) can never end or
   * overwrite the pool of a newer attempt. Every connect() and forceReconnect()
   * bumps it; attempts compare their own captured token before touching state.
   */
  private connectSeq = 0;

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.connect();
  }

  async connect(): Promise<boolean> {
    if (this.online) return true;
    const seq = ++this.connectSeq;
    const cfg = currentConfig();
    try {
      const pool = createPool({
        ...cfg,
        waitForConnections: true,
        connectionLimit: 5,
        connectTimeout: 4000,
        enableKeepAlive: true,
        // Shared types declare date fields as strings; without this, mysql2 maps
        // DATE/DATETIME columns to JS Date objects and renderer code like
        // date.slice() crashes (blank admin dashboard).
        dateStrings: true,
      });
      // Verify with a real round trip so we never report online prematurely.
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      // A newer attempt superseded this one (e.g. setConfig fired while this
      // was connecting) — discard our pool and let the newer attempt win.
      if (seq !== this.connectSeq) {
        await pool.end().catch(() => undefined);
        return this.online;
      }
      this.pool = pool;
      this.setOnline(true, `MySQL ${cfg.host}:${cfg.port} connected`);
      return true;
    } catch (err) {
      // Superseded attempts must not tear down the newer attempt's pool.
      if (seq !== this.connectSeq) return false;
      this.pool?.end().catch(() => undefined);
      this.pool = null;
      this.setOnline(false, `MySQL ${cfg.host}:${cfg.port} unreachable — ${(err as Error).message}`);
      this.scheduleRetry();
      return false;
    }
  }

  /**
   * Tests a candidate config with a throwaway pool (no state change). Returns
   * the real MySQL error message on failure so the Connect-to-database dialog
   * can show it (access denied, timeout, unknown database, ...).
   */
  async testConnection(cfg: DbConfig): Promise<{ ok: boolean; error?: string }> {
    const pool = createPool({
      ...cfg,
      waitForConnections: true,
      connectionLimit: 1,
      connectTimeout: 4000,
      enableKeepAlive: true,
      dateStrings: true,
    });
    let conn: PoolConnection | null = null;
    try {
      conn = await pool.getConnection();
      await conn.ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      // Always hand the checked-out connection back so pool.end() can't hang
      // waiting on a leaked one after a failed ping.
      if (conn) {
        try {
          conn.release();
        } catch {
          // Already released / connection broken — nothing to do.
        }
      }
      await pool.end().catch(() => undefined);
    }
  }

  /**
   * Switches the live connection to a new config (used after a successful
   * dialog connect). Ends the current pool, clears the retry timer, and
   * reconnects so the change applies immediately even while online.
   */
  async setConfig(cfg: DbConfig): Promise<boolean> {
    savedConfig = { ...cfg };
    return this.forceReconnect();
  }

  /** Drops the saved override and reconnects with env / defaults. */
  async resetConfig(): Promise<boolean> {
    savedConfig = null;
    return this.forceReconnect();
  }

  private async forceReconnect(): Promise<boolean> {
    // Invalidate any in-flight connect so it can't end the pool we create.
    this.connectSeq++;
    if (this.pool) {
      await this.pool.end().catch(() => undefined);
      this.pool = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.online = false;
    this.setOnline(false, 'Reconnecting…');
    return this.connect();
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, 5000);
  }

  private setOnline(online: boolean, detail: string): void {
    if (this.online !== online || this.detail !== detail) {
      this.online = online;
      this.detail = detail;
      this.emit('status', this.getStatus());
    }
  }

  isOnline(): boolean {
    return this.online;
  }

  getStatus(): DbStatus {
    return { online: this.online, detail: this.detail };
  }

  private requirePool(): Pool {
    if (!this.pool) throw new Error('Database is offline');
    return this.pool;
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T> {
    // mysql2's generic parameter is the rows array itself, so T is the full
    // result shape (e.g. Student[] or { c: number }[]).
    const [rows] = await this.requirePool().query(sql, params as never);
    return rows as T;
  }

  async execute(sql: string, params?: unknown[]): Promise<{ insertId: number; affectedRows: number }> {
    const [result] = await this.requirePool().execute(sql, params as never);
    return {
      insertId: (result as { insertId: number }).insertId,
      affectedRows: (result as { affectedRows: number }).affectedRows,
    };
  }

  async stop(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => undefined);
      this.pool = null;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }
}

export const db = new Database();
