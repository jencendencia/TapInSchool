// Users & roles: dashboard accounts (admin) and kiosk staff accounts with a
// 4–8 digit PIN used for the kiosk manual check-in (forgot-QR) flow.
// Passwords/PINs are hashed server-side; the renderer only sees a has_pin flag.
import { useCallback, useEffect, useState } from 'react';
import type { User, UserInput, UserRole } from '../../../shared/types';
import { api } from '../../lib/api';
import { Modal, Spinner, Toast } from '../../components/shared';

type ModalState = { type: 'add' } | { type: 'edit'; user: User } | null;

function UserForm({
  initial,
  isEdit,
  hasPin,
  onSave,
  onCancel,
}: {
  /** Username + role (+ password when creating). PIN starts blank in edit mode. */
  initial: { username: string; role: UserRole; password: string; pin: string };
  isEdit: boolean;
  /** Current account has a kiosk PIN (edit mode — blank input keeps it). */
  hasPin: boolean;
  /** Receives a partial patch; omit `pin` to keep, '' to clear, digits to set. */
  onSave: (patch: Partial<UserInput>) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(initial.username);
  const [role, setRole] = useState<UserRole>(initial.role);
  const [password, setPassword] = useState(initial.password);
  const [pin, setPin] = useState(initial.pin);
  const [clearPin, setClearPin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pinDigits = pin.replace(/\D/g, '').slice(0, 8);
  const isStaff = role === 'staff';

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
      // Always send the typed PIN — on add it is required, on edit it replaces
      // the old one. (Omitting it would leave the backend with an empty pin.)
      if (typedPin) patch.pin = typedPin;
    } else {
      const pw = password;
      if (!isEdit) {
        if (pw.length < 4) return setError('Admin users need a password (min 4 characters).');
        patch.password = pw;
      } else if (pw) {
        patch.password = pw;
      }
      if (typedPin) patch.pin = typedPin;
      else if (clearPin) patch.pin = '';
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
        </select>
        <p className="field-hint">
          {isStaff
            ? 'Staff use their PIN at the kiosk to check in students who forgot their QR code. They cannot open the admin dashboard.'
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
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.listUsers().then(setUsers);
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
    if (!window.confirm(`Delete user "${u.username}"?`)) return;
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Users & Roles</h2>
          <p className="text-dim">
            {users.length} accounts · {adminCount} admin{adminCount !== 1 ? 's' : ''} · staff PINs power the kiosk forgot-QR check-in
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
              <th>Kiosk PIN</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
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
                  <span className={`pill ${u.role === 'admin' ? 'pill-success' : 'pill-dim'}`}>
                    {u.role === 'admin' ? 'ADMIN' : 'STAFF'}
                  </span>
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
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-cell">No users yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="field-hint" style={{ marginTop: 12 }}>
        The default accounts are <b>admin / admin</b> (dashboard) and <b>staff / PIN 1234</b> (kiosk). Change them before
        deploying to a live gate.
      </p>

      {modal?.type === 'add' && (
        <Modal title="Add User" closeOnOverlay={false} onClose={() => setModal(null)}>
          <UserForm
            initial={{ username: '', role: 'staff', password: '', pin: '' }}
            isEdit={false}
            hasPin={false}
            onSave={(p) => void saveUser(p)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal title={`Edit — ${modal.user.username}`} closeOnOverlay={false} onClose={() => setModal(null)}>
          <UserForm
            initial={{ username: modal.user.username, role: modal.user.role, password: '', pin: '' }}
            isEdit
            hasPin={modal.user.has_pin}
            onSave={(p) => void saveUser(p)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {toast && <Toast message={toast} tone={toast.startsWith('Error') ? 'error' : 'success'} />}
    </div>
  );
}
