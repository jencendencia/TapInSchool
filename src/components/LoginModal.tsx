// Admin sign-in gate. Shown instead of the admin dashboard until valid admin
// credentials are entered. The kiosk itself stays public — only the dashboard
// is protected.
import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';
import { api } from '../lib/api';
import { SchoolLogo } from './shared';

export function LoginModal({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, []);

  const fail = (msg: string) => {
    setError(msg);
    setShaking(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username.trim(), password);
      if (res.ok) {
        onSuccess();
        return;
      }
      fail(res.error ?? 'Sign-in failed.');
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-overlay">
      <div
        className={`login-card${shaking ? ' login-shake' : ''}${error ? ' login-card-error' : ''}`}
        onAnimationEnd={() => setShaking(false)}
        role="dialog"
        aria-modal="true"
        aria-label="Admin sign in"
      >
{/* ---- Branded header ---- */}
        <div className="login-brand">
          <div className="login-logo">
            <SchoolLogo logoUrl={settings?.logo_url} fallback="🔒" fallbackClassName="login-lock" />
          </div>
          <h2 className="login-title">{settings?.school_name || 'TapIn School'}</h2>
          <p className="login-sub">Admin Dashboard · Restricted Access</p>
          <div className="login-rule" />
        </div>

        <form className="login-form" onSubmit={submit}>
          <div className={`login-field${error && !username ? ' login-field-error' : ''}`}>
            <span className="login-field-icon">👤</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              spellCheck={false}
            />
          </div>

          <div className={`login-field${error && !password ? ' login-field-error' : ''}`}>
            <span className="login-field-icon">🔑</span>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="login-eye"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
              title={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? '🙈' : '👁'}
            </button>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <span className="login-error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="login-submit"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? (
              <>
                <span className="login-spinner" />
                Signing in…
              </>
            ) : (
              <>
                Sign In <span className="login-arrow">→</span>
              </>
            )}
          </button>

          <div className="login-foot">
            <button type="button" className="login-cancel" onClick={onCancel}>
              Cancel
            </button>
            <span className="login-hint">Default · admin / admin</span>
          </div>
        </form>
      </div>
    </div>
  );
}
