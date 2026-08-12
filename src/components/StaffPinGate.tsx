// Staff-PIN gate for admin actions reachable from the PUBLIC kiosk screen
// (e.g. opening the Connect-to-database dialog from the header Database dot).
// The dashboard itself is already login-gated, but the kiosk is a shared
// screen — so PIN-verify before exposing a server-setting dialog there.
// Reuses the same PIN UX (dots + hidden input) as ManualCheckIn.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './shared';

const MIN_PIN = 4;
const MAX_PIN = 8;

export function StaffPinGate({
  title,
  hint,
  onUnlocked,
  onClose,
}: {
  title: string;
  hint: string;
  onUnlocked: () => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const verify = async () => {
    if (pin.length < MIN_PIN || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const ok = await api.verifyStaffPin(pin);
      if (ok) {
        onUnlocked();
        return;
      }
      setError('Incorrect PIN — please ask the gate staff.');
      setPin('');
    } catch {
      setError('Could not verify the PIN right now.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="staff-pin-gate">
        <p className="db-dialog-note">{hint}</p>
        <div className="pin-dots" aria-hidden>
          {/* Start at MIN_PIN slots and grow to the typed length (capped at
              MAX_PIN) so the dots always match what a 4–8 digit PIN needs. */}
          {Array.from({ length: Math.max(MIN_PIN, Math.min(pin.length, MAX_PIN)) }, (_, i) => (
            <span key={i} className={`pin-dot ${i < pin.length ? 'pin-dot-fill' : ''}`} />
          ))}
        </div>
        <input
          ref={inputRef}
          className="pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, MAX_PIN));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void verify();
          }}
        />
        {error && <p className="pin-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={pin.length < MIN_PIN || verifying} onClick={() => void verify()}>
            {verifying ? 'Verifying…' : 'Unlock'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
