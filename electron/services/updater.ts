// Silent auto-update (P0-3.8). electron-updater checks the publish endpoint
// configured in electron-builder.yml and installs updates on quit. Only active
// in packaged builds — dev runs have no update metadata and are skipped.
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export function setupAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => {
    console.error('[tapin] auto-update error:', err?.message ?? err);
  });

  const check = () => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      // No update server reachable / no updates available — keep running.
      console.error('[tapin] auto-update check failed:', err?.message ?? err);
    });
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}
