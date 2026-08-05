// Renderer-side API client.
//  - Inside Electron: delegates to window.tapin (preload bridge → main process).
//  - In a plain browser (vite dev / preview): uses a full in-memory mock so the
//    entire UI — kiosk + admin — can be developed and verified with no
//    Electron, MySQL, or hardware.
import type {
  AbsenteeRow,
  AbsenteeTotalsRow,
  ActivationResult,
  ActivityItem,
  AdviserSendDetail,
  AdviserSendResult,
  AttendanceFlag,
  AttendanceLogRow,
  EmailResult,
  EnrollmentRow,
  EntryType,
  ExportResult,
ImportResult,
  LicenseStatus,
  LogFilter,
  LoginResult,
  OverviewStats,
  PerSectionRow,
  PerStudentRow,
  ReportData,
  ReportQuery,
  ReportRegister,
  ReportTrends,
  ReportType,
  ScanResult,
  ScanSource,
  SchoolYear,
  Section,
  SectionInput,
  Settings,
  SmsFilter,
  SmsLogRow,
  SmsStatus,
  Student,
  StudentDayRow,
  StudentInput,
  StudentRecord,
  StudentScanRow,
  SystemStatus,
  TapinApi,
  TardinessFrequencyRow,
  TardinessRow,
} from '../../shared/types';
import { buildReportHtml } from '../../shared/report-html';
import { compareGrades } from './sort';

export const isElectron = typeof window !== 'undefined' && !!window.tapin;

// ---------------------------------------------------------------------------
// Mock payload generator (mirrors electron/services/qr.ts so QR codes match
// between browser mock mode and the real backend).
// ---------------------------------------------------------------------------
const CHECK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MOCK_SECRET = 'tapin-school-default-secret';

export function mockPayload(studentNo: string): string {
  let hash = 0;
  const input = `${studentNo}::${MOCK_SECRET}`;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  const a = CHECK_ALPHABET[hash % CHECK_ALPHABET.length];
  const b = CHECK_ALPHABET[Math.floor(hash / CHECK_ALPHABET.length) % CHECK_ALPHABET.length];
  const c = CHECK_ALPHABET[Math.floor(hash / CHECK_ALPHABET.length / CHECK_ALPHABET.length) % CHECK_ALPHABET.length];
  return `CP-${new Date().getFullYear()}-${studentNo}${a}${b}${c}`;
}

export function mockMaskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  return `+${digits.slice(0, 5)}*****${digits.slice(-2)}`;
}

/**
 * Splits "Grade 7 - Section A" into grade "Grade 7" / section "Section A".
 * Matches the SQL backfill in electron/db/schema.ts and the IPC splitSection.
 */
function splitSection(name: string): { grade: string; section: string } {
  const first = name.indexOf(' - ');
  const last = name.lastIndexOf(' - ');
  if (first >= 0) return { grade: name.slice(0, first).trim(), section: name.slice(last + 3).trim() };
  return { grade: name.trim(), section: '' };
}

const DEFAULT_MOCK_SETTINGS: Settings = {
  school_name: 'TapIn School',
  logo_url: null,
  show_photos: true,
  debounce_seconds: 120,
  sms_provider: 'simulator',
  gsm_com_port: 'COM3',
  gsm_baud: 9600,
  gsm_auto_port: true,
  kiosk_photo_style: 'avatar',
  cloud_provider: 'semaphore',
  cloud_api_key: '',
  cloud_sender: '',
  cloud_endpoint: '',
  sms_template:
    '{{school}} Alert: {{name}} ({{section}}) {{action}} at {{time}}. Please advise. - {{school}}',
  bell_time_in: '07:00',
  bell_time_out: '16:00',
  bell_grace_minutes: 15,
  absence_detect: true,
  absence_sms: true,
  absence_last_run: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_password: '',
  smtp_allow_self_signed: false,
  email_from: '',
  email_recipient: '',
};

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------
class MockApi implements TapinApi {
  private students: Student[];
  private logs: AttendanceLogRow[] = [];
  private sms: SmsLogRow[] = [];
  private sections: Section[] = [];
  private schoolYears: SchoolYear[] = [];
  private enrollments: { studentId: number; schoolYear: string; gradeSection: string }[] = [];
  private settings: Settings = { ...DEFAULT_MOCK_SETTINGS };
  private idSeq = 1;
  private smsIdSeq = 1;
  private sectionIdSeq = 1;
  private schoolYearIdSeq = 1;
  private lastScanByStudent = new Map<number, { time: number; type: EntryType }>();
  private scanCbs = new Set<(r: ScanResult) => void>();
  private activityCbs = new Set<(items: ActivityItem[]) => void>();
  private statusCbs = new Set<(s: SystemStatus) => void>();

  constructor() {
    const demo: Array<[string, string, string, string]> = [
      ['2024-0112', 'Juan Dela Cruz', 'Grade 7 - Section A', '09171234567'],
      ['2024-0113', 'Maria Santos', 'Grade 7 - Section A', '09182345678'],
      ['2024-0215', 'Carlos Garcia', 'Grade 8 - Section B', '09193456789'],
      ['2024-0318', 'Ana Reyes', 'Grade 9 - Section C', '09184567890'],
      ['2024-0421', 'Miguel Torres', 'Grade 10 - Section D', '09195678901'],
      ['2024-0524', 'Liza Fernandez', 'Grade 11 - STEM', '09196789012'],
    ];
    this.students = demo.map(([student_no, full_name, grade_section, parent_phone]) => ({
      id: this.idSeq++,
      student_no,
      qr_hash_payload: mockPayload(student_no),
      full_name,
      grade_section,
      parent_phone,
      photo_url: null,
      is_active: true,
      created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    }));

    // Demo sections cover every section the demo students belong to (so the
    // registry matches the roster). First two have adviser emails; the rest
    // are registered without one (NO EMAIL pill) to demo the flow.
    const demoSections: Array<[string, string, string]> = [
      ['Grade 7 - Section A', 'Ms. Maria Reyes', 'maria.reyes@example.com'],
      ['Grade 8 - Section B', 'Mr. Carlo Mendoza', 'carlo.mendoza@example.com'],
      ['Grade 9 - Section C', '', ''],
      ['Grade 10 - Section D', '', ''],
      ['Grade 11 - STEM', '', ''],
    ];
    this.sections = demoSections.map(([grade_section, adviser_name, email]) => ({
      id: this.sectionIdSeq++,
      grade_section,
      ...splitSection(grade_section),
      adviser_name,
      email,
      created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    }));

    // Demo school year + enrollments: one current year, seeded from the demo
    // students' sections so the roster matches the current roster.
    this.schoolYears = [
      { id: this.schoolYearIdSeq++, name: '2026 - 2027', is_current: true, created_at: new Date().toISOString() },
    ];
    this.enrollments = this.students
      .filter((s) => s.grade_section)
      .map((s) => ({ studentId: s.id, schoolYear: '2026 - 2027', gradeSection: s.grade_section }));

    // Seed a week of history so the admin dashboard looks alive.
    for (let d = 6; d >= 0; d--) {
      const day = new Date();
      day.setDate(day.getDate() - d);
      const count = d === 0 ? 3 : 8 + (d * 37) % 14;
      for (let i = 0; i < count; i++) {
        const s = this.students[i % this.students.length];
        const inTime = new Date(day);
        inTime.setHours(6 + (i % 3), 20 + ((i * 13) % 35), (i * 7) % 60);
        this.addLog(s, 'IN', inTime, d === 0);
        const outTime = new Date(day);
        outTime.setHours(15 + (i % 2), 10 + ((i * 17) % 40), (i * 11) % 60);
        this.addLog(s, 'OUT', outTime, d === 0);
      }
    }
    this.sortLogs();
  }

  private flagFor(entryType: EntryType, at: Date): AttendanceFlag {
    const parse = (raw: string) => {
      const [h, m] = raw.split(':').map(Number);
      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
    };
    const late = this.settings.bell_time_in ? parse(this.settings.bell_time_in) : null;
    const early = this.settings.bell_time_out ? parse(this.settings.bell_time_out) : null;
    const mins = at.getHours() * 60 + at.getMinutes();
    if (entryType === 'IN' && late !== null && mins > late + Math.max(0, this.settings.bell_grace_minutes)) return 'LATE';
    if (entryType === 'OUT' && early !== null && mins < early) return 'EARLY';
    return '';
  }

  private addLog(s: Student, entryType: EntryType, at: Date, queueSms: boolean): AttendanceLogRow {
    const id = this.logs.length + 1;
    const log: AttendanceLogRow = {
      id,
      student_id: s.id,
      entry_type: entryType,
      scanned_at: at.toISOString(),
      source: 'SCANNER',
      flag: this.flagFor(entryType, at),
      full_name: s.full_name,
      student_no: s.student_no,
      grade_section: s.grade_section,
    };
    this.logs.push(log);
    if (queueSms && s.parent_phone) {
      const sms: SmsLogRow = {
        id: this.smsIdSeq++,
        attendance_id: id,
        parent_phone: s.parent_phone,
        message: `${this.settings.school_name} Alert: ${s.full_name} (${s.grade_section}) ${
          entryType === 'IN' ? 'checked IN to school' : 'checked OUT of school'
        } at ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Please advise. - ${this.settings.school_name}`,
        status: 'PENDING',
        provider: 'simulator',
        attempts: 0,
        error: null,
        created_at: at.toISOString(),
        sent_at: null,
        full_name: s.full_name,
        entry_type: entryType,
        scanned_at: at.toISOString(),
      };
      this.sms.push(sms);
      // Simulate the queue worker delivering ~1s later.
      setTimeout(() => {
        sms.status = 'SENT';
        sms.sent_at = new Date().toISOString();
        sms.provider = 'simulator';
        this.emitActivity();
      }, 1200);
    }
    return log;
  }

  private sortLogs(): void {
    this.logs.sort((a, b) => (a.scanned_at < b.scanned_at ? 1 : -1));
  }

  private recentActivity(limit = 5): ActivityItem[] {
    return this.logs.slice(0, limit).map((l) => {
      const sms = this.sms.find((s) => s.attendance_id === l.id) ?? null;
      return {
        id: l.id,
        full_name: l.full_name,
        grade_section: l.grade_section,
        student_no: l.student_no,
        entry_type: l.entry_type,
        scanned_at: l.scanned_at,
        source: l.source,
        sms_status: sms ? sms.status : null,
        parent_phone: sms ? sms.parent_phone : null,
        flag: l.flag,
      };
    });
  }

  private emitActivity(): void {
    const items = this.recentActivity(5);
    this.activityCbs.forEach((cb) => cb(items));
  }

  private emitStatus(): void {
    const status: SystemStatus = {
      db: { online: true, detail: 'MySQL connected (mock)' },
      sms: { provider: 'simulator', online: true, detail: 'Simulator active — no real SMS sent (mock)' },
      queue: { pending: 0 },
    };
    this.statusCbs.forEach((cb) => cb(status));
  }

  // ---- TapinApi implementation --------------------------------------------
  async getStatus(): Promise<SystemStatus> {
    return {
      db: { online: true, detail: 'MySQL connected (mock mode)' },
      sms: { provider: this.settings.sms_provider, online: true, detail: 'Simulator active (mock)' },
      queue: { pending: 0 },
    };
  }

  async processScan(payload: string, _source: ScanSource): Promise<ScanResult> {
    await new Promise((r) => setTimeout(r, 450));
    const trimmed = payload.trim();
    const student = this.students.find(
      (s) => s.qr_hash_payload === trimmed || s.student_no === trimmed,
    );
    if (!student) {
      const r: ScanResult = { kind: 'UNRECOGNIZED', message: 'Unrecognized QR code. Please report to the admin office.' };
      this.scanCbs.forEach((cb) => cb(r));
      return r;
    }
    if (!student.is_active) {
      const r: ScanResult = { kind: 'BLOCKED', message: 'Access restricted. Please report to the Principal / Admin Office.', student };
      this.scanCbs.forEach((cb) => cb(r));
      return r;
    }
    const last = this.lastScanByStudent.get(student.id);
    const now = Date.now();
    if (last && now - last.time < this.settings.debounce_seconds * 1000) {
      const wait = Math.max(1, Math.ceil((this.settings.debounce_seconds * 1000 - (now - last.time)) / 1000));
      const r: ScanResult = { kind: 'DUPLICATE', message: `QR already scanned — please wait ${wait}s.`, student };
      this.scanCbs.forEach((cb) => cb(r));
      return r;
    }
    const entryType: EntryType = last?.type === 'IN' ? 'OUT' : 'IN';
    this.lastScanByStudent.set(student.id, { time: now, type: entryType });
    const log = this.addLog(student, entryType, new Date(), true);
    this.sortLogs();
    const result: ScanResult = {
      kind: 'SUCCESS',
      message: entryType === 'IN' ? 'Checked IN — have a great day!' : 'Checked OUT — see you tomorrow!',
      student,
      entryType,
      log,
      smsQueued: !!student.parent_phone,
      parentPhoneMasked: student.parent_phone ? mockMaskPhone(student.parent_phone) : undefined,
    };
    this.scanCbs.forEach((cb) => cb(result));
    this.emitActivity();
    return result;
  }

  async getRecentActivity(limit = 5): Promise<ActivityItem[]> {
    return this.recentActivity(limit);
  }

  async setKioskMode(_active: boolean): Promise<void> {
    // no-op in mock
  }

  async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => undefined);
  }

  async windowMinimize(): Promise<void> {
    // No OS window to control in browser mock mode.
  }

  async windowMaximizeToggle(): Promise<void> {
    // Approximate maximize with the browser fullscreen API in mock mode.
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen().catch(() => undefined);
  }

  async windowClose(): Promise<void> {
    // Browser tabs can't be closed from script; no-op in mock mode.
  }

  async login(username: string, password: string): Promise<LoginResult> {
    await new Promise((r) => setTimeout(r, 400));
    if (username === 'admin' && password === 'admin') return { ok: true };
    return { ok: false, error: 'Invalid username or password.' };
  }

  async logout(): Promise<void> {
    // No-op in mock mode — the renderer owns the session.
  }

  async getOverview(): Promise<OverviewStats> {
    const today = this.logs.filter((l) => {
      const d = new Date(l.scanned_at);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    });
    const todayIn = today.filter((l) => l.entry_type === 'IN').length;
    const todayOut = today.filter((l) => l.entry_type === 'OUT').length;
    const hourlyToday = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      in: today.filter((l) => l.entry_type === 'IN' && new Date(l.scanned_at).getHours() === hour).length,
      out: today.filter((l) => l.entry_type === 'OUT' && new Date(l.scanned_at).getHours() === hour).length,
    }));
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const total = this.logs.filter((l) => new Date(l.scanned_at).toDateString() === d.toDateString()).length;
      return { date: d.toISOString().slice(0, 10), total };
    });
    return {
      todayTotal: today.length,
      todayIn,
      todayOut,
      activeStudents: this.students.filter((s) => s.is_active).length,
      totalStudents: this.students.length,
      smsSentToday: this.sms.filter((s) => {
        if (s.status !== 'SENT') return false;
        return new Date(s.created_at).toDateString() === new Date().toDateString();
      }).length,
      smsPendingToday: this.sms.filter((s) => s.status === 'PENDING').length,
      smsFailedToday: 0,
      lateToday: today.filter((l) => l.entry_type === 'IN' && this.flagFor('IN', new Date(l.scanned_at)) === 'LATE').length,
      earlyToday: today.filter((l) => l.entry_type === 'OUT' && this.flagFor('OUT', new Date(l.scanned_at)) === 'EARLY').length,
      absentToday: this.students.filter(
        (s) => s.is_active && !today.some((l) => l.student_id === s.id),
      ).length,
      hourlyToday,
      last7Days,
    };
  }

  async listStudents(search?: string): Promise<Student[]> {
    const list = [...this.students];
    if (search) {
      const q = search.toLowerCase();
      return list.filter(
        (s) =>
          s.full_name.toLowerCase().includes(q) ||
          s.student_no.toLowerCase().includes(q) ||
          s.grade_section.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  async createStudent(input: StudentInput): Promise<Student> {
    // students.grade_section is the CURRENT year's live section — a student
    // enrolled into a past year starts unassigned this year (mirrors ipc.ts).
    const year = (input.school_year || '').trim() || this.currentYearName();
    const isCurrent = year ? (this.schoolYears.find((y) => y.name === year)?.is_current ?? false) : false;
    const s: Student = {
      id: this.idSeq++,
      student_no: input.student_no,
      qr_hash_payload: mockPayload(input.student_no),
      full_name: input.full_name,
      grade_section: isCurrent ? (input.grade_section || '') : '',
      parent_phone: input.parent_phone || '',
      photo_url: input.photo_url ?? null,
      is_active: input.is_active ?? true,
      created_at: new Date().toISOString(),
    };
    this.students.push(s);
    // The enrollment is recorded for the requested (or current) school year.
    if (input.grade_section && year) {
      this.enrollments.push({ studentId: s.id, schoolYear: year, gradeSection: input.grade_section });
    }
    return s;
  }

  async updateStudent(id: number, input: Partial<StudentInput>): Promise<Student> {
    const s = this.students.find((x) => x.id === id);
    if (!s) throw new Error('Student not found');
    // school_year is an enrollment hint, not a student column — keep it off the row.
    const { school_year, ...studentFields } = input;
    const prevSection = s.grade_section;
    Object.assign(s, studentFields);
    // Keep the requested (or current) school year's enrollment in sync when the
    // section changes. Only the current year's enrollment mirrors onto
    // students.grade_section (the live section).
    if ('grade_section' in input) {
      const year = (school_year || '').trim() || this.currentYearName();
      const isCurrent = year ? (this.schoolYears.find((y) => y.name === year)?.is_current ?? false) : false;
      if (!isCurrent) s.grade_section = prevSection;
      this.enrollments = this.enrollments.filter((e) => !(e.studentId === id && e.schoolYear === year));
      if (year && input.grade_section) {
        this.enrollments.push({ studentId: id, schoolYear: year, gradeSection: input.grade_section });
      }
    }
    return { ...s };
  }

  async deleteStudent(id: number): Promise<void> {
    this.students = this.students.filter((s) => s.id !== id);
    this.enrollments = this.enrollments.filter((e) => e.studentId !== id);
  }

  async generateQrPayload(studentNo: string): Promise<string> {
    return mockPayload(studentNo);
  }

  async importStudentsCsv(csv: string): Promise<ImportResult> {
    const result: ImportResult = { added: 0, skipped: 0, errors: [] };
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const start = lines[0]?.toLowerCase().includes('student_no') ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const [studentNo, fullName, gradeSection, phone] = lines[i].split(',');
      if (!studentNo || !fullName) {
        result.errors.push(`Row ${i + 1}: missing student_no or full_name`);
        result.skipped++;
        continue;
      }
      if (this.students.some((s) => s.student_no === studentNo)) {
        result.skipped++;
        continue;
      }
      await this.createStudent({
        student_no: studentNo,
        full_name: fullName,
        grade_section: gradeSection ?? '',
        parent_phone: phone ?? '',
      });
      result.added++;
    }
    return result;
  }

  async seedDemoData(): Promise<ImportResult> {
    if (this.students.length > 0) return { added: 0, skipped: this.students.length, errors: [] };
    return this.importStudentsCsv(
      [
        'student_no,full_name,grade_section,parent_phone',
        '2025-0101,Demo Student One,Grade 7 - Section A,09170000001',
        '2025-0102,Demo Student Two,Grade 8 - Section B,09170000002',
      ].join('\n'),
    );
  }

  async listLogs(filter: LogFilter = {}): Promise<{ rows: AttendanceLogRow[]; total: number }> {
    let rows = [...this.logs];
    if (filter.search) {
      const q = filter.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.full_name.toLowerCase().includes(q) ||
          r.student_no.toLowerCase().includes(q) ||
          r.grade_section.toLowerCase().includes(q),
      );
    }
    if (filter.entryType) rows = rows.filter((r) => r.entry_type === filter.entryType);
    if (filter.from) rows = rows.filter((r) => r.scanned_at >= filter.from!);
    if (filter.to) rows = rows.filter((r) => r.scanned_at <= filter.to!);
    // Grouped by grade (numerically: Grade 7 before Grade 10), section, then
    // newest first — mirrors the real listLogs ordering.
    rows.sort(
      (a, b) =>
        compareGrades(a.grade_section, b.grade_section) ||
        a.grade_section.localeCompare(b.grade_section) ||
        (a.scanned_at < b.scanned_at ? 1 : -1),
    );
    const total = rows.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return { rows: rows.slice(offset, offset + limit), total };
  }

  async exportLogsCsv(filter: LogFilter = {}): Promise<string> {
    const { rows } = await this.listLogs({ ...filter, limit: 5000 });
    const header = 'ID,Student No,Full Name,Grade Section,Type,Source,Flag,Scanned At';
    return [header, ...rows.map((r) => [r.id, r.student_no, `"${r.full_name}"`, `"${r.grade_section}"`, r.entry_type, r.source, r.flag, r.scanned_at].join(','))].join('\n');
  }

  async listSms(filter: SmsFilter = {}): Promise<{ rows: SmsLogRow[]; total: number }> {
    let rows = [...this.sms];
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      rows = rows.filter((r) => (r.full_name ?? '').toLowerCase().includes(q) || r.parent_phone.includes(q));
    }
    const total = rows.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return { rows: rows.slice(offset, offset + limit), total };
  }

  async retrySms(id: number): Promise<SmsLogRow> {
    const row = this.sms.find((s) => s.id === id);
    if (row) {
      row.status = 'PENDING';
      row.attempts = 0;
      row.error = null;
    }
    if (row) return row;
    throw new Error('SMS not found');
  }

  async testSms(phone: string): Promise<{ ok: boolean; message: string }> {
    await new Promise((r) => setTimeout(r, 700));
    return { ok: true, message: `Test SMS delivered via simulator to ${phone} (mock)` };
  }

  async getSettings(): Promise<Settings> {
    return { ...this.settings };
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    this.settings = { ...this.settings, ...patch };
    this.emitStatus();
    return { ...this.settings };
  }

  async listSections(): Promise<Section[]> {
    return [...this.sections].sort((a, b) => a.grade_section.localeCompare(b.grade_section));
  }

  async saveSection(input: SectionInput): Promise<Section> {
    const gradeSection = (input.grade_section || '').trim();
    const grade = (input.grade || '').trim() || splitSection(gradeSection).grade;
    const section = (input.section || '').trim() || splitSection(gradeSection).section;
    const existing = this.sections.find((a) => a.grade_section === gradeSection);
    if (existing) {
      existing.grade = grade;
      existing.section = section;
      existing.adviser_name = (input.adviser_name || '').trim();
      existing.email = (input.email || '').trim();
      return { ...existing };
    }
    const sectionRow: Section = {
      id: this.sectionIdSeq++,
      grade_section: gradeSection,
      grade,
      section,
      adviser_name: (input.adviser_name || '').trim(),
      email: (input.email || '').trim(),
      created_at: new Date().toISOString(),
    };
    this.sections.push(sectionRow);
    return { ...sectionRow };
  }

  async deleteSection(gradeSection: string): Promise<void> {
    this.sections = this.sections.filter((a) => a.grade_section !== gradeSection);
  }

  private currentYearName(): string {
    return this.schoolYears.find((y) => y.is_current)?.name ?? this.schoolYears[0]?.name ?? '';
  }

  async assignStudentsToSection(studentIds: number[], gradeSection: string, schoolYear: string): Promise<number> {
    const section = (gradeSection || '').trim();
    const year = (schoolYear || '').trim();
    if (!section || !year) throw new Error('Section and school year are required.');
    if (!this.sections.some((s) => s.grade_section === section)) {
      const { grade, section: part } = splitSection(section);
      await this.saveSection({ grade_section: section, grade, section: part, adviser_name: '', email: '' });
    }
    const isCurrent = this.schoolYears.find((y) => y.name === year)?.is_current ?? false;
    const ids = new Set(studentIds);
    let count = 0;
    for (const st of this.students) {
      if (!ids.has(st.id)) continue;
      this.enrollments = this.enrollments.filter((e) => !(e.studentId === st.id && e.schoolYear === year));
      this.enrollments.push({ studentId: st.id, schoolYear: year, gradeSection: section });
      if (isCurrent) st.grade_section = section;
      count++;
    }
    return count;
  }

  async setStudentEnrollment(studentId: number, schoolYear: string, gradeSection: string): Promise<void> {
    const year = (schoolYear || '').trim();
    const section = (gradeSection || '').trim();
    if (!year) throw new Error('School year is required.');
    const isCurrent = this.schoolYears.find((y) => y.name === year)?.is_current ?? false;
    this.enrollments = this.enrollments.filter((e) => !(e.studentId === studentId && e.schoolYear === year));
    const st = this.students.find((s) => s.id === studentId);
    if (section) {
      this.enrollments.push({ studentId, schoolYear: year, gradeSection: section });
      if (st && isCurrent) st.grade_section = section;
    } else if (st && isCurrent) {
      st.grade_section = '';
    }
  }

  async listEnrollments(schoolYear: string): Promise<EnrollmentRow[]> {
    return this.enrollments
      .filter((e) => e.schoolYear === schoolYear && e.gradeSection)
      .map((e) => ({ studentId: e.studentId, gradeSection: e.gradeSection }));
  }

  async listSchoolYears(): Promise<SchoolYear[]> {
    if (!this.schoolYears.length) {
      this.schoolYears = [
        { id: this.schoolYearIdSeq++, name: '2026 - 2027', is_current: true, created_at: new Date().toISOString() },
      ];
    }
    if (!this.schoolYears.some((y) => y.is_current) && this.schoolYears.length) {
      this.schoolYears.forEach((y, i) => (y.is_current = i === 0));
    }
    return [...this.schoolYears].sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveSchoolYear(name: string): Promise<SchoolYear> {
    const year = (name || '').trim();
    if (!year) throw new Error('School year is required.');
    const existing = this.schoolYears.find((y) => y.name === year);
    if (existing) return { ...existing };
    const sy: SchoolYear = {
      id: this.schoolYearIdSeq++,
      name: year,
      is_current: false,
      created_at: new Date().toISOString(),
    };
    this.schoolYears.push(sy);
    return { ...sy };
  }

  async setCurrentSchoolYear(name: string): Promise<void> {
    const year = (name || '').trim();
    if (!this.schoolYears.some((y) => y.name === year)) throw new Error('School year not found.');
    this.schoolYears.forEach((y) => (y.is_current = y.name === year));
    // Rollover: rebuild current sections from the new year's enrollments
    // (a fresh year clears every student's section).
    for (const st of this.students) {
      const enr = this.enrollments.find((e) => e.studentId === st.id && e.schoolYear === year);
      st.grade_section = enr?.gradeSection ?? '';
    }
  }

  async deleteSchoolYear(name: string): Promise<void> {
    const year = (name || '').trim();
    const row = this.schoolYears.find((y) => y.name === year);
    if (row?.is_current) throw new Error('Cannot delete the current school year.');
    this.schoolYears = this.schoolYears.filter((y) => y.name !== year);
    this.enrollments = this.enrollments.filter((e) => e.schoolYear !== year);
  }

  async getReport(query: ReportQuery): Promise<ReportData> {
    const type: ReportType = query.type ?? 'summary';
    const section = (query.section ?? '').trim();
    const maskPhones = !!query.maskPhones;
    const schoolYear = (query.schoolYear ?? '').trim();
    const studentId = query.studentId;
    // Section groupings reflect the SELECTED school year's enrollments, falling
    // back to the live (current-year) section — mirrors electron/services/report.ts.
    const yearSection = new Map(
      this.enrollments.filter((e) => e.schoolYear === schoolYear && e.gradeSection).map((e) => [e.studentId, e.gradeSection]),
    );
    const secOf = (s: Student) => yearSection.get(s.id) ?? s.grade_section;
    const { from, to } = query;
    const dayOf = (iso: string) => iso.slice(0, 10);
    const pad = (n: number) => String(n).padStart(2, '0');
    const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const flag = (l: AttendanceLogRow) => this.flagFor(l.entry_type, new Date(l.scanned_at));
    const phone = (p: string) => (maskPhones ? mockMaskPhone(p) : p);

    const logs = this.logs.filter((l) => dayOf(l.scanned_at) >= from && dayOf(l.scanned_at) <= to);
    const active = this.students.filter((s) => s.is_active);
    const activeSection = section ? active.filter((s) => secOf(s) === section) : active;

    // Cutoffs mirroring electron/services/bell-times.ts.
    const parseT = (raw: string) => {
      const [h, m] = String(raw || '').split(':').map(Number);
      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
    };
    const grace = Math.max(0, Number(this.settings.bell_grace_minutes) || 0);
    const lateMins = this.settings.bell_time_in ? parseT(this.settings.bell_time_in)! + grace : null;
    const earlyMins = this.settings.bell_time_out ? parseT(this.settings.bell_time_out)! : null;
    const toHms = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}:00`;
    const cutoffs = { late: lateMins === null ? '' : toHms(lateMins), early: earlyMins === null ? '' : toHms(earlyMins) };

    // Per-day distinct present.
    const dayPresent = new Map<string, Set<number>>();
    for (const l of logs) {
      const d = dayOf(l.scanned_at);
      if (!dayPresent.has(d)) dayPresent.set(d, new Set());
      dayPresent.get(d)!.add(l.student_id);
    }
    const schoolDays = dayPresent.size;
    const sumPresent = [...dayPresent.values()].reduce((s, set) => s + set.size, 0);
    const attendanceRate = schoolDays > 0 && active.length > 0 ? (sumPresent / (active.length * schoolDays)) * 100 : null;
    const ada = schoolDays > 0 ? sumPresent / schoolDays : null;
    const activeStudents = active.length;

    const scanOf = (l: AttendanceLogRow) => new Date(l.scanned_at);
    const totalIn = logs.filter((l) => l.entry_type === 'IN').length;
    const lateTotal = logs.filter((l) => l.entry_type === 'IN' && flag(l) === 'LATE').length;
    const earlyTotal = logs.filter((l) => l.entry_type === 'OUT' && flag(l) === 'EARLY').length;
    const onTime = Math.max(0, totalIn - lateTotal);
    const onTimePct = totalIn > 0 ? (onTime / totalIn) * 100 : null;
    const latePct = totalIn > 0 ? (lateTotal / totalIn) * 100 : null;

    const daily: ReportData['daily'] = [];
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    const schoolDayList: string[] = [];
    for (let t = new Date(start); t <= end && daily.length < 400; t.setDate(t.getDate() + 1)) {
      const day = dayOf(t.toISOString());
      const dayLogs = logs.filter((l) => dayOf(l.scanned_at) === day);
      const presentDay = dayPresent.get(day)?.size ?? 0;
      if (dayLogs.length > 0) schoolDayList.push(day);
      daily.push({
        day,
        scans: dayLogs.length,
        in: dayLogs.filter((l) => l.entry_type === 'IN').length,
        out: dayLogs.filter((l) => l.entry_type === 'OUT').length,
        late: dayLogs.filter((l) => l.entry_type === 'IN' && flag(l) === 'LATE').length,
        early: dayLogs.filter((l) => l.entry_type === 'OUT' && flag(l) === 'EARLY').length,
        absent: dayLogs.length > 0 ? Math.max(0, active.length - presentDay) : 0,
        present: presentDay,
      });
    }

    const smsInRange = this.sms.filter((s) => dayOf(s.created_at) >= from && dayOf(s.created_at) <= to);
    const presentDistinct = new Set(logs.map((l) => l.student_id)).size;
    const sections = [...new Set(this.students.map((s) => secOf(s)).filter(Boolean))].sort(compareGrades);

    // At-risk: active students with attendance < 80%.
    let atRiskCount = 0;
    if (schoolDays > 0) {
      const daysByStudent = new Map<number, Set<string>>();
      for (const l of logs) {
        if (!daysByStudent.has(l.student_id)) daysByStudent.set(l.student_id, new Set());
        daysByStudent.get(l.student_id)!.add(dayOf(l.scanned_at));
      }
      atRiskCount = active.filter((s) => (daysByStudent.get(s.id)?.size ?? 0) / schoolDays < 0.8).length;
    }

    const smsForStudent = new Map<number, number>();
    // Most recent SMS (by id) per student — drives the per-student Last SMS column.
    const lastSmsForStudent = new Map<number, SmsLogRow>();
    for (const sm of smsInRange) {
      const log = this.logs.find((l) => l.id === sm.attendance_id);
      if (!log) continue;
      const sid = log.student_id;
      smsForStudent.set(sid, (smsForStudent.get(sid) ?? 0) + 1);
      const cur = lastSmsForStudent.get(sid);
      if (!cur || sm.id > cur.id) lastSmsForStudent.set(sid, sm);
    }

    const perStudent: PerStudentRow[] = [];
    const perSection: PerSectionRow[] = [];
    let register: ReportRegister = { windowFrom: from, windowTo: to, capped: false, days: [], students: [], rows: [] };
    const absentee: AbsenteeRow[] = [];
    const absenteeTotals: AbsenteeTotalsRow[] = [];
    const tardiness: TardinessRow[] = [];
    const tardinessFrequency: TardinessFrequencyRow[] = [];
    const smsAudit: ReportData['smsAudit'] = { daily: [], failures: [] };
    let trends: ReportTrends = { weekly: [], dayOfWeek: [], gateHours: [] };
    let studentRecord: StudentRecord | null = null;

    if (type === 'per-student') {
      for (const s of activeSection) {
        const sLogs = logs.filter((l) => l.student_id === s.id);
        const presentDays = new Set(sLogs.map((l) => dayOf(l.scanned_at))).size;
        const lateDays = new Set(
          sLogs.filter((l) => l.entry_type === 'IN' && flag(l) === 'LATE').map((l) => dayOf(l.scanned_at)),
        ).size;
        const lateMinutes = sLogs
          .filter((l) => l.entry_type === 'IN' && lateMins !== null && flag(l) === 'LATE')
          .reduce((sum, l) => sum + Math.max(0, scanOf(l).getHours() * 60 + scanOf(l).getMinutes() - (lateMins as number)), 0);
        perStudent.push({
          studentId: s.id,
          studentNo: s.student_no,
          fullName: s.full_name,
          gradeSection: secOf(s),
          parentPhone: phone(s.parent_phone),
          daysPresent: presentDays,
          daysLate: lateDays,
          daysAbsent: Math.max(0, schoolDays - presentDays),
          attendanceRate: schoolDays > 0 ? (presentDays / schoolDays) * 100 : null,
          totalIn: sLogs.filter((l) => l.entry_type === 'IN').length,
          totalOut: sLogs.filter((l) => l.entry_type === 'OUT').length,
          totalMinutesLate: lateMinutes,
          smsCount: smsForStudent.get(s.id) ?? 0,
          lastSmsStatus: (lastSmsForStudent.get(s.id)?.status as SmsStatus) ?? null,
        });
      }
      perStudent.sort(
        (a, b) => compareGrades(a.gradeSection, b.gradeSection) || a.fullName.localeCompare(b.fullName),
      );
    } else if (type === 'per-section') {
      const bySection = new Map<string, typeof active>();
      for (const s of active) {
        const gs = secOf(s);
        if (!bySection.has(gs)) bySection.set(gs, []);
        bySection.get(gs)!.push(s);
      }
      for (const [gradeSection, studs] of [...bySection.entries()].sort((a, b) => compareGrades(a[0], b[0]))) {
        const sectionLogs = logs.filter((l) => studs.some((s) => s.id === l.student_id));
        const present = new Set(sectionLogs.map((l) => l.student_id)).size;
        const dayPresentSum = new Map<string, Set<number>>();
        for (const l of sectionLogs) {
          const d = dayOf(l.scanned_at);
          if (!dayPresentSum.has(d)) dayPresentSum.set(d, new Set());
          dayPresentSum.get(d)!.add(l.student_id);
        }
        const sumPres = [...dayPresentSum.values()].reduce((sum, set) => sum + set.size, 0);
        perSection.push({
          gradeSection,
          enrolled: studs.length,
          present,
          absent: Math.max(0, studs.length - present),
          late: new Set(sectionLogs.filter((l) => l.entry_type === 'IN' && flag(l) === 'LATE').map((l) => l.student_id)).size,
          early: new Set(sectionLogs.filter((l) => l.entry_type === 'OUT' && flag(l) === 'EARLY').map((l) => l.student_id)).size,
          attendanceRate: studs.length > 0 && schoolDays > 0 ? (sumPres / (studs.length * schoolDays)) * 100 : null,
        });
      }
    } else if (type === 'register') {
      const rangeDays = Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1;
      const capped = rangeDays > 35;
      const winTo = new Date(`${to}T00:00:00`);
      const winFrom = new Date(winTo);
      winFrom.setDate(winFrom.getDate() - (capped ? 34 : rangeDays - 1));
      const windowFrom = dayOf(winFrom.toISOString());
      const windowTo = dayOf(winTo.toISOString());
      register = {
        windowFrom,
        windowTo,
        capped,
        days: schoolDayList.filter((d) => d >= windowFrom && d <= windowTo),
        students: activeSection
          .map((s) => ({
            studentId: s.id,
            studentNo: s.student_no,
            fullName: s.full_name,
            gradeSection: secOf(s),
          }))
          .sort((a, b) => compareGrades(a.gradeSection, b.gradeSection) || a.fullName.localeCompare(b.fullName)),
        rows: [],
      };
      const windowLogs = logs.filter((l) => dayOf(l.scanned_at) >= windowFrom && dayOf(l.scanned_at) <= windowTo);
      const byKey = new Map<string, { firstIn: string | null; lastOut: string | null }>();
      for (const l of windowLogs) {
        if (!activeSection.some((s) => s.id === l.student_id)) continue;
        const key = `${l.student_id}:${dayOf(l.scanned_at)}`;
        const cur = byKey.get(key) ?? { firstIn: null, lastOut: null };
        if (l.entry_type === 'IN') cur.firstIn = cur.firstIn === null || hm(scanOf(l)) < cur.firstIn ? hm(scanOf(l)) : cur.firstIn;
        if (l.entry_type === 'OUT') cur.lastOut = cur.lastOut === null || hm(scanOf(l)) > cur.lastOut ? hm(scanOf(l)) : cur.lastOut;
        byKey.set(key, cur);
      }
      for (const [key, cell] of byKey) {
        const [sid, day] = key.split(':');
        register.rows.push({ studentId: Number(sid), day, firstIn: cell.firstIn, lastOut: cell.lastOut });
      }
    } else if (type === 'absentee') {
      for (const d of [...schoolDayList].sort().reverse()) {
        for (const s of activeSection) {
          if (logs.some((l) => l.student_id === s.id && dayOf(l.scanned_at) === d)) continue;
          const smsSent = this.sms.some((sm) => {
            const log = this.logs.find((l) => l.id === sm.attendance_id);
            return log && log.student_id === s.id && dayOf(log.scanned_at) === d;
          });
          absentee.push({
            studentId: s.id,
            studentNo: s.student_no,
            fullName: s.full_name,
            gradeSection: secOf(s),
            parentPhone: phone(s.parent_phone),
            day: d,
            smsSent,
          });
          if (absentee.length >= 3000) break;
        }
        if (absentee.length >= 3000) break;
      }
      // Per-student absent-day totals — the "who to call" summary.
      for (const s of activeSection) {
        const daysAbsent = schoolDayList.filter(
          (d) => !logs.some((l) => l.student_id === s.id && dayOf(l.scanned_at) === d),
        ).length;
        if (daysAbsent <= 0) continue;
        absenteeTotals.push({
          studentId: s.id,
          studentNo: s.student_no,
          fullName: s.full_name,
          gradeSection: secOf(s),
          parentPhone: phone(s.parent_phone),
          daysAbsent,
        });
      }
      absenteeTotals.sort(
        (a, b) => b.daysAbsent - a.daysAbsent || compareGrades(a.gradeSection, b.gradeSection) || a.fullName.localeCompare(b.fullName),
      );
    } else if (type === 'tardiness') {
      const lateLogs = logs.filter((l) => l.entry_type === 'IN' && flag(l) === 'LATE');
      const freq = new Map<number, number>();
      for (const l of lateLogs.slice(0, 3000)) {
        const student = this.students.find((s) => s.id === l.student_id);
        if (!student) continue;
        if (section && secOf(student) !== section) continue;
        const at = scanOf(l);
        tardiness.push({
          id: l.id,
          studentNo: student.student_no,
          fullName: student.full_name,
          gradeSection: secOf(student),
          parentPhone: phone(student.parent_phone),
          day: dayOf(l.scanned_at),
          scannedTime: hm(at),
          minutesLate: lateMins === null ? 0 : Math.max(0, at.getHours() * 60 + at.getMinutes() - lateMins),
        });
        freq.set(l.student_id, (freq.get(l.student_id) ?? 0) + 1);
      }
      // Late-frequency per student — the repeat-offender rollup.
      for (const [sid, lateCount] of freq) {
        const student = this.students.find((s) => s.id === sid);
        if (!student) continue;
        tardinessFrequency.push({
          studentId: sid,
          studentNo: student.student_no,
          fullName: student.full_name,
          gradeSection: secOf(student),
          lateCount,
        });
      }
      tardinessFrequency.sort(
        (a, b) => b.lateCount - a.lateCount || compareGrades(a.gradeSection, b.gradeSection) || a.fullName.localeCompare(b.fullName),
      );
    } else if (type === 'sms-audit') {
      const byDay = new Map<string, { sent: number; pending: number; failed: number }>();
      for (const sm of smsInRange) {
        const d = dayOf(sm.created_at);
        const cur = byDay.get(d) ?? { sent: 0, pending: 0, failed: 0 };
        if (sm.status === 'SENT') cur.sent++;
        else if (sm.status === 'PENDING') cur.pending++;
        else cur.failed++;
        byDay.set(d, cur);
      }
      smsAudit.daily = [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([day, v]) => ({ day, total: v.sent + v.pending + v.failed, ...v }));
      smsAudit.failures = smsInRange
        .filter((s) => s.status === 'FAILED')
        .slice(0, 500)
        .map((sm) => ({
          id: sm.id,
          parentPhone: phone(sm.parent_phone),
          fullName: sm.full_name,
          provider: sm.provider,
          attempts: sm.attempts,
          error: sm.error,
          createdAt: sm.created_at,
        }));
    } else if (type === 'student') {
      const s = studentId ? this.students.find((x) => x.id === Number(studentId)) : undefined;
      if (s) {
        const sLogs = logs.filter((l) => l.student_id === s.id);
        const byDay = new Map<string, StudentScanRow[]>();
        const presentDays = new Set<string>();
        const lateDays = new Set<string>();
        let totalIn = 0;
        let totalOut = 0;
        let totalMinutesLate = 0;
        for (const l of sLogs) {
          const d = dayOf(l.scanned_at);
          const at = scanOf(l);
          const f = flag(l);
          const row: StudentScanRow = { id: l.id, time: hm(at), entryType: l.entry_type, flag: f, source: l.source };
          if (!byDay.has(d)) byDay.set(d, []);
          byDay.get(d)!.push(row);
          if (l.entry_type === 'IN') {
            totalIn++;
            if (f === 'LATE' && lateMins !== null) {
              lateDays.add(d);
              totalMinutesLate += Math.max(0, at.getHours() * 60 + at.getMinutes() - lateMins);
            }
          } else {
            totalOut++;
          }
          presentDays.add(d);
        }
        const days: StudentDayRow[] = [];
        for (let t = new Date(`${from}T00:00:00`); t <= end; t.setDate(t.getDate() + 1)) {
          const d = dayOf(t.toISOString());
          const scans = byDay.get(d) ?? [];
          days.push({
            day: d,
            schoolDay: dayPresent.has(d),
            present: scans.length > 0,
            late: scans.some((x) => x.flag === 'LATE'),
            early: scans.some((x) => x.flag === 'EARLY'),
            firstIn: scans.find((x) => x.entryType === 'IN')?.time ?? null,
            lastOut: [...scans].reverse().find((x) => x.entryType === 'OUT')?.time ?? null,
            scans,
          });
        }
        studentRecord = {
          studentId: s.id,
          studentNo: s.student_no,
          fullName: s.full_name,
          gradeSection: secOf(s),
          parentPhone: phone(s.parent_phone),
          summary: {
            daysPresent: presentDays.size,
            daysLate: lateDays.size,
            daysAbsent: Math.max(0, schoolDays - presentDays.size),
            attendanceRate: schoolDays > 0 ? (presentDays.size / schoolDays) * 100 : null,
            totalIn,
            totalOut,
            totalMinutesLate,
            smsCount: smsForStudent.get(s.id) ?? 0,
            lastSmsStatus: (lastSmsForStudent.get(s.id)?.status as SmsStatus) ?? null,
          },
          days,
        };
      }
    } else if (type === 'trends') {
      const isoWeekStart = (day: string) => {
        const [y, m, d] = day.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        const start = new Date(date);
        start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        return dayOf(start.toISOString());
      };
      const weekly = new Map<string, { days: number; presentDays: number }>();
      const dow = Array.from({ length: 7 }, () => ({ days: 0, presentDays: 0 }));
      for (const [day, presentSet] of dayPresent) {
        const wk = isoWeekStart(day);
        const w = weekly.get(wk) ?? { days: 0, presentDays: 0 };
        w.days++;
        w.presentDays += presentSet.size;
        weekly.set(wk, w);
        const [y, m, d] = day.split('-').map(Number);
        const wd = (new Date(y, m - 1, d).getDay() + 6) % 7;
        dow[wd].days++;
        dow[wd].presentDays += presentSet.size;
      }
      const rate = (p: number, days: number) =>
        days > 0 && active.length > 0 ? (p / (active.length * days)) * 100 : null;
      trends = {
        weekly: [...weekly.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([weekStart, v]) => ({ weekStart, ...v, attendanceRate: rate(v.presentDays, v.days) })),
        dayOfWeek: dow.map((v, weekday) => ({ weekday, ...v, attendanceRate: rate(v.presentDays, v.days) })),
        gateHours: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          in: logs.filter((l) => l.entry_type === 'IN' && scanOf(l).getHours() === hour).length,
          out: logs.filter((l) => l.entry_type === 'OUT' && scanOf(l).getHours() === hour).length,
        })),
      };
    }

    return {
      schoolName: this.settings.school_name || 'TapIn School',
      from,
      to,
      schoolYear,
      generatedAt: new Date().toISOString(),
      type,
      section,
      maskPhones,
      sections,
      studentId,
      studentRecord,
      cutoffs,
      summary: {
        scans: logs.length,
        in: totalIn,
        out: logs.length - totalIn,
        late: lateTotal,
        early: earlyTotal,
        absent: daily.reduce((sum, d) => sum + d.absent, 0),
        present: presentDistinct,
        sms: smsInRange.length,
        smsSent: smsInRange.filter((s) => s.status === 'SENT').length,
        days: daily.length,
        schoolDays,
        activeStudents,
        attendanceRate,
        ada,
        onTime,
        onTimePct,
        latePct,
        atRiskCount,
      },
      daily,
      perStudent,
      perSection,
      register,
      absentee,
      absenteeTotals,
      tardiness,
      tardinessFrequency,
      smsAudit,
      trends,
    };
  }

  async exportReportPdf(report: ReportData): Promise<ExportResult> {
    // Browser mock: print a dedicated hidden iframe so the report document
    // (and nothing else) is sent to the browser's print dialog / Save as PDF.
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    iframe.srcdoc = buildReportHtml(report);
    document.body.appendChild(iframe);
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      setTimeout(resolve, 400);
    });
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // Print can be blocked in some embedded contexts; the demo stays usable.
    }
    iframe.remove();
    return { ok: true };
  }

  async sendReportEmail(report: ReportData): Promise<EmailResult> {
    // Browser mock: no SMTP from the renderer — open the default mail client
    // with the report summary prefilled (attach the exported PDF to send it).
    const to = this.settings.email_recipient.split(/[,;]/).map((s) => s.trim()).filter(Boolean)[0] || '';
    const subject = encodeURIComponent(`Attendance report ${report.from} to ${report.to} — ${report.schoolName}`);
    const body = encodeURIComponent(
      [
        `Attendance report for ${report.from} to ${report.to}.`,
        '',
        `Scans: ${report.summary.scans} (${report.summary.in} IN / ${report.summary.out} OUT)`,
        `Late: ${report.summary.late} · Early: ${report.summary.early} · Absent: ${report.summary.absent}`,
        '',
        'Please attach the exported PDF to this email before sending.',
      ].join('\n'),
    );
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
    return { ok: true, message: 'Opened your email app — attach the exported PDF to send it.' };
  }

  async testEmail(to: string): Promise<EmailResult> {
    const subject = encodeURIComponent('TapIn test email');
    const body = encodeURIComponent('This is a test email from TapIn School (browser demo mode).');
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
    return { ok: true, message: `Opened your email app for ${to}.` };
  }

  async sendReportToAdvisers(from: string, to: string, schoolYear?: string): Promise<AdviserSendResult> {
    // Browser mock: no SMTP, so this just builds each per-section report and
    // reports a per-adviser success (nothing is actually emailed).
    const valid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    const withEmail = this.sections.filter((a) => a.email && valid(a.email));
    const skipped = this.sections.length - withEmail.length;
    const details: AdviserSendDetail[] = [];
    for (const a of withEmail) {
      try {
        await this.getReport({ from, to, type: 'per-student', section: a.grade_section, maskPhones: false, schoolYear });
        details.push({
          gradeSection: a.grade_section,
          adviserName: a.adviser_name,
          email: a.email,
          ok: true,
          detail: `Sent to ${a.email} (demo)`,
        });
      } catch (err) {
        details.push({
          gradeSection: a.grade_section,
          adviserName: a.adviser_name,
          email: a.email,
          ok: false,
          detail: (err as Error).message,
        });
      }
    }
    const sent = details.filter((d) => d.ok).length;
    const failed = details.length - sent;
    return {
      ok: sent > 0 && failed === 0,
      message:
        `Reports emailed to ${sent} adviser${sent === 1 ? '' : 's'}` +
        `${skipped ? `; ${skipped} skipped (no valid email)` : ''}` +
        `${failed ? `; ${failed} failed` : ''}. (Browser demo — no real email sent.)`,
      sent,
      skipped,
      failed,
      details,
    };
  }

  async exportReportXlsx(report: ReportData): Promise<ExportResult> {
    // Browser mock: styled HTML table saved as .xls (Excel opens it).
    const esc = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = report.daily
      .map(
        (d) =>
          `<tr><td>${esc(d.day)}</td><td>${d.scans}</td><td>${d.in}</td><td>${d.out}</td><td>${d.late}</td><td>${d.early}</td><td>${d.absent}</td></tr>`,
      )
      .join('');
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>td,th{border:1px solid #cbd5e1;padding:4px 10px;font:12px Calibri}th{background:#1e293b;color:#fff;font-weight:bold}tr:nth-child(even) td{background:#f8fafc}caption{font:bold 16px Calibri;padding:8px}</style></head><body><table><caption>${esc(report.schoolName)} — Attendance Report (${report.from} → ${report.to})</caption><tr><th>Day</th><th>Scans</th><th>IN</th><th>OUT</th><th>Late</th><th>Early</th><th>Absent</th></tr>${rows}</table></body></html>`;
    downloadTextFile(`tapin-report-${report.from}-to-${report.to}.xls`, html, 'application/vnd.ms-excel');
    return { ok: true };
  }

  onScanResult(cb: (r: ScanResult) => void): () => void {
    this.scanCbs.add(cb);
    return () => this.scanCbs.delete(cb);
  }

  onActivity(cb: (items: ActivityItem[]) => void): () => void {
    this.activityCbs.add(cb);
    return () => this.activityCbs.delete(cb);
  }

  onStatus(cb: (s: SystemStatus) => void): () => void {
    this.statusCbs.add(cb);
    setTimeout(() => this.emitStatus(), 300);
    return () => this.statusCbs.delete(cb);
  }

onToggleAdmin(cb: () => void): () => void {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        cb();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }

  // ---- Auto-update (browser mock) -----------------------------------------
  async checkForUpdates(): Promise<{ success: boolean; message?: string }> {
    return { success: true, message: 'Browser mock mode: updates are managed by the packaged app.' };
  }
  async downloadUpdate(): Promise<{ success: boolean; message?: string }> {
    return { success: false, message: 'Updates require the packaged Electron app.' };
  }
  async installUpdate(): Promise<{ success: boolean }> {
    return { success: false };
  }
  async getAppVersion(): Promise<string> {
    // Report the package version so the Updates panel shows something sensible.
    return 'dev';
  }
  onUpdateStatus(): () => void {
    return () => undefined;
  }

  // ---- App activation (browser mock — dev bypasses gating) ----------------
  async checkLicense(): Promise<LicenseStatus> {
    return { activated: true, licenseKey: 'DEV-MODE', machineId: 'browser-mock' };
  }
  async activateLicense(licenseKey: string): Promise<ActivationResult> {
    return { valid: true, message: 'Activated (browser mock)', machineId: 'browser-mock' };
  }
  async getMachineId(): Promise<string> {
    return 'browser-mock';
  }
}

// ---------------------------------------------------------------------------
export const api: TapinApi = isElectron ? (window.tapin as TapinApi) : new MockApi();

export function downloadTextFile(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
