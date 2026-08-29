// Subjects management: list, add, edit, delete subjects; assign teachers to subjects.
import { useEffect, useState } from 'react';
import type { SubjectInfo, SubjectInputInfo } from '../../../shared/types';
import { api } from '../../lib/api';
import { Modal, Toast } from '../../components/shared';

const EMPTY_FORM: SubjectInputInfo = { subject_code: '', subject_name: '', grade_level: '', description: '' };

const GRADE_LEVELS = ['Elementary', 'Secondary', 'Senior High'];

export function SubjectsPage() {
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'add' | { type: 'edit'; subject: SubjectInfo } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = () => api.listSubjects(search || undefined).then(setSubjects).catch(() => {});
  useEffect(() => { load(); }, [search]);

  const filtered = filter ? subjects.filter((s) => s.grade_level === filter) : subjects;
  const grouped = GRADE_LEVELS.map((gl) => ({
    level: gl,
    items: filtered.filter((s) => s.grade_level === gl),
  })).filter((g) => g.items.length > 0);

  const handleSave = async (input: SubjectInputInfo) => {
    try {
      if (modal && typeof modal === 'object' && 'subject' in modal) {
        await api.updateSubject(modal.subject.id, input);
        setToast('Subject updated');
      } else {
        await api.createSubject(input);
        setToast('Subject created');
      }
      setModal(null);
      load();
    } catch (err) {
      setToast((err as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Deactivate this subject?')) return;
    try {
      await api.deleteSubject(id);
      setToast('Subject deactivated');
      load();
    } catch (err) {
      setToast((err as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>📚 Subjects</h2>
          <p className="text-dim" style={{ fontSize: 13, marginTop: 4 }}>Manage subjects and assign to teachers</p>
        </div>
        <div className="page-head-actions">
          <input
            className="search-input"
            placeholder="Search subjects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All Levels</option>
            {GRADE_LEVELS.map((gl) => <option key={gl} value={gl}>{gl}</option>)}
          </select>
          <button className="btn-primary" onClick={() => setModal('add')}>+ Add Subject</button>
        </div>
      </div>

      {grouped.length === 0 && <div className="empty-state">📚 No subjects found</div>}

      {grouped.map((group) => (
        <div key={group.level} className="subject-group">
          <h3 className="subject-group-title">{group.level} <span className="text-dim" style={{ fontSize: 13 }}>({group.items.length})</span></h3>
          <div className="subject-grid">
            {group.items.map((s) => (
              <div key={s.id} className="subject-card">
                <div className="subject-card-head">
                  <span className="subject-code">{s.subject_code}</span>
                  <div className="subject-card-actions">
                    <button className="btn-icon" title="Edit" onClick={() => setModal({ type: 'edit', subject: s })}>✏️</button>
                    <button className="btn-icon danger" title="Deactivate" onClick={() => handleDelete(s.id)}>🗑️</button>
                  </div>
                </div>
                <div className="subject-name">{s.subject_name}</div>
                {s.description && <div className="subject-desc text-dim">{s.description}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {modal && (
        <Modal
          title={modal === 'add' ? 'Add Subject' : 'Edit Subject'}
          onClose={() => setModal(null)}
          wide
        >
          <SubjectForm
            initial={modal === 'add' ? EMPTY_FORM : { subject_code: modal.subject.subject_code, subject_name: modal.subject.subject_name, grade_level: modal.subject.grade_level, description: modal.subject.description }}
            onSave={handleSave}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}

function SubjectForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: SubjectInputInfo;
  onSave: (input: SubjectInputInfo) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SubjectInputInfo>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof SubjectInputInfo, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.subject_code.trim()) { setError('Subject code is required'); return; }
    if (!form.subject_name.trim()) { setError('Subject name is required'); return; }
    onSave(form);
  };

  return (
    <div className="form-stack">
      {error && <div className="form-error">{error}</div>}
      <div className="form-row">
        <div className="field">
          <label>Code *</label>
          <input className="input" value={form.subject_code} onChange={(e) => set('subject_code', e.target.value)} placeholder="e.g. MATH" />
        </div>
        <div className="field">
          <label>Name *</label>
          <input className="input" value={form.subject_name} onChange={(e) => set('subject_name', e.target.value)} placeholder="e.g. Mathematics" />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Grade Level</label>
          <select className="input" value={form.grade_level ?? ''} onChange={(e) => set('grade_level', e.target.value)}>
            <option value="">All Levels</option>
            {GRADE_LEVELS.map((gl) => <option key={gl} value={gl}>{gl}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Description</label>
          <input className="input" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Optional description" />
        </div>
      </div>
      <div className="form-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={handleSubmit}>Save</button>
      </div>
    </div>
  );
}
