// App activation screen — shown on startup when the app is not yet activated
// with a valid license key. Validates the key against the license server via
// the main process and, on success, signals the parent to render the app.
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import jeLogo from '../../JE_logo.png';

export function ActivationScreen({ onActivated, initialMessage }: { onActivated: () => void; initialMessage?: string }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(initialMessage ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.checkLicense().then((r) => {
      if (r.activated) onActivated();
    });
  }, [onActivated]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError('Please enter a license key.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api.activateLicense(trimmed);
    setBusy(false);
    if (res.valid) {
      onActivated();
    } else {
      setError(res.message || 'Activation failed.');
    }
  };

return (
    <div className="activation-screen">
      <div className="activation-card">
        <div className="clogo">
          <img src={jeLogo} alt="Logo" className="activation-logo" />
        </div>
        <h2>Activate TapIn School</h2>
        <p className="text-dim">Enter your license key to unlock the app.</p>
        <form onSubmit={(e) => void submit(e)}>
          <input
            type="text"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (error) setError(null);
            }}
            placeholder="TAPIN-XXXX-XXXX-XXXX"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn-primary" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
            {busy ? 'Activating…' : '🔑 Activate'}
          </button>
        </form>
        {error && <p className="field-hint sms-error" style={{ textAlign: 'center' }}>{error}</p>}
        <p className="field-hint" style={{ textAlign: 'center', marginTop: 12 }}>
          One license key per device. Contact your school administrator if you don’t have a key.
        </p>
      </div>
    </div>
  );
}
