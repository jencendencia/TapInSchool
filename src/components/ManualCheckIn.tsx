// Manual check-in for students who forgot their QR code (kiosk).
//
// Flow: staff PIN → student search (name / student no.) → tap a result →
// confirm → parent calls processScan(payload, 'MANUAL') so the exact same
// pipeline (debounce, IN/OUT toggle, SMS, offline queue) handles the entry.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Student } from '../../shared/types';
import { api } from '../lib/api';
import { Avatar } from './shared';

const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
const MAX_PIN = 8;
const MIN_PIN = 4;

export function ManualCheckIn({
  open,
  onClose,
  onCheckIn,
}: {
  open: boolean;
  onClose: () => void;
  /** The kiosk records the student via processScan(payload, 'MANUAL'). */
  onCheckIn: (student: Student) => void;
}) {
  const [step, setStep] = useState<'pin' | 'search'>('pin');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Student[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Student | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic guard so a slow earlier query can't overwrite fresher results.
  const searchSeq = useRef(0);

  // Fresh state each time the overlay opens, and focus the first field.
  useEffect(() => {
    if (!open) return;
    setStep('pin');
    setPin('');
    setPinError(null);
    setQuery('');
    setResults(null);
    setSearching(false);
    setSelected(null);
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
        setStep('search');
        setTimeout(() => searchInputRef.current?.focus(), 60);
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

  const appendDigit = (d: string) => {
    setPin((prev) => (prev + d).slice(0, MAX_PIN));
  };

  const backspace = () => setPin((prev) => prev.slice(0, -1));

  const handlePinInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPin(e.target.value.replace(/\D/g, '').slice(0, MAX_PIN));
    setPinError(null);
  };

  // Debounced search on the student registry (name / student no / section).
  const runSearch = useCallback((q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = q.trim();
    if (!trimmed) {
      setResults(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      api
        .listStudents(trimmed)
        .then((list) => {
          if (seq !== searchSeq.current) return; // stale — a newer query won
          setResults(list.filter((s) => s.is_active).slice(0, 12));
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setResults([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 250);
  }, []);

  useEffect(() => {
    if (!open) return;
    runSearch(query);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [open, query, runSearch]);

  const confirmCheckIn = () => {
    if (!selected) return;
    onCheckIn(selected);
  };

  if (!open) return null;

  return (
    <div className="cam-overlay manual-overlay">
      <div className="cam-card manual-card">
        <div className="cam-head">
          <h3>{step === 'pin' ? 'Staff PIN required' : 'Manual check-in'}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Close manual check-in">
            ✕
          </button>
        </div>

        {step === 'pin' ? (
          <div className="manual-pin">
            <p className="cam-hint">
              Enter the gate staff PIN to check in a student who forgot their QR code.
            </p>
            <div className="pin-dots" aria-hidden>
              {/* Start at MIN_PIN slots and grow to the typed length (capped at
                  MAX_PIN) so the dots always match what a 4–8 digit PIN needs. */}
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
        ) : (
          <div className="manual-search">
            <div className="field">
              <input
                ref={searchInputRef}
                className="search-input"
                placeholder="Type a student name or student number…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                }}
              />
            </div>
            <p className="cam-hint">
              Tap the student to check them IN or OUT — same as scanning their QR.
            </p>

            {selected ? (
              <div className="manual-confirm">
                <Avatar name={selected.full_name} photoUrl={selected.photo_url} size={64} />
                <div className="manual-confirm-info">
                  <strong>{selected.full_name}</strong>
                  <span className="text-dim">
                    {selected.grade_section || 'No section'} · {selected.student_no}
                  </span>
                </div>
                <div className="manual-confirm-actions">
                  <button type="button" className="btn-ghost" onClick={() => setSelected(null)}>
                    Change
                  </button>
                  <button type="button" className="btn-primary" onClick={confirmCheckIn}>
                    ✓ Confirm check-in
                  </button>
                </div>
              </div>
            ) : searching ? (
              <p className="manual-empty">Searching…</p>
            ) : query.trim() && results !== null && results.length === 0 ? (
              <p className="manual-empty">No active students match “{query.trim()}”.</p>
            ) : (
              <ul className="manual-results">
                {(results ?? []).map((s) => (
                  <li key={s.id}>
                    <button type="button" className="manual-result" onClick={() => setSelected(s)}>
                      <Avatar name={s.full_name} photoUrl={s.photo_url} size={44} />
                      <span className="manual-result-text">
                        <span className="manual-result-name">{s.full_name}</span>
                        <span className="manual-result-meta text-dim">
                          {s.grade_section || 'No section'} · {s.student_no}
                        </span>
                      </span>
                      <span className="manual-result-arrow" aria-hidden>
                        ›
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
