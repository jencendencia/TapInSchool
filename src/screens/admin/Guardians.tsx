// Guardians registry: the master list of parents/guardians. Guardians are
// registered FIRST (name, mobile, address) and then linked to students from
// the Add/Edit Student modal's searchable dropdown. Registering a name that
// already exists pauses to ask whether it is the same guardian — saving anyway
// creates a same-named record with a different address/mobile (distinct QR).
import { useCallback, useEffect, useState } from 'react';
import type { Guardian, Student } from '../../../shared/types';
import { api } from '../../lib/api';
import { Avatar, Modal, Spinner, Toast } from '../../components/shared';
import { GuardianForm } from '../../components/GuardianForm';

type ModalState = { type: 'add' } | { type: 'edit'; guardian: Guardian } | null;

export function GuardiansPage() {
  const [guardians, setGuardians] = useState<Guardian[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback((q = '') => {
    void api.listGuardians(q || undefined).then(setGuardians);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Linked-student counts for each guardian (snapshot guardian_id links).
  useEffect(() => {
    void api.listStudents().then(setStudents);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  if (!guardians) return <Spinner label="Loading guardians…" />;

  const studentCount = (gid: number) => students.filter((s) => s.guardian_id === gid).length;

  const handleSaved = (g: Guardian, outcome: 'created' | 'updated' | 'exists') => {
    setModal(null);
    if (outcome === 'created') notify(`Guardian registered — ${g.full_name}`);
    else if (outcome === 'updated') notify('Guardian updated');
    else notify(`${g.full_name} is already registered — existing record kept`);
    load(search);
  };

  const remove = async (g: Guardian) => {
    const linked = studentCount(g.id);
    const msg =
      linked > 0
        ? `Delete ${g.full_name}? ${linked} linked student${linked === 1 ? '' : 's'} will be UNLINKED — their saved contact details stay on file, but the guardian dropdown entry is removed.`
        : `Delete ${g.full_name}?`;
    if (!window.confirm(msg)) return;
    try {
      await api.deleteGuardian(g.id);
      notify('Guardian deleted — linked students unlinked');
      load(search);
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Guardians</h2>
          <p className="text-dim">
            Parents &amp; guardians registered first, then linked to students from the student form
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            + Register Guardian
          </button>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search name, mobile, or address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Guardian</th>
              <th>Mobile (SMS)</th>
              <th>Address</th>
              <th>Linked Students</th>
              <th>QR Payload</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {guardians.map((g) => (
              <tr key={g.id}>
                <td>
                  <div className="cell-student">
                    <Avatar name={g.full_name} showPhoto={false} size={34} />
                    <span>{g.full_name}</span>
                  </div>
                </td>
                <td className="mono">{g.mobile || '—'}</td>
                <td>{g.address || '—'}</td>
                <td>
                  {studentCount(g.id) > 0 ? (
                    <span className="pill pill-info">
                      {studentCount(g.id)} student{studentCount(g.id) === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
                <td>
                  <code className="qr-payload sm">{g.qr_hash_payload}</code>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn-icon" title="Edit" onClick={() => setModal({ type: 'edit', guardian: g })}>
                      ✎
                    </button>
                    <button className="btn-icon danger" title="Delete" onClick={() => void remove(g)}>
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {guardians.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  {search
                    ? 'No guardians match the search.'
                    : 'No guardians registered yet. Register a guardian first, then link them to students from the Add/Edit Student form.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal?.type === 'add' && (
        <Modal title="Register Guardian" closeOnOverlay={false} onClose={() => setModal(null)}>
          <GuardianForm onSaved={handleSaved} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal title={`Edit — ${modal.guardian.full_name}`} closeOnOverlay={false} onClose={() => setModal(null)}>
          <GuardianForm initial={modal.guardian} onSaved={handleSaved} onCancel={() => setModal(null)} />
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
