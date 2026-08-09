// Students management: CRUD, QR payload generator, CSV import, demo seed.
// The Grade & Section picker is a cascading Grade → Section dropdown fed by the
// section registry, and enrollment targets the GLOBALLY selected school year
// (title bar) — the table shows each student's section for that year.
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { BADGE_INFO, EXCUSE_CATEGORIES } from '../../../shared/types';
import type {
  Badge,
  BadgeCode,
  BadgeLeaderboardRow,
  Excuse,
  ExcuseCategory,
  ImportResult,
  Section,
  Student,
  StudentInput,
} from '../../../shared/types';
import { api } from '../../lib/api';
import { sortGrades } from '../../lib/sort';
import { Avatar, Modal, QrCodeImage, Spinner, Toast } from '../../components/shared';
import { useSchoolYear } from './schoolYear';

type ModalState =
  | { type: 'add'; nextNo: string }
  | { type: 'edit'; student: Student }
  | { type: 'qr'; student: Student }
  | { type: 'import' }
  | null;

const EMPTY_FORM: StudentInput = {
  student_no: '',
  full_name: '',
  gender: '',
  grade_section: '',
  parent_phone: '',
  lrn: '',
  guardian_name: '',
  guardian_address: '',
  photo_url: null,
  is_active: true,
};

/** Splits a composite "Grade 7 - Section A" into grade + section parts. */
function splitParts(name: string): { grade: string; section: string } {
  const i = name.lastIndexOf(' - ');
  if (i > 0) return { grade: name.slice(0, i).trim(), section: name.slice(i + 3).trim() };
  return { grade: name.trim(), section: '' };
}

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
  sections,
  onSave,
  onCancel,
  autoStudentNo,
}: {
  initial: StudentInput;
  /** Registered sections (Sections tab) — the only sections that can be chosen. */
  sections: Section[];
  onSave: (input: StudentInput) => void;
  onCancel: () => void;
  /** When true, the Student No. field is auto-generated (read-only). */
  autoStudentNo?: boolean;
}) {
  const [form, setForm] = useState<StudentInput>(initial);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof StudentInput, v: string | boolean | null) => setForm((f) => ({ ...f, [k]: v }));

  const grades = sortGrades([...new Set(sections.map((s) => s.grade).filter(Boolean))]);
  // A student's existing section that was never registered stays selectable so
  // their record is preserved (register it in the Sections tab to move on).
  const unregistered =
    initial.grade_section && !sections.some((s) => s.grade_section === initial.grade_section)
      ? initial.grade_section
      : null;
  const unregParts = unregistered ? splitParts(unregistered) : { grade: '', section: '' };

  const [grade, setGrade] = useState(() => {
    const known = sections.find((s) => s.grade_section === initial.grade_section);
    return known ? known.grade : unregParts.grade;
  });
  // Holds the selected COMPOSITE name ("Grade 7 - Section A").
  const [selectedSection, setSelectedSection] = useState(initial.grade_section);

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

  const submit = () => {
    if (!selectedSection) {
      setError('Select a grade and section (or add the section in the Sections tab first).');
      return;
    }
    onSave({ ...form, grade_section: selectedSection });
  };

  const gradeSections = sections.filter((s) => s.grade === grade);

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
<div className="field">
        <label>Student No.</label>
        <input
          required
          value={form.student_no}
          onChange={(e) => set('student_no', e.target.value)}
          placeholder="2024-0112"
          readOnly={autoStudentNo}
          title={autoStudentNo ? 'Auto-generated — assigned automatically' : undefined}
        />
        {autoStudentNo && <p className="field-hint">Auto-generated — assigned automatically.</p>}
      </div>
      <div className="field">
        <label>Full Name</label>
        <input required value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="Juan Dela Cruz" />
      </div>
      <div className="field">
        <label>Gender</label>
        <select value={form.gender ?? ''} onChange={(e) => set('gender', e.target.value)}>
          <option value="">— Select gender (optional) —</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Grade</label>
          <select
            value={grade}
            onChange={(e) => {
              setGrade(e.target.value);
              setSelectedSection('');
              setError(null);
            }}
          >
            <option value="">— Select grade —</option>
            {grades.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
            {unregistered && unregParts.grade && !grades.includes(unregParts.grade) && (
              <option value={unregParts.grade}>{unregParts.grade} (unregistered)</option>
            )}
          </select>
        </div>
        <div className="field">
          <label>Section</label>
          <select
            value={selectedSection}
            disabled={!grade}
            onChange={(e) => {
              setSelectedSection(e.target.value);
              setError(null);
            }}
          >
            <option value="">— Select section —</option>
            {gradeSections.map((s) => (
              <option key={s.grade_section} value={s.grade_section}>{s.section}</option>
            ))}
            {unregistered && unregParts.grade === grade && (
              <option value={unregistered}>{unregParts.section || unregistered} (unregistered)</option>
            )}
          </select>
        </div>
      </div>
      {error && <p className="field-hint sms-error">{error}</p>}
      <p className="field-hint">
        Sections are managed in the Sections tab — add a new one there if it's missing.
      </p>
      <div className="field">
        <label>Parent Mobile (SMS)</label>
        <input value={form.parent_phone} onChange={(e) => set('parent_phone', e.target.value)} placeholder="09171234567" />
      </div>
      <div className="field">
        <label>LRN (Learner Reference Number)</label>
        <input
          value={form.lrn}
          onChange={(e) => set('lrn', e.target.value.replace(/\D/g, '').slice(0, 12))}
          inputMode="numeric"
          placeholder="136542110123 — optional"
        />
      </div>
      <div className="field">
        <label>Guardian's Name</label>
        <input value={form.guardian_name} onChange={(e) => set('guardian_name', e.target.value)} placeholder="e.g. Maria Dela Cruz" />
        <p className="field-hint">When set, the guardian gets their own QR — scanning it at the kiosk shows the child's attendance report for today.</p>
      </div>
      <div className="field">
        <label>Guardian's Address</label>
        <input value={form.guardian_address} onChange={(e) => set('guardian_address', e.target.value)} placeholder="e.g. 123 Mabini St., Manila" />
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

function QrModal({ student, section, onClose }: { student: Student; section: string; onClose: () => void }) {
  const [tab, setTab] = useState<'student' | 'guardian'>('student');
  const guardianPayload = student.guardian_qr_hash_payload;
  const payload = tab === 'student' ? student.qr_hash_payload : guardianPayload;
  const print = async () => {
    const url = await QRCode.toDataURL(payload!, { width: 480, margin: 2 });
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    const isGuardian = tab === 'guardian';
    w.document.write(`<!doctype html><html><head><title>${isGuardian ? 'Guardian' : 'Student'} QR — ${student.full_name}</title>
      <style>body{font-family:sans-serif;text-align:center;padding:24px}
      img{width:300px;border:1px solid #ccc;border-radius:8px;padding:12px}
      h2{margin:8px 0 2px}p{margin:2px 0;color:#555}
      code{font-size:12px;color:#888;word-break:break-all}</style></head><body>
      <h2>${isGuardian ? student.guardian_name || 'Guardian' : student.full_name}</h2>
      <p>${isGuardian ? `${student.guardian_name} · Guardian of ${student.full_name}` : `${section} · Student No. ${student.student_no}`}</p>
      ${isGuardian && student.guardian_address ? `<p>${student.guardian_address}</p>` : ''}
      <img src="${url}" alt="QR" />
      <p><code>${payload}</code></p>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };
  return (
    <Modal title={tab === 'student' ? 'Student QR Code' : 'Guardian QR Code'} onClose={onClose}>
      <div className="qr-tabs">
        <button className={`qr-tab ${tab === 'student' ? 'active' : ''}`} onClick={() => setTab('student')}>Student QR</button>
        <button
          className={`qr-tab ${tab === 'guardian' ? 'active' : ''}`}
          disabled={!guardianPayload}
          title={guardianPayload ? undefined : 'Add a Guardian’s Name to the student to generate this QR'}
          onClick={() => setTab('guardian')}
        >
          Guardian QR
        </button>
      </div>
      <div className="qr-modal">
        {payload ? (
          <>
            <QrCodeImage text={payload} size={220} />
            <h3>{tab === 'student' ? student.full_name : student.guardian_name || 'Guardian'}</h3>
            <p className="text-dim">
              {tab === 'student'
                ? `${section} · ${student.student_no}`
                : `Guardian of ${student.full_name}${student.guardian_address ? ` · ${student.guardian_address}` : ''}`}
            </p>
            <code className="qr-payload">{payload}</code>
            <p className="qr-note text-dim">
              {tab === 'student'
                ? 'Scan this with the gate scanner to record attendance.'
                : 'Scanning this at the kiosk shows today\u2019s attendance for this child — no check-in is recorded. Other children sharing the same Guardian\u2019s Name and Address share this one QR.'}
            </p>
            <div className="form-actions">
              <button className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(payload)}>Copy</button>
              <button className="btn-primary" onClick={() => void print()}>🖨 Print</button>
            </div>
          </>
        ) : (
          <p className="qr-note text-dim" style={{ padding: '18px 0' }}>
            No guardian QR yet. Edit the student and add a Guardian\u2019s Name — the guardian QR is generated automatically.
          </p>
        )}
      </div>
    </Modal>
  );
}

const EXCUSE_PILL: Record<ExcuseCategory, string> = {
  SICK: 'pill-warn',
  RELIGIOUS: 'pill-info',
  SCHOOL_ACTIVITY: 'pill-success',
  OTHER: 'pill-dim',
};

/** Excused-days manager (weekly badges are lenient: excused days never break a
 *  badge). Shown inside the Edit modal; adding/removing self-heals badges. */
function ExcusePanel({ studentId }: { studentId: number }) {
  const [list, setList] = useState<Excuse[] | null>(null);
  const [date, setDate] = useState('');
  const [cat, setCat] = useState<ExcuseCategory>('SICK');
  const [note, setNote] = useState('');
  const load = useCallback(() => {
    void api.listExcuses(studentId).then(setList).catch(() => setList([]));
  }, [studentId]);
  useEffect(load, [load]);
  const add = async () => {
    if (!date) return;
    try {
      await api.addExcuse(studentId, date, cat, note || undefined);
      setDate('');
      setNote('');
      load();
    } catch (err) {
      window.alert(`Could not add excuse: ${(err as Error).message}`);
    }
  };
  const remove = async (id: number) => {
    await api.removeExcuse(id);
    load();
  };
  return (
    <div className="excuse-panel">
      <h4>
        Excused days <span className="text-dim">(sick, religious, school activities — never break a badge)</span>
      </h4>
      <div className="excuse-add">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Excuse date" />
        <select value={cat} onChange={(e) => setCat(e.target.value as ExcuseCategory)} aria-label="Excuse category">
          {EXCUSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace('_', ' ')}
            </option>
          ))}
        </select>
        <input
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Excuse note"
        />
        <button className="btn-primary" onClick={() => void add()} disabled={!date}>
          Add excuse
        </button>
      </div>
      <ul className="excuse-list">
        {(list ?? []).map((e) => (
          <li key={e.id}>
            <span className="mono">{e.excuseDate}</span>
            <span className={`pill ${EXCUSE_PILL[e.category]}`}>{e.category.replace('_', ' ')}</span>
            {e.note && <span className="text-dim excuse-note">{e.note}</span>}
            <button className="btn-icon danger" title="Remove excuse" onClick={() => void remove(e.id)}>
              ✕
            </button>
          </li>
        ))}
        {list && list.length === 0 && <li className="text-dim">No excused days recorded.</li>}
      </ul>
    </div>
  );
}

export function StudentsPage() {
  const { year, currentYear } = useSchoolYear();
  const [students, setStudents] = useState<Student[] | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [yearEnroll, setYearEnroll] = useState<Map<number, string>>(new Map());
  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState<'' | 'male' | 'female'>('');
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [badgesByStudent, setBadgesByStudent] = useState<Map<number, Badge[]>>(new Map());
  const [leaderboard, setLeaderboard] = useState<BadgeLeaderboardRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback((q = '') => {
    void api.listStudents(q || undefined).then(setStudents);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Registered sections drive the cascading Grade → Section picker.
  useEffect(() => {
    void api.listSections().then(setSections);
  }, []);

  // Badges + leaderboard (weekly recognition) — refresh whenever the roster
  // changes so new/deleted students stay in sync.
  useEffect(() => {
    void api
      .listBadges()
      .then((list) => {
        const map = new Map<number, Badge[]>();
        for (const b of list) {
          const arr = map.get(b.studentId) ?? [];
          arr.push(b);
          map.set(b.studentId, arr);
        }
        setBadgesByStudent(map);
      })
      .catch(() => undefined);
    void api.badgeLeaderboard(5).then(setLeaderboard).catch(() => undefined);
  }, [students]);

  // The SELECTED school year's enrollments drive what the table + edit form
  // show (a student can be in different sections in different years).
  useEffect(() => {
    if (!year) return;
    let stale = false;
    void api.listEnrollments(year).then((rows) => {
      if (!stale) setYearEnroll(new Map(rows.map((r) => [r.studentId, r.gradeSection])));
    });
    return () => {
      stale = true;
    };
  }, [year, students]);

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

  // Opens the Add modal with the next auto-generated student number for the
  // current calendar year (e.g. "2025-0001"). The number is computed from the
  // full (unfiltered) roster so a search filter can't cause collisions.
  const openAdd = async () => {
    const all = await api.listStudents();
    const year = new Date().getFullYear();
    const prefix = `${year}-`;
    const seqs = all
      .map((s) => s.student_no)
      .filter((n) => n.startsWith(prefix))
      .map((n) => parseInt(n.slice(prefix.length), 10))
      .filter((n) => Number.isInteger(n));
    const max = seqs.length ? Math.max(...seqs) : 0;
    setModal({ type: 'add', nextNo: `${prefix}${String(max + 1).padStart(4, '0')}` });
  };

  // The section a student belongs to in the SELECTED school year.
  const sectionOf = (s: Student) => yearEnroll.get(s.id) ?? s.grade_section;

  const saveStudent = async (input: StudentInput) => {
    try {
      // Enrollment is recorded in the globally selected school year.
      const payload = { ...input, school_year: year || undefined };
      if (modal?.type === 'edit') {
        await api.updateStudent(modal.student.id, payload);
        notify('Student updated');
      } else {
        const created = await api.createStudent(payload);
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

  // Gender is filtered client-side on top of the (server-side) name/no/section
  // search, so both filters compose without extra round-trips.
  const visible = genderFilter ? students.filter((s) => s.gender === genderFilter) : students;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Students</h2>
          <p className="text-dim">
            {genderFilter ? `${visible.length} of ${students.length}` : students.length} enrolled · SY {year}
            {year !== currentYear && currentYear ? ` (current: ${currentYear})` : ''}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn-ghost" onClick={() => setModal({ type: 'import' })}>⬆ CSV Import</button>
          <button className="btn-ghost" onClick={seed}>🎲 Demo data</button>
<button className="btn-primary" onClick={() => void openAdd()}>+ Add Student</button>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search name, student no, section…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={genderFilter}
          onChange={(e) => setGenderFilter(e.target.value as '' | 'male' | 'female')}
          aria-label="Filter by gender"
        >
          <option value="">All genders</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>

      {leaderboard.length > 0 && (
        <div className="stars-card">
          <div className="stars-head">
            <h3>🏆 Attendance Stars</h3>
            <span className="text-dim">Top {leaderboard.length} by badge score this school year</span>
          </div>
          <div className="stars-row">
            {leaderboard.map((r, i) => (
              <div key={r.studentId} className="star-cell">
                <span className="star-rank">{['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`}</span>
                <div className="star-body">
                  <span className="star-name">{r.fullName}</span>
                  <span className="text-dim">{r.gradeSection || '—'}</span>
                </div>
                <span className="star-count">⭐ {r.score} pts · 🎖 {r.attendanceBadges} · ⏱ {r.punctualityBadges}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="table students-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Student No.</th>
              <th>Gender</th>
              <th>Grade / Section</th>
              <th>Parent Mobile</th>
              <th>Guardian</th>
              <th>Badges</th>
              <th>QR Payload</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const sec = sectionOf(s);
              return (
                <tr key={s.id}>
                  <td>
                    <div className="cell-student">
                      <Avatar name={s.full_name} photoUrl={s.photo_url} size={34} />
                      <span>{s.full_name}</span>
                    </div>
                  </td>
                  <td className="mono">{s.student_no}</td>
                  <td>{s.gender ? <span className="pill pill-dim">{s.gender === 'male' ? 'Male' : 'Female'}</span> : '—'}</td>
                  <td>
                    {sec || '—'}
                    {sec !== s.grade_section && s.grade_section ? (
                      <span className="text-dim" style={{ fontWeight: 400, fontSize: 12 }} title="This year's live section">
                        {' '}· now: {s.grade_section}
                      </span>
                    ) : null}
                  </td>
                  <td>{s.parent_phone || '—'}</td>
                  <td>
                    {s.guardian_name ? (
                      <span title={s.guardian_address || undefined}>
                        {s.guardian_name}
                        {s.guardian_qr_hash_payload ? <span className="guardian-qr-dot" title="Guardian QR available" /> : null}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {(() => {
                      const list = badgesByStudent.get(s.id);
                      if (!list?.length) return <span className="text-dim">—</span>;
                      const att = list.filter((b) => b.badgeCode.startsWith('ATT'));
                      const punct = list.filter((b) => b.badgeCode.startsWith('PUNCT'));
                      const detail = list
                        .map((b) => {
                          const info = BADGE_INFO[b.badgeCode];
                          return `${info.tierIcon} ${info.label} · ${info.metal} (${info.windowLabel}) — ${b.periodStart}`;
                        })
                        .join('\n');
                      const bestTierIcon = (badges: Badge[]): string => {
                        let best: BadgeCode | null = null;
                        for (const b of badges) {
                          if (!best || BADGE_INFO[b.badgeCode].tier > BADGE_INFO[best].tier) best = b.badgeCode;
                        }
                        return best ? BADGE_INFO[best].tierIcon : '';
                      };
                      return (
                        <span className="badge-cell" title={detail}>
                          {att.length > 0 && (
                            <span className="badge-chip badge-att">
                              {BADGE_INFO.ATT_W.icon} {att.length}
                              <span className="badge-metal">{bestTierIcon(att)}</span>
                            </span>
                          )}
                          {punct.length > 0 && (
                            <span className="badge-chip badge-punct">
                              {BADGE_INFO.PUNCT_W.icon} {punct.length}
                              <span className="badge-metal">{bestTierIcon(punct)}</span>
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </td>
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
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-cell">
                  {students.length === 0
                    ? 'No students yet. Add one manually or use CSV import / demo data.'
                    : 'No students match the current gender filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

{modal?.type === 'add' && (
        <Modal title="Add Student" closeOnOverlay={false} onClose={() => setModal(null)}>
          <StudentForm
            initial={{ ...EMPTY_FORM, student_no: modal.nextNo }}
            sections={sections}
            onSave={(i) => void saveStudent(i)}
            onCancel={() => setModal(null)}
            autoStudentNo
          />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal title={`Edit — ${modal.student.full_name}`} closeOnOverlay={false} onClose={() => setModal(null)}>
          <StudentForm
            initial={{
              student_no: modal.student.student_no,
              full_name: modal.student.full_name,
              gender: modal.student.gender,
              grade_section: sectionOf(modal.student),
              parent_phone: modal.student.parent_phone,
              lrn: modal.student.lrn,
              guardian_name: modal.student.guardian_name,
              guardian_address: modal.student.guardian_address,
              photo_url: modal.student.photo_url,
              is_active: modal.student.is_active,
            }}
            sections={sections}
            onSave={(i) => void saveStudent(i)}
            onCancel={() => setModal(null)}
          />
          <ExcusePanel studentId={modal.student.id} />
        </Modal>
      )}
      {modal?.type === 'qr' && <QrModal student={modal.student} section={sectionOf(modal.student) || '—'} onClose={() => setModal(null)} />}
      {modal?.type === 'import' && (
        <Modal title="Import Students from CSV" closeOnOverlay={false} onClose={() => setModal(null)}>
          <p className="text-dim">
            Columns: <code>student_no,full_name,grade_section,parent_phone,lrn,guardian_name,guardian_address,gender</code> (header row optional; everything after <code>student_no,full_name</code> is optional). Gender accepts Male/Female (or M/F). QR payloads are generated automatically — a guardian QR is issued when a guardian name is present. Imported students are enrolled in the current school year.
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
                placeholder={'2025-0101,Juan Dela Cruz,Grade 7 - Section A,09171234567,136542110123,Maria Dela Cruz,123 Mabini St.\n2025-0102,Maria Santos,Grade 7 - Section A,09182345678'}
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
