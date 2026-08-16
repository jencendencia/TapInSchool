// Sections: the section roster, scoped per the GLOBALLY selected school year
// (title bar). Sections are registered as grade + section ("Grade 7" /
// "Section A"); the composite name "Grade 7 - Section A" is what enrollments
// and students join on. Each registered section can carry an optional adviser
// name + email that receives the section's attendance report via Reports →
// "Send to advisers". Clicking a section drills into that year's roster, where
// students can be enrolled in bulk (from the year's unassigned pool) or
// unassigned.
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { Section, SectionInput, Student, TeacherOption } from '../../../shared/types';
import { api } from '../../lib/api';
import { compareGrades, sortGrades } from '../../lib/sort';
import { Avatar, Modal, QrCodeImage, Spinner, Toast } from '../../components/shared';
import { useSchoolYear } from './schoolYear';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Searchable teacher-account dropdown for the section's adviser. Teacher
 *  accounts (role 'teacher' in users) are created in the TapIn Teacher
 *  Companion app; picking one fills the section's adviser name (their
 *  username) + email (from their account). Sections that predate teacher
 *  accounts keep their free-text adviser name until the admin reassigns —
 *  shown as a legacy card with a "⇄" button to replace it. */
function AdviserPicker({
  teachers,
  adviserName,
  email,
  onChange,
}: {
  teachers: TeacherOption[];
  adviserName: string;
  email: string;
  onChange: (name: string, email: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = teachers.find((t) => t.username === adviserName.trim()) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = teachers.filter(
    (t) => !q || t.username.toLowerCase().includes(q) || t.email.toLowerCase().includes(q),
  );
  const pick = (t: TeacherOption) => {
    onChange(t.username, t.email);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="guardian-picker" ref={wrapRef}>
      {selected ? (
        <div className="guardian-selected">
          <div className="guardian-selected-main">
            <span className="guardian-selected-name">{selected.username}</span>
            <span className="text-dim guardian-selected-meta">
              {selected.email || 'No email on account'}
            </span>
          </div>
          <button type="button" className="btn-icon" title="Remove adviser" onClick={() => onChange('', '')}>
            ✕
          </button>
        </div>
      ) : adviserName.trim() ? (
        <div className="guardian-selected">
          <div className="guardian-selected-main">
            <span className="guardian-selected-name">{adviserName}</span>
            <span className="text-dim guardian-selected-meta">
              {email || 'no email'} · no matching teacher account
            </span>
          </div>
          <button
            type="button"
            className="btn-icon"
            title="Pick a teacher account instead"
            onClick={() => {
              setQuery('');
              setOpen(true);
            }}
          >
            ⇄
          </button>
          <button type="button" className="btn-icon" title="Clear adviser" onClick={() => onChange('', '')}>
            ✕
          </button>
        </div>
      ) : (
        <input
          className="guardian-picker-input"
          placeholder="Search teacher account…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      )}
      {!selected && open && (
        <div className="guardian-options">
          {filtered.map((t) => (
            <button type="button" key={t.id} className="guardian-option" onClick={() => pick(t)}>
              <span className="guardian-option-name">{t.username}</span>
              <span className="text-dim guardian-option-meta">{t.email || 'no email set'}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="guardian-option guardian-option-empty text-dim">
              No teacher account matches “{query}”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** HTML-escapes text inserted into the print window's document. */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type ModalState = { type: 'add' } | { type: 'edit'; section: Section } | null;

const EMPTY_FORM: SectionInput = { grade_section: '', grade: '', section: '', adviser_name: '', email: '' };

/** Builds the composite name ("Grade 7 - Section A") from separated parts. */
function composeSection(grade: string, section: string): string {
  return `${grade.trim()} - ${section.trim()}`;
}

function SectionForm({
  initial,
  sections,
  teachers,
  lockSection,
  onSave,
  onCancel,
}: {
  initial: SectionInput;
  sections: Section[];
  /** Teacher accounts for the adviser search dropdown. */
  teachers: TeacherOption[];
  /** When editing, the grade/section are fixed so the registry key can't change. */
  lockSection?: boolean;
  onSave: (input: SectionInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SectionInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const knownGrades = sortGrades([...new Set(sections.map((s) => s.grade).filter(Boolean))]);

  const submit = () => {
    const grade = form.grade.trim();
    const section = form.section.trim();
    const adviserName = form.adviser_name.trim();
    const email = form.email.trim();
    if (email && !EMAIL_RE.test(email)) {
      setError('Enter a valid email address (or leave it blank).');
      return;
    }
    if (lockSection) {
      // The composite is the registry key — editing only updates adviser/email.
      onSave({ ...initial, grade_section: initial.grade_section, adviser_name: adviserName, email });
      return;
    }
    if (!grade || !section) {
      setError('Enter both a grade and a section.');
      return;
    }
    onSave({ grade_section: composeSection(grade, section), grade, section, adviser_name: adviserName, email });
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="field-row">
        <div className="field">
          <label>Grade</label>
          <input
            required
            value={form.grade}
            onChange={(e) => setForm({ ...form, grade: e.target.value })}
            placeholder="Grade 7"
            list={lockSection ? undefined : 'grades-datalist'}
            readOnly={lockSection}
          />
          <datalist id="grades-datalist">
            {knownGrades.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label>Section</label>
          <input
            required
            value={form.section}
            onChange={(e) => setForm({ ...form, section: e.target.value })}
            placeholder="Section A"
            readOnly={lockSection}
          />
        </div>
      </div>
      {!lockSection && (
        <p className="field-hint" style={{ marginTop: -6 }}>
          The section is shown as “{composeSection(form.grade || 'Grade 7', form.section || 'Section A')}” in the Students page picker.
        </p>
      )}
      <div className="field">
        <label>Adviser (optional)</label>
        <AdviserPicker
          teachers={teachers}
          adviserName={form.adviser_name}
          email={form.email}
          onChange={(name, email) => setForm({ ...form, adviser_name: name, email })}
        />
        <p className="field-hint">
          Pick a teacher account — their email fills in automatically. Teacher accounts are created in
          the <b>TapIn Teacher Companion</b> app.
        </p>
      </div>
      <div className="field">
        <label>Adviser email (optional)</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="maria.reyes@school.edu.ph"
        />
        <p className="field-hint">
          Auto-filled from the adviser's account when you pick one; edit if needed. Receives this
          section's attendance report (PDF) when you send reports to advisers. Sections without an
          email are skipped by "Send to advisers".
        </p>
      </div>
      {error && <p className="field-hint sms-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">{lockSection ? 'Save Section' : 'Add Section'}</button>
      </div>
    </form>
  );
}

/** Print-QRs modal: every student enrolled in the section (selected school
 *  year) shown as a QR card with a checkbox; "Print" opens a print window
 *  with only the checked cards, laid out for cutting into ID-sized tags. */
function PrintQrsModal({
  sectionName,
  schoolYear,
  students,
  onClose,
}: {
  sectionName: string;
  schoolYear: string;
  students: Student[];
  onClose: () => void;
}) {
  // Everyone starts checked — the common case is "print the whole section".
  // Only payload-bearing students can be printed, so they're the only ones
  // counted and selectable (keeps the counter/button label accurate).
  const printable = students.filter((s) => s.qr_hash_payload);
  const [checked, setChecked] = useState<Set<number>>(() => new Set(printable.map((s) => s.id)));
  const [printing, setPrinting] = useState(false);
  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allChecked = printable.length > 0 && checked.size === printable.length;
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(printable.map((s) => s.id)));

  const print = async () => {
    const selected = students.filter((s) => checked.has(s.id) && s.qr_hash_payload);
    if (selected.length === 0) return;
    setPrinting(true);
    try {
      const cards = await Promise.all(
        selected.map(async (st) => ({
          st,
          url: await QRCode.toDataURL(st.qr_hash_payload, { width: 260, margin: 2 }),
        })),
      );
      const w = window.open('', '_blank', 'width=820,height=1000');
      if (!w) {
        setPrinting(false);
        return;
      }
      w.document.write(`<!doctype html><html><head><title>Student QR Codes — ${escHtml(sectionName)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; margin: 14px; }
          h1 { font-size: 16px; margin: 0 0 2px; }
          .sub { color: #666; font-size: 12px; margin: 0 0 12px; }
          .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
          .card { border: 1px solid #ccc; border-radius: 8px; padding: 10px; text-align: center; page-break-inside: avoid; }
          .card img { width: 120px; height: 120px; }
          .name { font-size: 12px; font-weight: 700; margin: 6px 0 2px; word-break: break-word; }
          .meta { font-size: 11px; color: #555; margin: 0; word-break: break-word; }
          @media print { body { margin: 6px; } }
        </style></head><body>
        <h1>Student QR Codes — ${escHtml(sectionName)}</h1>
        <p class="sub">SY ${escHtml(schoolYear)} · ${selected.length} student${selected.length === 1 ? '' : 's'}</p>
        <div class="grid">
          ${cards
            .map(
              ({ st, url }) => `<div class="card">
            <img src="${url}" alt="QR code for ${escHtml(st.full_name)}" />
            <p class="name">${escHtml(st.full_name)}</p>
            <p class="meta">${escHtml(st.student_no)}</p>
          </div>`,
            )
            .join('\n')}
        </div>
      </body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);
    } catch {
      // QR generation failure — nothing to print.
    } finally {
      setTimeout(() => setPrinting(false), 600);
    }
  };

  return (
    <Modal title={`Print Student QRs — ${sectionName}`} onClose={onClose} wide>
      <p className="text-dim" style={{ marginTop: 0 }}>
        {printable.length} enrolled in {schoolYear}. Tick the students to include, then press{' '}
        <b>Print</b> — each QR is laid out as a card for cutting into tags.
      </p>
      <div className="print-qr-toolbar">
        <label className="print-qr-check-all">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} />
          <span>{allChecked ? 'Deselect all' : 'Select all'}</span>
        </label>
        <span className="text-dim">{checked.size} of {printable.length} selected</span>
      </div>
      <div className="print-qr-grid">
        {students.map((st) => (
          <label key={st.id} className={`print-qr-card${checked.has(st.id) ? ' checked' : ''}`}>
            <input
              type="checkbox"
              checked={checked.has(st.id)}
              onChange={() => toggle(st.id)}
              disabled={!st.qr_hash_payload}
              title={st.qr_hash_payload ? undefined : 'No QR payload'}
            />
            <QrCodeImage text={st.qr_hash_payload} size={112} />
            <span className="print-qr-name">{st.full_name}</span>
            <span className="print-qr-meta mono">{st.student_no}</span>
          </label>
        ))}
        {students.length === 0 && <p className="text-dim">No students enrolled in this section yet.</p>}
      </div>
      <div className="form-actions" style={{ marginTop: 14 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          disabled={checked.size === 0 || printing}
          onClick={() => void print()}
        >
          {printing ? 'Preparing…' : `🖨 Print (${checked.size})`}
        </button>
      </div>
    </Modal>
  );
}

/** Bulk-enroll modal: students with NO enrollment in the selected school year. */
function EnrollStudentsModal({
  sectionName,
  schoolYear,
  students,
  onEnroll,
  onClose,
}: {
  sectionName: string;
  schoolYear: string;
  students: Student[];
  onEnroll: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allChecked = students.length > 0 && checked.size === students.length;
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(students.map((s) => s.id)));
  return (
    <Modal title={`Enroll students — ${sectionName}`} onClose={onClose} wide>
      <p className="text-dim">
        Enroll students into <b>{sectionName}</b> for <b>{schoolYear}</b>. Students already enrolled in
        this school year are not listed ({students.length} available).
      </p>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>
                <input type="checkbox" checked={allChecked} onChange={toggleAll} title="Select all" />
              </th>
              <th>Student</th>
              <th>Student No.</th>
              <th>Parent Mobile</th>
            </tr>
          </thead>
          <tbody>
            {students.map((st) => (
              <tr key={st.id}>
                <td>
                  <input type="checkbox" checked={checked.has(st.id)} onChange={() => toggle(st.id)} />
                </td>
                <td>
                  <div className="cell-student">
                    <Avatar name={st.full_name} photoUrl={st.photo_url} size={30} />
                    <span>{st.full_name}</span>
                    {st.grade_section && (
                      <span className="text-dim" style={{ fontWeight: 400, fontSize: 12 }}>
                        · now in {st.grade_section}
                      </span>
                    )}
                  </div>
                </td>
                <td className="mono">{st.student_no}</td>
                <td className="mono">{st.parent_phone || '—'}</td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">No students left to enroll for this school year.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="form-actions" style={{ marginTop: 14 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={checked.size === 0} onClick={() => onEnroll([...checked])}>
          Enroll{checked.size > 0 ? ` (${checked.size})` : ''}
        </button>
      </div>
    </Modal>
  );
}

export function SectionsPage() {
  const { year: activeYear } = useSchoolYear();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [enrollments, setEnrollments] = useState<Map<number, string>>(new Map());
  const [gradeFilter, setGradeFilter] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [viewSection, setViewSection] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [qrPrintOpen, setQrPrintOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error'>('success');

  const load = useCallback(() => {
    // allSettled so one failing call (e.g. DB offline) can't blank out a
    // successful sibling — each list degrades to empty independently.
    void Promise.allSettled([api.listSections(), api.listStudents(), api.listAdvisers()]).then(([sRes, stRes, aRes]) => {
      setSections(sRes.status === 'fulfilled' ? sRes.value : []);
      setStudents(stRes.status === 'fulfilled' ? stRes.value : []);
      setTeachers(aRes.status === 'fulfilled' ? aRes.value : []);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Enrollments for the selected year. Re-runs when the year or the student
  // list changes (mutations go through load(), which replaces `students`).
  // The cleanup flag drops stale responses when the year changes mid-flight.
  useEffect(() => {
    if (!activeYear) return;
    let stale = false;
    void api.listEnrollments(activeYear).then((rows) => {
      if (!stale) setEnrollments(new Map(rows.map((r) => [r.studentId, r.gradeSection])));
    });
    return () => {
      stale = true;
    };
  }, [activeYear, students]);

  const notify = (msg: string, tone: 'success' | 'error' = 'success') => {
    setToast(msg);
    setToastTone(tone);
    setTimeout(() => {
      setToast(null);
      setToastTone('success');
    }, 4000);
  };

  const saveSection = async (input: SectionInput) => {
    try {
      await api.saveSection(input);
      notify(`Section saved — ${input.grade_section}`);
      setModal(null);
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

  const removeSection = async (sec: Section) => {
    if (!window.confirm(`Remove section ${sec.grade_section}? Students keep their records, but it will no longer appear in the Students page picker.`)) return;
    try {
      await api.deleteSection(sec.grade_section);
      notify(`Section removed — ${sec.grade_section}`);
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

  const handleEnroll = async (ids: number[]) => {
    if (!view || !ids.length || !activeYear) return;
    try {
      const n = await api.assignStudentsToSection(ids, view.grade_section, activeYear);
      notify(`${n} student${n === 1 ? '' : 's'} enrolled in ${view.grade_section} (${activeYear})`);
      setEnrollOpen(false);
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

  const unassign = async (st: Student) => {
    if (!view || !activeYear) return;
    if (!window.confirm(`Remove ${st.full_name} from ${view.grade_section} (${activeYear})? Their enrollment for this year is cleared.`)) return;
    try {
      await api.setStudentEnrollment(st.id, activeYear, '');
      notify(`${st.full_name} removed from ${view.grade_section}`);
      load();
    } catch (err) {
      notify(`Error: ${(err as Error).message}`, 'error');
    }
  };

  if (!sections) return <Spinner label="Loading sections…" />;

  const view = sections.find((s) => s.grade_section === viewSection) ?? null;
  // studentId → section for the selected school year.
  const yearSection = (id: number) => enrollments.get(id) ?? '';
  // Students with no enrollment at all in the selected year.
  const notEnrolled = students.filter((st) => !yearSection(st.id));
  // Grades present in the registry (for the filter dropdown), in natural order.
  const grades = sortGrades([...new Set(sections.map((s) => s.grade).filter(Boolean))]);
  const filteredSections = [...(gradeFilter ? sections.filter((s) => s.grade === gradeFilter) : sections)].sort(
    (a, b) => compareGrades(a.grade, b.grade) || a.section.localeCompare(b.section) || a.grade_section.localeCompare(b.grade_section),
  );

  // ---- Roster drill-down for one section (selected school year) ------------
  if (view) {
    const roster = students.filter((st) => yearSection(st.id) === view.grade_section);
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <button className="btn-ghost" style={{ marginBottom: 12 }} onClick={() => setViewSection(null)}>
              ← Back to sections
            </button>
            <h2>{view.grade_section}</h2>
            <p className="text-dim">
              {roster.length} enrolled in {activeYear || '—'} · Adviser: {view.adviser_name || '—'} ·{' '}
              {view.email ? <span className="mono">{view.email}</span> : 'no email set'}
            </p>
          </div>
          <div className="page-actions">
            <button className="btn-ghost" onClick={() => setQrPrintOpen(true)} disabled={roster.length === 0} title={roster.length === 0 ? 'Enroll students first' : 'Print all student QR codes'}>🖨 Print QRs</button>
            <button className="btn-ghost" onClick={() => setModal({ type: 'edit', section: view })}>✎ Edit section</button>
            <button className="btn-primary" onClick={() => setEnrollOpen(true)}>➕ Enroll students</button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Student No.</th>
                <th>Parent Mobile</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roster.map((st) => (
                <tr key={st.id}>
                  <td>
                    <div className="cell-student">
                      <Avatar name={st.full_name} photoUrl={st.photo_url} size={34} />
                      <span>{st.full_name}</span>
                    </div>
                  </td>
                  <td className="mono">{st.student_no}</td>
                  <td className="mono">{st.parent_phone || '—'}</td>
                  <td>
                    <span className={`pill ${st.is_active ? 'pill-success' : 'pill-danger'}`}>
                      {st.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" title="Remove from section (this school year)" onClick={() => void unassign(st)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {roster.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    No students enrolled in {activeYear || 'this school year'} yet. Use "Enroll students" to add some.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {enrollOpen && (
          <EnrollStudentsModal
            sectionName={view.grade_section}
            schoolYear={activeYear}
            students={notEnrolled}
            onEnroll={(ids) => void handleEnroll(ids)}
            onClose={() => setEnrollOpen(false)}
          />
        )}
        {qrPrintOpen && (
          <PrintQrsModal
            sectionName={view.grade_section}
            schoolYear={activeYear || '—'}
            students={roster}
            onClose={() => setQrPrintOpen(false)}
          />
        )}
        {modal?.type === 'edit' && (
          <Modal title={`Edit — ${modal.section.grade_section}`} closeOnOverlay={false} onClose={() => setModal(null)}>
            <SectionForm
              initial={{
                grade_section: modal.section.grade_section,
                grade: modal.section.grade,
                section: modal.section.section,
                adviser_name: modal.section.adviser_name,
                email: modal.section.email,
                updated_at: modal.section.updated_at,
              }}
              sections={sections}
              teachers={teachers}
              lockSection
              onSave={(i) => void saveSection(i)}
              onCancel={() => setModal(null)}
            />
          </Modal>
        )}
        {toast && <Toast message={toast} tone={toastTone} />}
      </div>
    );
  }

  // ---- Section list (selected school year, optional grade filter) ----------
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Sections</h2>
          <p className="text-dim">Section roster &amp; adviser report emails</p>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>+ Add new section</button>
        </div>
      </div>

      <div className="toolbar">
        <label className="report-range-label text-dim" title="Show only sections from one grade">
          Grade
          <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
            <option value="">All grades</option>
            {grades.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        {gradeFilter && (
          <button className="btn-ghost" onClick={() => setGradeFilter('')}>✕ Clear grade</button>
        )}
        <span className="toolbar-divider" />
        <span className="text-dim">{filteredSections.length} section{filteredSections.length === 1 ? '' : 's'}{gradeFilter ? ` in ${gradeFilter}` : ''}</span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Section</th>
              <th>Enrolled</th>
              <th>Adviser</th>
              <th>Email</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredSections.map((sec) => {
              const enrolled = students.filter((st) => yearSection(st.id) === sec.grade_section).length;
              return (
                <tr key={sec.grade_section}>
                  <td>
                    <button className="section-link" onClick={() => setViewSection(sec.grade_section)}>
                      {sec.grade_section}
                    </button>
                  </td>
                  <td>
                    <span className="mono">{enrolled}</span>
                  </td>
                  <td>{sec.adviser_name || '—'}</td>
                  <td className="mono">{sec.email || '—'}</td>
                  <td>
                    {EMAIL_RE.test(sec.email) ? (
                      <span className="pill pill-success">READY</span>
                    ) : (
                      <span className="pill pill-warn">NO EMAIL</span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" title="Edit" onClick={() => setModal({ type: 'edit', section: sec })}>✎</button>
                      <button className="btn-icon danger" title="Remove" onClick={() => void removeSection(sec)}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredSections.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  {sections.length === 0
                    ? 'No sections yet. Add a new section — it will appear in the Students page.'
                    : `No sections in ${gradeFilter}.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal?.type === 'add' && (
        <Modal title="Add Section" closeOnOverlay={false} onClose={() => setModal(null)}>
          <SectionForm
            initial={EMPTY_FORM}
            sections={sections}
            teachers={teachers}
            onSave={(i) => void saveSection(i)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal title={`Edit — ${modal.section.grade_section}`} closeOnOverlay={false} onClose={() => setModal(null)}>
          <SectionForm
            initial={{
              grade_section: modal.section.grade_section,
              grade: modal.section.grade,
              section: modal.section.section,
              adviser_name: modal.section.adviser_name,
              email: modal.section.email,
              updated_at: modal.section.updated_at,
            }}
            sections={sections}
            teachers={teachers}
            lockSection
            onSave={(i) => void saveSection(i)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {toast && <Toast message={toast} tone={toastTone} />}
    </div>
  );
}
