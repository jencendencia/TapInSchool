// Crash / hang watchdog (P0-3.3). Logs fatal main-process errors to a file,
// auto-relaunches the packaged app on an uncaught exception, reloads the
// renderer when it crashes or stops answering, and caps reload loops so a
// broken renderer relaunches instead of spinning. For OS-level restart
// (restart-on-failure even if the whole machine loses the process), wrap the
// exe in a Windows service (NSSM / node-windows) — see README.
import { app, type BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

const PING_INTERVAL_MS = 30000;
const PING_TIMEOUT_MS = 5000;
const MAX_CONSECUTIVE_RELOADS = 5;

let reloadStreak = 0;

function logFile(): string {
  return path.join(app.getPath('userData'), 'logs', 'app.log');
}

async function logFatal(what: string, err: unknown): Promise<void> {
  const line = `[${new Date().toISOString()}] ${what}: ${
    err instanceof Error ? err.stack ?? err.message : String(err)
  }\n`;
  console.error('[tapin]', line.trim());
  try {
    const file = logFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, line, 'utf8');
  } catch {
    // Logging must never take the app down.
  }
}

function relaunch(): void {
  if (app.isPackaged) {
    app.relaunch();
    app.exit(1);
  }
}

export function setupWatchdog(getWindow: () => BrowserWindow | null): void {
  // Fatal main-process errors: record them; in packaged builds restart cleanly
  // (an uncaught exception means the main process state is no longer trusted).
  // In dev we log only so the exception stays debuggable.
  process.on('uncaughtException', (err) => {
    void logFatal('uncaughtException', err);
    relaunch(); // no-op in dev (keeps the exception debuggable)
  });
  process.on('unhandledRejection', (err) => {
    void logFatal('unhandledRejection', err);
  });

  // Renderer process died: reload, but bail out to a relaunch on a crash loop.
  app.on('render-process-gone', (_event, _wc, details) => {
    if (details.reason === 'clean-exit') return;
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    void logFatal('render-process-gone', new Error(details.reason));
    reloadStreak += 1;
    if (reloadStreak >= MAX_CONSECUTIVE_RELOADS) {
      reloadStreak = 0;
      relaunch();
    } else {
      win.reload();
    }
  });

  // Renderer hang check: ping it periodically; reload if it stops answering.
  setInterval(() => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.webContents.isCrashed()) {
      win.reload();
      return;
    }
    const timeout = setTimeout(() => {
      reloadStreak += 1;
      void logFatal('renderer-hang', new Error('renderer did not respond to ping'));
      if (reloadStreak >= MAX_CONSECUTIVE_RELOADS) {
        reloadStreak = 0;
        relaunch();
      } else {
        win.reload();
      }
    }, PING_TIMEOUT_MS);
    win.webContents
      .executeJavaScript('void 0')
      .then(() => {
        clearTimeout(timeout);
        reloadStreak = 0;
      })
      .catch(() => clearTimeout(timeout));
  }, PING_INTERVAL_MS);
}
