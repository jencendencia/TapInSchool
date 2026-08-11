// Quick walk-in visitor registration at the kiosk (staff-only, PIN protected).
//
// Flow: staff PIN → visitor details → Save → the generated VP QR is shown so
// the gate staff can copy it or print a pass to hand to the visitor. Mirrors
// ManualCheckIn's PIN gate and the admin Visitors screen's QR modal.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { Visitor, VisitorInput } from '../../shared/types';
import { api } from '../lib/api';
import { QrCodeImage } from './shared';

const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
const MAX_PIN = 8;
const MIN_PIN = 4;

type Step = 'pin' | 'form' | 'done';

const EMPTY_FORM: VisitorInput = {
  full_name: '',
  contact_phone: '',
  purpose: '',
  host_office: '',
  id_presented: '',
};

export function VisitorRegister({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired once when a visitor is successfully created (before the QR step). */
  onRegistered?: (visitor: Visitor) => void;
}) {
  const [step, setStep] = useState<Step>('pin');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [form, setForm] = useState<VisitorInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Visitor | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Fresh state each time the overlay opens, and focus the first field.
  useEffect(() => {
    if (!open) return;
    setStep('pin');
    setPin('');
    setPinError(null);
    setVerifying(false);
    setForm(EMPTY_FORM);
    setError(null);
    setSaving(false);
    setCreated(null);
    const t = setTimeout(() => pinInputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const verifyPin = async (value: string) => {
    if (value.length < MIN_PIN || verifying) return;
    setVerifying(true);
    setPinError(null);
    try {
      const ok = await api.verifyStaffPin(value);
      if (ok) {
        setStep('form');
        setTimeout(() => nameRef.current?.focus(), 60);
        return;
      }
      setPinError('Incorrect PIN — please ask the gate staff.');
      setPin('');
    } catch {
      setPinError('Could not verify the PIN right now.');
    } finally {
      setVerifying(false);
    }
  };

  const appendDigit = (d: string) => setPin((prev) => (prev + d).slice(0, MAX_PIN));
  const backspace = () => setPin((prev) => prev.slice(0, -1));

  const handlePinInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPin(e.target.value.replace(/\D/g, '').slice(0, MAX_PIN));
    setPinError(null);
  };

  const set = (k: keyof VisitorInput, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };

  const submit = async () => {
    if (!form.full_name.trim()) {
      setError('Visitor name is required.');
      return;
    }
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const visitor = await api.createVisitor(form);
      setCreated(visitor);
      setStep('done');
      onRegistered?.(visitor);
    } catch (err) {
      setError(`Could not register the visitor: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const printQr = async () => {
    if (!created) return;
    const url = await QRCode.toDataURL(created.qr_hash_payload, { width: 480, margin: 2 });
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Visitor QR — ${created.full_name}</title>
      <style>body{font-family:sans-serif;text-align:center;padding:24px}
      img{width:300px;border:1px solid #ccc;border-radius:8px;padding:12px}
      h2{margin:8px 0 2px}p{margin:2px 0;color:#555}
      code{font-size:12px;color:#888;word-break:break-all}</style></head><body>
      <h2>${created.full_name}</h2>
      ${created.purpose ? `<p>${created.purpose}</p>` : ''}
      ${created.host_office ? `<p>Visiting: ${created.host_office}</p>` : ''}
      <img src="${url}" alt="QR" />
      <p><code>${created.qr_hash_payload}</code></p>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  if (!open) return null;

  return (
    <div className="cam-overlay manual-overlay">
      <div className="cam-card manual-card">
        <div className="cam-head">
          <h3>
            {step === 'pin'
              ? 'Staff PIN required'
              : step === 'form'
                ? 'Register visitor'
                : 'Visitor registered'}
          </h3>
          <button className="btn-icon" onClick={onClose} aria-label="Close visitor registration">
            ✕
          </button>
        </div>

        {step === 'pin' ? (
          <div className="manual-pin">
            <p className="cam-hint">
              Enter the gate staff PIN to register a walk-in visitor and issue their QR pass.
            </p>
            <div className="pin-dots" aria-hidden>
              {Array.from({ length: Math.max(MIN_PIN, Math.min(pin.length, MAX_PIN)) }, (_, i) => (
                <span key={i} className={`pin-dot ${i < pin.length ? 'pin-dot-fill' : ''}`} />
              ))}
            </div>
            <input
              ref={pinInputRef}
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={handlePinInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void verifyPin(pin);
                if (e.key === 'Backspace') backspace();
              }}
            />
            {pinError && <p className="pin-error">{pinError}</p>}
            <div className="pin-keypad">
              {KEYPAD_KEYS.map((k, i) =>
                k === '' ? (
                  <span key={i} className="pin-key-spacer" />
                ) : k === 'back' ? (
                  <button
                    key={i}
                    type="button"
                    className="pin-key"
                    onClick={backspace}
                    disabled={!pin.length}
                    aria-label="Delete digit"
                  >
                    ⌫
                  </button>
                ) : (
                  <button key={i} type="button" className="pin-key" onClick={() => appendDigit(k)}>
                    {k}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              className="btn-primary manual-unlock"
              disabled={pin.length < MIN_PIN || verifying}
              onClick={() => void verifyPin(pin)}
            >
              {verifying ? 'Verifying…' : 'Unlock'}
            </button>
          </div>
        ) : step === 'form' ? (
          <form
            className="manual-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="field">
              <label>Full Name</label>
              <input
                ref={nameRef}
                required
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
                placeholder="e.g. Ramon Bautista"
              />
            </div>
            <div className="field">
              <label>Purpose of Visit</label>
              <input
                value={form.purpose ?? ''}
                onChange={(e) => set('purpose', e.target.value)}
                placeholder="e.g. Delivery, Parent meeting"
              />
            </div>
            <div className="field">
              <label>Host / Office Being Visited</label>
              <input
                value={form.host_office ?? ''}
                onChange={(e) => set('host_office', e.target.value)}
                placeholder="e.g. Principal's Office"
              />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Contact Phone (optional)</label>
                <input
                  value={form.contact_phone ?? ''}
                  onChange={(e) => set('contact_phone', e.target.value)}
                  placeholder="09171234567"
                />
              </div>
              <div className="field">
                <label>ID Presented (optional)</label>
                <input
                  value={form.id_presented ?? ''}
                  onChange={(e) => set('id_presented', e.target.value)}
                  placeholder="e.g. Driver's License N-12345678"
                />
              </div>
            </div>
            {error && <p className="pin-error">{error}</p>}
            <p className="cam-hint">
              A reusable VP QR pass is generated automatically — print or copy it on the next screen.
            </p>
            <div className="manual-form-actions">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : '✓ Register & generate QR'}
              </button>
            </div>
          </form>
        ) : created ? (
          <div className="manual-done">
            <p className="cam-hint">This visitor can now scan their QR at the gate — IN/OUT is tracked automatically.</p>
            <div className="qr-modal">
              <QrCodeImage text={created.qr_hash_payload} size={180} />
              <h3>{created.full_name}</h3>
              <p className="text-dim">
                {created.purpose && <>{created.purpose} · </>}
                {created.host_office || 'No host on file'}
              </p>
              <code className="qr-payload">{created.qr_hash_payload}</code>
            </div>
            <div className="manual-form-actions">
              <button
                className="btn-ghost"
                onClick={() => void navigator.clipboard?.writeText(created.qr_hash_payload)}
              >
                Copy
              </button>
              <button className="btn-ghost" onClick={() => void printQr()}>
                🖨 Print pass
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setCreated(null);
                  setError(null);
                  setStep('form');
                  setTimeout(() => nameRef.current?.focus(), 60);
                }}
              >
                + Register another
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
