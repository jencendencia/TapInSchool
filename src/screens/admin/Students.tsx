// Students management: CRUD, QR payload generator, CSV import, demo seed.
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { ImportResult, Student, StudentInput } from '../../../shared/types';
import { api } from '../../lib/api';
import { Avatar, Modal, QrCodeImage, Spinner, Toast } from '../../components/shared';

type ModalState =
  | { type: 'add' }
  | { type: 'edit'; student: Student }
  | { type: 'qr'; student: Student }
  | { type: 'import' }
  | null;

const EMPTY_FORM: StudentInput = {
  student_no: '',
  full_name: '',
  grade_section: '',
  parent_phone: '',
  photo_url: null,
  is_active: true,
};

// Reads an image file, downscales it to a small square-ish thumbnail and
// returns it as a JPEG data URI — no URL or external storage needed. The data
// URI is stored in students.photo_url (MEDIUMTEXT) and works in Electron and
// browser mock mode alike.
function fileToResizedDataUrl(file: File, maxSize = 320, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image'));
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas not supported in this environment'));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          reject(new Error('Could not process the image'));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function StudentForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: StudentInput;
  onSave: (input: StudentInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<StudentInput>(initial);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof StudentInput, v: string | boolean | null) => setForm((f) => ({ ...f, [k]: v }));

  const pickPhoto = async (file?: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setForm((f) => ({ ...f, photo_url: dataUrl }));
      setPhotoError(null);
    } catch (err) {
      setPhotoError((err as Error).message);
    }
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
    >
      <div className="field">
        <label>Student No.</label>
        <input required value={form.student_no} onChange={(e) => set('student_no', e.target.value)} placeholder="2024-0112" />
      </div>
      <div className="field">
        <label>Full Name</label>
        <input required value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="Juan Dela Cruz" />
      </div>
      <div className="field">
        <label>Grade & Section</label>
        <input value={form.grade_section} onChange={(e) => set('grade_section', e.target.value)} placeholder="Grade 7 - Section A" />
      </div>
      <div className="field">
        <label>Parent Mobile (SMS)</label>
        <input value={form.parent_phone} onChange={(e) => set('parent_phone', e.target.value)} placeholder="09171234567" />
      </div>
      <div className="field">
        <label>Photo</label>
        <div className="photo-upload">
          <div className="photo-preview">
            <Avatar name={form.full_name || 'Student'} photoUrl={form.photo_url} size={76} />
          </div>
          <div className="photo-actions">
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div className="photo-btn-row">
              <button type="button" className="btn-ghost" onClick={() => photoRef.current?.click()}>
                📷 Upload photo
              </button>
              {form.photo_url && (
                <button type="button" className="btn-ghost" onClick={() => setForm((f) => ({ ...f, photo_url: null }))}>
                  ✕ Remove
                </button>
              )}
            </div>
            {photoError ? (
              <p className="field-hint sms-error">{photoError}</p>
            ) : (
              <p className="field-hint">Pick a JPEG/PNG from your computer — no link needed. It is resized automatically.</p>
            )}
          </div>
        </div>
      </div>
      <label className="switch-row">
        <span>Active (allowed through the gate)</span>
        <span className={`switch ${form.is_active ? 'on' : ''}`} onClick={() => set('is_active', !form.is_active)}>
          <span className="switch-knob" />
        </span>
      </label>
      <div className="form-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">Save Student</button>
      </div>
    </form>
  );
}

function QrModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const payload = student.qr_hash_payload;
  const print = async () => {
    const url = await QRCode.toDataURL(payload, { width: 480, margin: 2 });
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>QR — ${student.full_name}</title>
      <style>body{font-family:sans-serif;text-align:center;padding:24px}
      img{width:300px;border:1px solid #ccc;border-radius:8px;padding:12px}
      h2{margin:8px 0 2px}p{margin:2px 0;color:#555}
      code{font-size:12px;color:#888;word-break:break-all}</style></head><body>
      <h2>${student.full_name}</h2>
      <p>${student.grade_section} · Student No. ${student.student_no}</p>
      <img src="${url}" alt="QR" />
      <p><code>${payload}</code></p>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  return (
    <Modal title="Student QR Code" onClose={onClose}>
      <div className="qr-modal">
        <QrCodeImage text={payload} size={220} />
        <h3>{student.full_name}</h3>
        <p className="text-dim">{student.grade_section} · {student.student_no}</p>
        <code className="qr-payload">{payload}</code>
        <p className="qr-note text-dim">Scan this with the gate scanner to test. Payload matches students.qr_hash_payload.</p>
        <div className="form-actions">
          <button className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(payload)}>Copy</button>
          <button className="btn-primary" onClick={() => void print()}>🖨 Print</button>
        </div>
      </div>
    </Modal>
  );
}

export function StudentsPage() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback((q = '') => {
    void api.listStudents(q || undefined).then(setStudents);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (search) {
      const t = setTimeout(() => load(search), 250);
      return () => clearTimeout(t);
    }
    load();
    return undefined;
  }, [search, load]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const saveStudent = async (input: StudentInput) => {
    try {
      if (modal?.type === 'edit') {
        await api.updateStudent(modal.student.id, input);
        notify('Student updated');
      } else {
        const created = await api.createStudent(input);
        notify(`Student added — QR payload ${created.qr_hash_payload}`);
      }
      setModal(null);
      load(search);
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const removeStudent = async (s: Student) => {
    if (!window.confirm(`Delete ${s.full_name}? Attendance history is kept but the student can no longer scan.`)) return;
    await api.deleteStudent(s.id);
    notify('Student deleted');
    load(search);
  };

  const handleCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const res: ImportResult = await api.importStudentsCsv(String(reader.result ?? ''));
      notify(`Import: ${res.added} added, ${res.skipped} skipped${res.errors.length ? `, ${res.errors.length} errors` : ''}`);
      setModal(null);
      load();
    };
    reader.readAsText(file);
  };

  const seed = async () => {
    const res = await api.seedDemoData();
    notify(`Demo data: ${res.added} added${res.skipped ? `, ${res.skipped} already present` : ''}`);
    load();
  };

  if (!students) return <Spinner label="Loading students…" />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Students</h2>
          <p className="text-dim">{students.length} enrolled</p>
        </div>
        <div className="page-actions">
          <button className="btn-ghost" onClick={() => setModal({ type: 'import' })}>⬆ CSV Import</button>
          <button className="btn-ghost" onClick={seed}>🎲 Demo data</button>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>+ Add Student</button>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search name, student no, section…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Student No.</th>
              <th>Grade / Section</th>
              <th>Parent Mobile</th>
              <th>QR Payload</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="cell-student">
                    <Avatar name={s.full_name} photoUrl={s.photo_url} size={34} />
                    <span>{s.full_name}</span>
                  </div>
                </td>
                <td className="mono">{s.student_no}</td>
                <td>{s.grade_section || '—'}</td>
                <td>{s.parent_phone || '—'}</td>
                <td>
                  <code className="qr-payload sm">{s.qr_hash_payload}</code>
                </td>
                <td>
                  <span className={`pill ${s.is_active ? 'pill-success' : 'pill-danger'}`}>
                    {s.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn-icon" title="QR code" onClick={() => setModal({ type: 'qr', student: s })}>▦</button>
                    <button className="btn-icon" title="Edit" onClick={() => setModal({ type: 'edit', student: s })}>✎</button>
                    <button className="btn-icon danger" title="Delete" onClick={() => void removeStudent(s)}>🗑</button>
                  </div>
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-cell">
                  No students yet. Add one manually or use CSV import / demo data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal?.type === 'add' && (
        <Modal title="Add Student" closeOnOverlay={false} onClose={() => setModal(null)}>
          <StudentForm initial={EMPTY_FORM} onSave={(i) => void saveStudent(i)} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal title={`Edit — ${modal.student.full_name}`} closeOnOverlay={false} onClose={() => setModal(null)}>
          <StudentForm
            initial={{
              student_no: modal.student.student_no,
              full_name: modal.student.full_name,
              grade_section: modal.student.grade_section,
              parent_phone: modal.student.parent_phone,
              photo_url: modal.student.photo_url,
              is_active: modal.student.is_active,
            }}
            onSave={(i) => void saveStudent(i)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.type === 'qr' && <QrModal student={modal.student} onClose={() => setModal(null)} />}
      {modal?.type === 'import' && (
        <Modal title="Import Students from CSV" closeOnOverlay={false} onClose={() => setModal(null)}>
          <p className="text-dim">
            Columns: <code>student_no,full_name,grade_section,parent_phone</code> (header row optional). QR payloads are generated automatically.
          </p>
          <div className="form">
            <div className="field">
              <label>CSV file</label>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCsvFile(f);
              }} />
            </div>
            <div className="field">
              <label>…or paste CSV text</label>
              <textarea
                rows={6}
                placeholder={'2025-0101,Juan Dela Cruz,Grade 7 - Section A,09171234567\n2025-0102,Maria Santos,Grade 7 - Section A,09182345678'}
                onBlur={(e) => {
                  if (e.target.value.trim()) {
                    void api.importStudentsCsv(e.target.value).then((res) => {
                      notify(`Import: ${res.added} added, ${res.skipped} skipped`);
                      setModal(null);
                      load();
                    });
                  }
                }}
              />
            </div>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} />}
    </div>
  );
}
