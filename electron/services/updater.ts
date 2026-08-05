// Auto-update (P0-3.8). electron-updater checks GitHub releases for new builds.
// Unlike the original silent auto-update, this exposes a manual "Check for
// Updates" flow: status events are pushed to the renderer (checking / available
// / downloading / downloaded / error) and the user explicitly downloads and
// installs. Only active in packaged builds — dev runs have no update metadata.
import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../../shared/types';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function sendUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update-status', status);
  }
}

let initialized = false;

export function setupAutoUpdater(): void {
  if (!app.isPackaged || initialized) return;
  initialized = true;

  autoUpdater.autoDownload = false; // User clicks "Download"
  autoUpdater.autoInstallOnAppQuit = true; // Install on quit

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ status: 'checking' }));
autoUpdater.on('update-available', (info) => {
    const notes = info.releaseNotes;
    const releaseNotes =
      typeof notes === 'string' ? notes : Array.isArray(notes) ? notes.map((n) => n.note).join('\n') : undefined;
    sendUpdateStatus({
      status: 'available',
      data: {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes,
      },
    });
  });
  autoUpdater.on('update-not-available', (info) =>
    sendUpdateStatus({ status: 'not-available', data: { version: info.version } }),
  );
  autoUpdater.on('download-progress', (progress) =>
    sendUpdateStatus({ status: 'downloading', data: { percent: progress.percent, transferred: progress.transferred, total: progress.total } }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    sendUpdateStatus({ status: 'downloaded', data: { version: info.version } }),
  );
  autoUpdater.on('error', (err) => {
    console.error('[tapin] auto-update error:', err?.message ?? err);
    sendUpdateStatus({ status: 'error', data: err?.message ?? String(err) });
  });

  // Periodic background check — silently notifies if an update is available.
  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[tapin] auto-update check failed:', err?.message ?? err);
    });
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}

export function checkForUpdates(): { success: boolean; message?: string } {
  try {
    autoUpdater.checkForUpdates();
    return { success: true };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export function downloadUpdate(): { success: boolean; message?: string } {
  try {
    autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, message: (err as Error).message };
  }
}

export function installUpdate(): { success: boolean } {
  autoUpdater.quitAndInstall();
  return { success: true };
}
