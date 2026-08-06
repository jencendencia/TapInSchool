// TapIn School — Electron main process.
import { app, BrowserWindow, globalShortcut, Menu, powerSaveBlocker, protocol } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { loadEnv } from './lib/env';
import { db } from './db/connection';
import { settingsStore } from './db/settings';
import { ensureSchema } from './db/schema';
import { ensureDefaultUsers } from './services/auth';
import { getRecentActivity } from './services/attendance';
import { startAbsenceService, stopAbsenceService } from './services/absence';
import { startBackupService, stopBackupService } from './services/backup';
import { decorateDbDetail, startClockDriftCheck } from './services/clock';
import { logosDir, mimeForFile } from './services/logo';
import { mediaDir, mediaMimeForFile } from './services/announcement';
import { pendingQueueCount, startOfflineService } from './services/offline';
import { setupAutoUpdater } from './services/updater';
import { setupWatchdog } from './services/watchdog';
import { UsbScanner } from './services/scanner';
import { SmsQueueWorker } from './sms/queue-worker';
import { registerIpc } from './ipc';
import { getProvider } from './sms/providers';
import type { SystemStatus } from '../shared/types';

loadEnv(app.getAppPath());

// The uploaded school logo is stored as a file on disk and served to the
// renderer through this scheme, so the DB only holds a short URL. Must be
// registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'tapin-logo', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'tapin-media', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
let scanner: UsbScanner | null = null;
const queueWorker = new SmsQueueWorker();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#020617',
    autoHideMenuBar: true,
    // Frameless: no native title bar — the renderer draws custom window
    // controls (minimize / maximize / close) on the kiosk and admin screens.
    frame: false,
    // App (taskbar/desktop) icon — separate from the school logo in Settings.
    // In dev this shows in the taskbar; packaged builds get it from the exe
    // (electron-builder win.icon), so a missing file here is harmless.
    icon: path.join(app.getAppPath(), 'JE_logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Kiosk hardening (P0-3.4): no DevTools in packaged builds.
      devTools: !app.isPackaged,
    },
  });
  // The kiosk (default screen) runs fullscreen from the moment it launches.
  mainWindow.setFullScreen(true);

  // Load renderer: dev server (npm run dev) or built files (npm start).
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    // main.js lives at dist-electron/electron/, so dist/ is two levels up.
    void mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  // --- USB QR scanner (HID keyboard emulation) ------------------------------
  scanner = new UsbScanner(mainWindow.webContents, {
    onScan: (payload) => {
      void enqueueScanAndBroadcast(payload, 'SCANNER');
    },
  });
  scanner.attach();

  // --- Keyboard shortcuts ----------------------------------------------------
  globalShortcut.register('F11', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  globalShortcut.register('Ctrl+Shift+A', () => {
    if (mainWindow) mainWindow.webContents.send('tapin:toggle-admin');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    scanner = null;
  });
}

function enqueueScanAndBroadcast(payload: string, source: 'SCANNER' | 'WEBCAM' | 'MANUAL'): Promise<unknown> {
  // enqueueScan serializes ALL scan sources through one chain.
  return import('./services/attendance').then(({ enqueueScan }) =>
    enqueueScan(payload, source, {
      onScanResult: (r) => mainWindow?.webContents.send('tapin:scan-result', r),
      onActivity: (items) => mainWindow?.webContents.send('tapin:activity', items),
    }),
  );
}

async function bootDatabase(): Promise<void> {
  db.on('status', (s: { online: boolean }) => {
    // Reload settings from the DB whenever the connection comes back up, so a
    // kiosk started offline picks up saved settings without a restart.
    if (s.online) void settingsStore.reload();
    void broadcastStatus();
  });
  db.start();
  // Wait for the first successful connect (bounded), then ensure schema.
  const deadline = Date.now() + 30000;
  while (!db.isOnline() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (db.isOnline()) {
    try {
      await ensureSchema(db.query.bind(db));
      await ensureDefaultUsers();
      await settingsStore.start();
    } catch (err) {
      console.error('[tapin] schema init failed:', err);
    }
  } else {
    // Still let settings default in-memory so the UI renders with sane values.
    await settingsStore.start();
  }
}

async function broadcastStatus(): Promise<void> {
  const settings = settingsStore.get();
  const provider = getProvider(settings.sms_provider);
  const dbStatus = db.getStatus();
  const status: SystemStatus = {
    db: { online: dbStatus.online, detail: decorateDbDetail(dbStatus.detail) },
    sms: await provider.verify(settings),
    queue: { pending: await pendingQueueCount() },
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('tapin:status', status);
  }
}

// Poll provider status every 5s so the header indicators stay live.
setInterval(() => void broadcastStatus(), 5000);

app.whenReady().then(async () => {
/**
   * Serves a local file from disk with HTTP byte-range support so media
   * (video/audio) can buffer and seek. Chromium's media pipeline issues Range
   * requests; without `Accept-Ranges` + a proper 206 response, video elements
   * loaded from a custom scheme fail to play.
   */
async function serveLocalFile(filePath: string, mime: string): Promise<Response> {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
    const data = await fs.readFile(filePath);
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  // Serve the persisted school logo file from disk (tapin-logo://logo/<file>).
  protocol.handle('tapin-logo', async (request) => {
    try {
      const url = new URL(request.url);
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const dir = logosDir();
      const filePath = path.resolve(dir, key);
      // Guard against path traversal from a tampered stored URL.
      if (!filePath.startsWith(dir + path.sep)) return new Response('Forbidden', { status: 403 });
      return serveLocalFile(filePath, mimeForFile(filePath));
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

// Serve persisted announcement media files from disk (tapin-media://media/<file>).
// Implements byte-range requests so uploaded videos play in the kiosk carousel.
  protocol.handle('tapin-media', async (request) => {
    try {
      const url = new URL(request.url);
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const dir = mediaDir();
      const filePath = path.resolve(dir, key);
      // Guard against path traversal from a tampered stored URL.
      if (!filePath.startsWith(dir + path.sep)) return new Response('Forbidden', { status: 403 });
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
      const mime = mediaMimeForFile(filePath);

      // Byte-range support (required for video buffering/seeking).
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        const start = m && m[1] ? parseInt(m[1], 10) : 0;
        const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        const chunkEnd = Math.min(end, stat.size - 1);
        if (start > chunkEnd) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
        }
        const size = chunkEnd - start + 1;
        const fd = await fs.open(filePath, 'r');
        const buf = Buffer.alloc(size);
        await fd.read(buf, 0, size, start);
        await fd.close();
        return new Response(new Uint8Array(buf), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(size),
            'Content-Range': `bytes ${start}-${chunkEnd}/${stat.size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const data = await fs.readFile(filePath);
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  // Kiosk hardening (P0-3.4): strip the application menu and block right-click
  // context menus everywhere so staff/students can't reach Inspect/Copy/Reload.
  Menu.setApplicationMenu(null);
  app.on('web-contents-created', (_event, contents) => {
    contents.on('context-menu', (e) => e.preventDefault());
  });

  registerIpc({
    setKioskMode: (active) => scanner?.setKioskMode(active),
  });

  // Headless boot test: `electron . --smoke` — boots DB + settings, reports
  // status, then quits without opening a window. Used for CI / verification.
  if (process.argv.includes('--smoke')) {
    await bootDatabase();
    const settings = settingsStore.get();
    const provider = getProvider(settings.sms_provider);
    const smsStatus = await provider.verify(settings);
    console.log('[smoke] db online:', db.isOnline(), '|', db.getStatus().detail);
    console.log('[smoke] sms provider:', settings.sms_provider, 'online:', smsStatus.online, '|', smsStatus.detail);
    console.log('[smoke] SMOKE OK');
    app.quit();
    return;
  }

  // Crash/hang watchdog (P0-3.3).
  setupWatchdog(() => mainWindow);

  // Keep the kiosk display awake (P0-3.5).
  const blockerId = powerSaveBlocker.start('prevent-display-sleep');
  app.on('will-quit', () => powerSaveBlocker.stop(blockerId));

  // Auto-launch on boot (P0-3.6) — only for packaged kiosk installs.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });

  // Silent auto-update (P0-3.8) — packaged builds only.
  setupAutoUpdater();

  createWindow();
  void bootDatabase();
  // Automatic DB backups (P0-3.2): boot snapshot + every 12 h, with rotation.
  startBackupService();
  // Clock drift monitoring (P0-3.7): refresh status so the kiosk dot shows it.
  startClockDriftCheck(() => void broadcastStatus());
  // Automated absence detection (Phase 2, 4.2): nightly LATE/ABSENT flags +
  // optional parent SMS, with missed-day backfill.
  startAbsenceService();
  // Offline write-behind queue: replays scans recorded during DB outages and
  // pushes the refreshed activity feed + status (incl. pending count) to the UI.
  startOfflineService({
    onSynced: () => {
      void getRecentActivity(5)
        .then((items) => {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send('tapin:activity', items);
          }
        })
        .catch(() => undefined);
      void broadcastStatus();
    },
  });
  queueWorker.onActivity = (items) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('tapin:activity', items);
    }
  };
  queueWorker.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  queueWorker.stop();
  stopBackupService();
  stopAbsenceService();
  globalShortcut.unregisterAll();
});
