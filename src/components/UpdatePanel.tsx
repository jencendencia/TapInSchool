// "Check for Updates" panel — used on the admin Settings page. Presents the
// auto-update flow (check → download → install) driven by electron-updater
// status events pushed from the main process. In browser mock mode it shows
// a read-only note (updates are managed by the packaged app).
import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../shared/types';
import { api } from '../lib/api';

export function UpdatePanel() {
  const [appVersion, setAppVersion] = useState('—');
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.getAppVersion().then((v) => setAppVersion(v));
    const off = api.onUpdateStatus((s) => {
      setStatus(s);
      if (s.status === 'downloading' && typeof s.data === 'object' && s.data && 'percent' in s.data) {
        setPercent(Math.round((s.data.percent ?? 0)));
      }
    });
    return off;
  }, []);

  const check = async () => {
    setBusy(true);
    setStatus({ status: 'checking' });
    const res = await api.checkForUpdates();
    if (!res.success && res.message) setStatus({ status: 'error', data: res.message });
    setBusy(false);
  };

  const download = async () => {
    setBusy(true);
    const res = await api.downloadUpdate();
    if (!res.success && res.message) setStatus({ status: 'error', data: res.message });
    setBusy(false);
  };

  const install = async () => {
    await api.installUpdate();
  };

  const statusText = (() => {
    if (!status) return '';
    switch (status.status) {
      case 'checking':
        return 'Checking for updates…';
      case 'available':
        return `Update v${(status.data as { version?: string })?.version ?? ''} is available.`;
      case 'not-available':
        return `You’re on the latest version (v${appVersion}).`;
      case 'downloading':
        return `Downloading… ${percent}%`;
      case 'downloaded':
        return 'Update downloaded. Restart to install.';
      case 'error':
        return `Error: ${typeof status.data === 'string' ? status.data : 'update failed'}`;
      default:
        return '';
    }
  })();

  const showCheck = status?.status !== 'available' && status?.status !== 'downloading' && status?.status !== 'downloaded';
  const showDownload = status?.status === 'available';
  const showInstall = status?.status === 'downloaded';
  const availableData = status?.status === 'available' ? (status.data as { version?: string; releaseDate?: string; releaseNotes?: string }) : null;

  return (
    <div className="update-panel">
      <div className="field">
        <label>Current version</label>
        <span className="mono">v{appVersion}</span>
      </div>
      <div className="update-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {showCheck && (
          <button className="btn-ghost" disabled={busy} onClick={() => void check()}>
            🔄 Check for Updates
          </button>
        )}
        {showDownload && (
          <button className="btn-primary" disabled={busy} onClick={() => void download()}>
            ⬇ Download Update
          </button>
        )}
        {showInstall && (
          <button className="btn-primary" onClick={() => void install()}>
            🔄 Restart &amp; Install
          </button>
        )}
        {(status?.status === 'downloading') && (
          <div className="update-progress" style={{ flex: 1, minWidth: 160 }}>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="mono text-dim">{percent}%</span>
          </div>
        )}
      </div>
      {statusText && <p className="field-hint">{statusText}</p>}
      {availableData?.releaseNotes && (
        <div className="update-notes">
          <span className="update-notes-label">What's new</span>
          <pre>{availableData.releaseNotes}</pre>
        </div>
      )}
      <p className="field-hint">
        Updates are downloaded from GitHub Releases and installed on restart. Auto-checks run in the background.
      </p>
    </div>
  );
}
