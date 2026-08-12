// Connect-to-database dialog (see NETWORK_DATABASE_CONNECTION.md §4).
// Enter Host / Port / User / Password / Database and click Connect — the main
// process tests the connection immediately, saves the config to
// userData/db-config.json on success, re-runs the boot pipeline, and reloads
// the window. On failure the real MySQL error is shown and the dialog stays
// open so the admin can fix and retry.
import { useEffect, useState } from 'react';
import type { DbConfigInfo } from '../../shared/types';
import { api } from '../lib/api';
import { Modal } from './shared';

export function ConnectDbDialog({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<DbConfigInfo | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3306');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Prefill from the current effective config (saved connection or .env).
  useEffect(() => {
    void api.getDbConfig().then((c) => {
      setCfg(c);
      setHost(c.host);
      setPort(String(c.port));
      setUser(c.user);
      setDatabase(c.database);
    });
  }, []);

  const finish = (msg: string) => {
    setDone(msg);
    setError(null);
    // In Electron the main process reloads the window on success; the dialog
    // is unmounted with it. In browser demo mode nothing reloads, so close
    // after a short beat so the success message is visible.
    setTimeout(onClose, 1500);
  };

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.connectDb({
        host: host.trim(),
        port: Number(port) || 3306,
        user: user.trim(),
        password,
        database: database.trim(),
      });
      if (res.ok) {
        finish('Connected! Reloading to the selected server…');
        return;
      }
      setError(res.error ?? 'Connection failed.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Back to .env / defaults — clears the saved per-machine connection.
  const reset = async () => {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.resetDbConfig();
      if (res.ok) {
        finish('Using .env / defaults. Reloading…');
        return;
      }
      setError(res.error ?? 'Reset failed.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Connect to database" onClose={onClose}>
      {done ? (
        <div className="db-dialog-done">
          <div className="db-dialog-done-icon">✅</div>
          <p>{done}</p>
        </div>
      ) : (
        <form onSubmit={connect} className="db-dialog-form">
          <p className="db-dialog-note">
            Point this computer at the shared MySQL server ({cfg?.source === 'saved' ? 'a saved connection is active' : cfg?.source === 'env' ? 'using .env / environment values' : 'using built-in defaults'}).
          </p>
          <div className="field-row">
            <div className="field db-dialog-host">
              <label htmlFor="db-host">Host</label>
              <input
                id="db-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="e.g. 192.168.1.129"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="field db-dialog-port">
              <label htmlFor="db-port">Port</label>
              <input
                id="db-port"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                placeholder="3306"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="db-user">User</label>
              <input
                id="db-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="root"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="db-database">Database</label>
              <input
                id="db-database"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="tapin_school"
                spellCheck={false}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="db-password">Password</label>
            <input
              id="db-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={cfg?.hasSavedPassword ? '•••••• (saved — leave blank to keep)' : 'No password'}
              autoComplete="new-password"
            />
            {cfg?.hasSavedPassword && (
              <span className="field-hint">A password is saved for this server — leave blank to reuse it (a different server needs its own).</span>
            )}
          </div>

          {error && (
            <div className="db-dialog-error" role="alert">
              <span className="db-dialog-error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div className="form-actions">
            {cfg?.isSaved && (
              <button type="button" className="btn-ghost" onClick={() => void reset()} disabled={busy}>
                Use .env / defaults
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !host.trim() || !database.trim()}>
              {busy ? 'Testing connection…' : 'Connect'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
