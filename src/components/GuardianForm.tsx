// Reusable guardian registration/edit form with the duplicate-name flow:
// submitting a name that already exists in the registry pauses and asks
// whether it is the SAME guardian (nothing saved — the existing record is
// handed back) or a DIFFERENT person with the same name (saved anyway, with
// the new address/mobile → a distinct QR). Used by the Guardians admin page
// and the inline "Register new guardian…" flow inside the Add/Edit Student
// modal.
import { useState } from 'react';
import type { Guardian, GuardianInput } from '../../shared/types';
import { api } from '../lib/api';

export function GuardianForm({
  initial,
  submitLabel,
  onSaved,
  onCancel,
}: {
  /** Existing guardian when editing (blank = registration). */
  initial?: Guardian;
  submitLabel?: string;
  /** outcome 'created' | 'updated' = saved; 'exists' = the user confirmed the
   *  name already belonged to the SAME guardian (nothing was saved). */
  onSaved: (guardian: Guardian, outcome: 'created' | 'updated' | 'exists') => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.full_name ?? '');
  const [mobile, setMobile] = useState(initial?.mobile ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set when the backend reports the name is already registered.
  const [existing, setExisting] = useState<Guardian | null>(null);
  const [input, setInput] = useState<GuardianInput | null>(null);

  const save = async (allowSameName: boolean) => {
    const payload: GuardianInput = {
      full_name: name.trim(),
      mobile: mobile.trim(),
      address: address.trim(),
    };
    if (!payload.full_name) {
      setError('Guardian name is required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = initial
        ? await api.updateGuardian(initial.id, payload, allowSameName ? { allowSameName: true } : undefined)
        : await api.createGuardian(payload, allowSameName ? { allowSameName: true } : undefined);
      if (result.outcome === 'duplicate') {
        if (allowSameName) {
          // Even after confirming "different person", an IDENTICAL identity
          // (same name + address) is a true duplicate — the registry only
          // keeps one. Point the user at the existing record.
          setExisting(result.existing);
          setInput(payload);
          setError(
            `An identical guardian (same name and address) is already registered — keeping the existing record.`,
          );
        } else {
          setExisting(result.existing);
          setInput(payload);
        }
        return;
      }
      onSaved(result.guardian, result.outcome);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // The duplicate-name question replaces the form while pending an answer.
  if (existing && input) {
    return (
      <div className="guardian-dup">
        <div className="guardian-dup-icon">⚠️</div>
        <h4 className="guardian-dup-title">
          {existing.full_name} is already in the database
        </h4>
        <div className="guardian-dup-details">
          <div>
            <span className="text-dim">Mobile:</span> {existing.mobile || '—'}
          </div>
          <div>
            <span className="text-dim">Address:</span> {existing.address || '—'}
          </div>
        </div>
        <p className="text-dim guardian-dup-question">
          Is this the same guardian you are registering?
        </p>
        {error && <p className="field-hint sms-error">{error}</p>}
        <div className="guardian-dup-actions">
          <button
            className="btn-ghost"
            disabled={saving}
            onClick={() => {
              setExisting(null);
              setInput(null);
              setError(null);
            }}
          >
            ← Back
          </button>
          <button
            className="btn-ghost"
            disabled={saving}
            onClick={() => onSaved(existing, 'exists')}
            title="Use the existing record — nothing new is registered"
          >
            Yes, same guardian
          </button>
          <button
            className="btn-primary"
            disabled={saving}
            onClick={() => void save(true)}
            title="Different person with the same name — register the new record anyway"
          >
            No, different person — save anyway
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <div className="field">
        <label>Guardian Name</label>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="e.g. Samuel Jackson"
        />
      </div>
      <div className="field">
        <label>Mobile (SMS)</label>
        <input
          value={mobile}
          onChange={(e) => {
            setMobile(e.target.value);
            setError(null);
          }}
          placeholder="09171234567"
          inputMode="tel"
        />
        <p className="field-hint">
          This number receives the check-in and absence alerts for every student linked to this guardian.
        </p>
      </div>
      <div className="field">
        <label>Address</label>
        <input
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setError(null);
          }}
          placeholder="e.g. 123 Mabini St., Manila"
        />
      </div>
      {error && <p className="field-hint sms-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel ?? (initial ? 'Save Guardian' : 'Register Guardian')}
        </button>
      </div>
    </form>
  );
}
