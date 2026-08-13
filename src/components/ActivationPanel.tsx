// "App activation" panel — used on the admin Settings page. Shows whether this
// PC is activated with a license key (plus the machine ID the key is tied to)
// and lets the admin enter a key or replace the current one. Validates against
// the license server via the main process; in browser mock mode it always
// reports DEV-MODE activated.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { LicenseStatus } from '../../shared/types';
import { api } from '../lib/api';

/** Masks a license key for display (e.g. TAPIN-…-2C8K). */
function maskKey(k: string): string {
  if (k.length <= 10) return k;
  return `${k.slice(0, 5)}…${k.slice(-4)}`;
}

export function ActivationPanel() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void api.checkLicense().then(setStatus);
  }, []);
  useEffect(refresh, [refresh]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError('Enter a license key first.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await api.activateLicense(trimmed);
    setBusy(false);
    if (res.valid) {
      setMessage(res.message || 'License activated on this device.');
      setKey('');
      refresh();
    } else {
      setError(res.message || 'Activation failed.');
    }
  };

  return (
    <div className="update-panel">
      <div className="activation-status-row">
        {status?.activated ? (
          <span className="pill pill-success">✓ ACTIVATED</span>
        ) : (
          <span className="pill pill-danger">NOT ACTIVATED</span>
        )}
        {status?.licenseKey && (
          <span className="mono activation-key" title={status.licenseKey}>
            {maskKey(status.licenseKey)}
          </span>
        )}
      </div>
      {status?.machineId && (
        <p className="field-hint">
          Machine ID: <code>{status.machineId}</code> — this device's license is tied to this ID.
        </p>
      )}
      {!status?.activated && status?.message && (
        <p className="field-hint sms-error">{status.message}</p>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label>{status?.activated ? 'Replace license key' : 'License key'}</label>
          <div className="field-row">
            <input
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                // Clear a stale result while the admin is typing a new key.
                setError(null);
                setMessage(null);
              }}
              placeholder="TAPIN-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={busy}
              style={{ whiteSpace: 'nowrap' }}
            >
              {busy ? 'Activating…' : status?.activated ? '🔑 Replace key' : '🔑 Activate'}
            </button>
          </div>
        </div>
      </form>
      {error && <p className="field-hint sms-error">{error}</p>}
      {message && <p className="field-hint">{message}</p>}
      <p className="field-hint">
        One license key per device, validated online against the school's license server. The key is
        cached on this PC — contact your school administrator if you don't have one.
      </p>
    </div>
  );
}
