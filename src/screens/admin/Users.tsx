// Users & roles: dashboard accounts (admin), kiosk staff accounts with a 4–8
// digit PIN (forgot-QR check-in), and Department Heads — created here by an
// admin, assigned the sections they manage, and used in the TapIn Teacher
// Companion app to add teachers + assign them to those sections.
// Teacher accounts are created in the companion app and appear read-only here.
// Passwords/PINs are hashed server-side; the renderer only sees a has_pin flag.
import { useCallback, useEffect, useState } from 'react';
import type { User, UserInput, UserRole } from '../../../shared/types';
import { api } from '../../lib/api';
import { Modal, Spinner, Toast } from '../../components/shared';

type ModalState = { type: 'add' } | { type: 'edit'; user: User } | null;

const ROLE_PILL: Record<UserRole, { label: string; cls: string }> = {
  admin: { label: 'ADMIN', cls: 'pill-success' },
  staff: { label: 'STAFF', cls: 'pill-dim' },
  dept_head: { label: 'DEPT HEAD', cls: 'pill-warn' },
  teacher: { label: 'TEACHER', cls: 'pill-info' },
};

function UserForm({
  initial,
  isEdit,
  hasPin,
  allSections,
  onSave,
  onCancel,
}: {
  initial: { username: string; role: UserRole; password: string; pin: string; sections: string[] };
  isEdit: boolean;
  /** Current account has a kiosk PIN (edit mode — blank input keeps it). */
  hasPin: boolean;
  /** Every grade_section in the registry (for the dept_head assignment chips). */
  allSections: string[];
  /** Receives a partial patch; omit `pin` to keep, '' to clear, digits to set. */
  onSave: (patch: Partial<UserInput>) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(initial.username);
  const [role, setRole] = useState<UserRole>(initial.role);
  const [password, setPassword] = useState(initial.password);
  const [pin, setPin] = useState(initial.pin);
  const [clearPin, setClearPin] = useState(false);
  const [sections, setSections] = useState<string[]>(initial.sections);
  const [secFilter, setSecFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pinDigits = pin.replace(/\D/g, '').slice(0, 8);
  const isStaff = role === 'staff';
  const isDeptHead = role === 'dept_head';
  const isTeacher = role === 'teacher';

  const toggleSection = (sec: string) => {
    setSections((cur) => (cur.includes(sec) ? cur.filter((s) => s !== sec) : [...cur, sec]));
  };

  const filterQuery = secFilter.trim().toLowerCase();
  const visibleSections = allSections.filter((s) => s.toLowerCase().includes(filterQuery));
  const visibleSelected = visibleSections.filter((s) => sections.includes(s)).length;

  const submit = () => {
    const name = username.trim();
    if (!name) return setError('Username is required.');

    const patch: Partial<UserInput> = { username: name, role };
    const typedPin = pinDigits;

    if (isStaff) {
      // Creating: PIN required. Editing: blank keeps the current PIN.
      if (!isEdit && !typedPin) return setError('Staff users need a 4-8 digit kiosk PIN.');
      if (typedPin && (typedPin.length < 4 || typedPin.length > 8)) {
        return setError('Kiosk PIN must be 4-8 digits.');
      }
      if (isEdit && !typedPin && !hasPin) return setError('Staff users need a kiosk PIN.');
      if (typedPin) patch.pin = typedPin;
    } else {
      const pw = password;
      if (!isEdit) {
        if (pw.length < 4) {
          return setError(`${isDeptHead ? 'Department head' : isTeacher ? 'Teacher' : 'Admin'} users need a password (min 4 characters).`);
        }
        patch.password = pw;
      } else if (pw) {
        patch.password = pw;
      }
      // Teachers don't use a kiosk PIN; admins/dept heads may optionally have one.
      if (!isTeacher) {
        if (typedPin) patch.pin = typedPin;
        else if (clearPin) patch.pin = '';
      }
      if (isDeptHead) patch.sections = sections;
    }
    onSave(patch);
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="field">
        <label>Username</label>
        <input
          required
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="gate.staff"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="field">
        <label>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          <option value="staff">Staff — kiosk manual check-in (PIN only)</option>
          <option value="admin">Admin — dashboard access (username + password)</option>
          <option value="dept_head">Department Head — manages the teachers of their sections</option>
          <option value="teacher" disabled>
            Teacher — created in the TapIn Teacher Companion app
          </option>
        </select>
        <p className="field-hint">
          {isStaff
            ? 'Staff use their PIN at the kiosk to check in students who forgot their QR code. They cannot open the admin dashboard.'
            : isDeptHead
              ? 'Department heads sign into the TapIn Teacher Companion app, where they add teachers and assign them to the sections you pick below.'
              : isTeacher
                ? 'Teacher accounts are created and managed in the TapIn Teacher Companion app. You can reset the password here if needed.'
                : 'Admins sign in to this dashboard. They may optionally set a PIN to also use the kiosk manual check-in.'}
        </p>
      </div>
      {isStaff ? (
        <div className="field">
          <label>Kiosk PIN (4–8 digits){isEdit ? ' — blank keeps the current PIN' : ''}</label>
          <input
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
              setClearPin(false);
            }}
            placeholder={hasPin ? '••••' : '1234'}
          />
        </div>
      ) : (
        <>
          <div className="field">
            <label>Password {isEdit ? '(blank = keep current)' : ''}</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? '••••••••' : 'min 4 characters'}
            />
          </div>
          {!isTeacher && (
            <div className="field">
              <label>Optional kiosk PIN (4–8 digits){isEdit ? ' — blank keeps the current PIN' : ''}</label>
              <input
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ''));
                  setClearPin(false);
                }}
                placeholder={hasPin ? '••••' : '1234'}
              />
              <div className="photo-btn-row" style={{ marginTop: 2 }}>
                {hasPin && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ padding: '3px 10px', fontSize: 12 }}
                    onClick={() => {
                      setClearPin(true);
                      setPin('');
                    }}
                  >
                    ✕ Clear PIN
                  </button>
                )}
                <p className="field-hint">Leave blank to keep the account PIN-less (no kiosk manual check-in).</p>
              </div>
            </div>
          )}
          {isDeptHead && (
            <div className="field">
              <label>Sections this department head manages</label>
              <div className="section-picker">
                <div className="section-picker-head">
                  <span className="section-picker-count">
                    {allSections.length === 0 ? (
                      'No sections yet'
                    ) : sections.length === 0 ? (
                      'None selected'
                    ) : (
                      <>
                        <b>{sections.length}</b> of {allSections.length} selected
                      </>
                    )}
                  </span>
                  <input
                    className="section-picker-search"
                    type="search"
                    placeholder="Search sections…"
                    value={secFilter}
                    onChange={(e) => setSecFilter(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                {allSections.length === 0 ? (
                  <p className="field-hint">No sections yet — add sections on the Sections page first.</p>
                ) : (
                  <>
                    <div className="section-picker-grid">
                      {visibleSections.map((sec) => {
                        const on = sections.includes(sec);
                        return (
                          <button
                            key={sec}
                            type="button"
                            className={`chip ${on ? 'on' : ''}`}
                            onClick={() => toggleSection(sec)}
                            aria-pressed={on}
                          >
                            <span className="chip-check" aria-hidden>{on ? '✓' : ''}</span>
                            {sec}
                          </button>
                        );
                      })}
                      {visibleSections.length === 0 && (
                        <p className="field-hint">No sections match “{secFilter.trim()}”.</p>
                      )}
                    </div>
                    <div className="section-picker-foot">
                      <span className="section-picker-count">
                        {visibleSelected} of {visibleSections.length} shown selected
                      </span>
                      <span className="section-picker-actions">
                        <button
                          type="button"
                          onClick={() => setSections((cur) => [...new Set([...cur, ...visibleSections])])}
                        >
                          Select shown
                        </button>
                        <button type="button" onClick={() => setSections([])}>Clear all</button>
                      </span>
                    </div>
                  </>
                )}
              </div>
              <p className="field-hint">
                The department head can add teachers and assign them to these sections in the companion app.
              </p>
            </div>
          )}
        </>
      )}
      {error && <p className="field-hint sms-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">{isEdit ? 'Save Changes' : 'Add User'}</button>
      </div>
    </form>
  );
}

export function UsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [allSections, setAllSections] = useState<string[]>([]);
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.listUsers().then(setUsers);
    void api.listSections().then((s) => setAllSections(s.map((x) => x.grade_section))).catch(() => setAllSections([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const saveUser = async (patch: Partial<UserInput>) => {
    try {
      if (modal?.type === 'edit') {
        await api.updateUser(modal.user.id, patch);
        notify('User updated');
      } else {
        await api.createUser(patch as UserInput);
        notify(`User "${patch.username}" added`);
      }
      setModal(null);
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const removeUser = async (u: User) => {
    if (!window.confirm(`Delete user "${u.username}"? Their section assignments are removed too.`)) return;
    try {
      await api.deleteUser(u.id);
      notify(`User "${u.username}" deleted`);
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  if (!users) return <Spinner label="Loading users…" />;

  const adminCount = users.filter((u) => u.role === 'admin').length;
  const deptHeadCount = users.filter((u) => u.role === 'dept_head').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Users & Roles</h2>
          <p className="text-dim">
            {users.length} accounts · {adminCount} admin{adminCount !== 1 ? 's' : ''} · {deptHeadCount} department head{deptHeadCount !== 1 ? 's' : ''} · staff PINs power the kiosk forgot-QR check-in
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>+ Add User</button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Sections</th>
              <th>Kiosk PIN</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const pill = ROLE_PILL[u.role] ?? ROLE_PILL.staff;
              return (
                <tr key={u.id}>
                  <td>
                    <span className="cell-student">
                      <span className="avatar avatar-initials" style={{ width: 32, height: 32, fontSize: 12 }}>
                        {u.username.slice(0, 2).toUpperCase()}
                      </span>
                      <span>{u.username}</span>
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${pill.cls}`}>{pill.label}</span>
                  </td>
                  <td>
                    {u.role === 'dept_head' ? (
                      u.sections && u.sections.length ? (
                        <span className="chip-row" style={{ gap: 4 }}>
                          {u.sections.map((s) => (
                            <span key={s} className="chip" style={{ cursor: 'default', fontSize: 11 }}>{s}</span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-dim">—</span>
                      )
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                  <td>
                    {u.has_pin ? (
                      <span className="pill pill-warn">✓ PIN set</span>
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                  <td className="text-dim">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" title="Edit" onClick={() => setModal({ type: 'edit', user: u })}>✎</button>
                      <button className="btn-icon danger" title="Delete" onClick={() => void removeUser(u)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">No users yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="field-hint" style={{ marginTop: 12 }}>
        The default accounts are <b>admin / admin</b> (dashboard) and <b>staff / PIN 1234</b> (kiosk). Change them before
        deploying to a live gate. Teacher accounts are created in the <b>TapIn Teacher Companion</b> app.
      </p>

      {modal?.type === 'add' && (
        <Modal title="Add User" closeOnOverlay={false} onClose={() => setModal(null)}>
          <UserForm
            initial={{ username: '', role: 'staff', password: '', pin: '', sections: [] }}
            isEdit={false}
            hasPin={false}
            allSections={allSections}
            onSave={(p) => void saveUser(p)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal title={`Edit — ${modal.user.username}`} closeOnOverlay={false} onClose={() => setModal(null)}>
          <UserForm
            initial={{
              username: modal.user.username,
              role: modal.user.role,
              password: '',
              pin: '',
              sections: modal.user.sections ?? [],
            }}
            isEdit
            hasPin={modal.user.has_pin}
            allSections={allSections}
            onSave={(p) => void saveUser(p)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {toast && <Toast message={toast} tone={toast.startsWith('Error') ? 'error' : 'success'} />}
    </div>
  );
}
