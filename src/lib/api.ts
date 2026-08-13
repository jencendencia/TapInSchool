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
  Announcement,
  AnnouncementInput,
  AnnouncementMediaType,
  AttendanceFlag,
  Gender,
  Guardian,
  GuardianInput,
  GuardianWriteResult,
  Badge,
  BadgeCode,
  BadgeLeaderboardRow,
  BadgeWeekProgress,
  AttendanceLogRow,
  DbConfigInfo,
  DbConfigInput,
  DbConnectResult,
  EmailResult,
  EnrollmentRow,
  EntryType,
  Excuse,
  ExcuseCategory,
  ExportResult,
  GuardianChildReport,
  GuardianDayReport,
  ImportResult,
  JobsConfig,
  LicenseStatus,
  LogFilter,
  LoginResult,
  OverviewStats,
  PerSectionRow,
  PerStudentRow,
  ReportData,
  ReportDrilldownQuery,
  ReportDrilldownResult,
  ReportDrilldownRow,
  ReportQuery,
  ReportRegister,
  ReportTrends,
  ReportType,
  ScanMode,
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
  StudentBadgeSummary,
  SystemStatus,
  TapinApi,
  TardinessFrequencyRow,
  TardinessRow,
  User,
  UserInput,
  UserRole,
  Visitor,
  VisitorInput,
  VisitorLogRow,
} from '../../shared/types';
import { buildReportHtml } from '../../shared/report-html';
import { compareGrades } from './sort';
import { BADGE_INFO } from '../../shared/types';
import {
  BADGE_MIN_SCHOOL_DAYS,
  addDays,
  addMonths,
  currentBadgePeriods,
  fmtDay as dayKey,
  monthStart,
  parseDay,
  quarterStart,
  type BadgePeriod,
  type BadgeWindowKind,
} from '../../shared/badge-windows';

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

/**
 * Guardian QR payload (GP-…) — 6-char hash of the guardian identity
 * (name + address), mirroring electron/services/qr.ts. Identical identity →
 * identical QR, so children sharing a guardian share one code.
 */
export function mockGuardianPayload(guardianName: string, guardianAddress = ''): string {
  let hash = 0;
  const input = `${String(guardianName).trim()}::${String(guardianAddress).trim()}::${MOCK_SECRET}`;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  let out = '';
  for (let i = 0; i < 6; i++) {
    let h = hash;
    for (let k = 0; k < i; k++) h = Math.floor(h / CHECK_ALPHABET.length);
    out += CHECK_ALPHABET[h % CHECK_ALPHABET.length];
  }
  return `GP-${new Date().getFullYear()}-${out}`;
}

/**
 * Visitor QR payload (VP-<YEAR>-<id><check>) — mirrors electron/services/qr.ts
 * generateVisitorPayload. Derived from the visitor's id so the same visitor
 * always gets the same QR across visits.
 */
export function mockVisitorPayload(visitorId: number): string {
  let hash = 0;
  const input = `VISITOR::${visitorId}::${MOCK_SECRET}`;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  const a = CHECK_ALPHABET[hash % CHECK_ALPHABET.length];
  const b = CHECK_ALPHABET[Math.floor(hash / CHECK_ALPHABET.length) % CHECK_ALPHABET.length];
  const c = CHECK_ALPHABET[Math.floor(hash / CHECK_ALPHABET.length / CHECK_ALPHABET.length) % CHECK_ALPHABET.length];
  return `VP-${new Date().getFullYear()}-${visitorId}${a}${b}${c}`;
}

/** Coerces a raw gender value to 'male' | 'female' | '' (mirrors the
 *  normalizeGender helper in electron/ipc.ts — lenient about case and single
 *  letters, e.g. 'M' / 'F' from CSV imports). */
function normalizeGender(raw: unknown): '' | 'male' | 'female' {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'male' || v === 'm') return 'male';
  if (v === 'female' || v === 'f') return 'female';
  return '';
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
  announcements_idle_minutes: 1,
  announcement_slide_seconds: 8,
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
  adviser_report_enabled: false,
  adviser_report_frequency: 'daily',
  adviser_report_time: '20:00',
  adviser_report_last_run: '',
};

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------
// Badge window math is shared with the backend (shared/badge-windows.ts) so
// demo mode always agrees with electron/services/badges.ts.

const ATT_CODE: Record<BadgeWindowKind, BadgeCode> = {
  week: 'ATT_W',
  month: 'ATT_M',
  quarter: 'ATT_Q',
  year: 'ATT_Y',
};
const PUNCT_CODE: Record<BadgeWindowKind, BadgeCode> = {
  week: 'PUNCT_W',
  month: 'PUNCT_M',
  quarter: 'PUNCT_Q',
  year: 'PUNCT_Y',
};

interface MockPeriodResult {
  kind: BadgeWindowKind;
  periodKey: string;
  requiredDays: number;
  presentDays: number;
  excusedDays: number;
  attendanceMissed: boolean;
  punctualityMissed: boolean;
  attendanceComplete: boolean;
  punctualityComplete: boolean;
}

class MockApi implements TapinApi {
  private users: { id: number; username: string; password: string; role: UserRole; pin: string | null; created_at: string }[];
  private userSeq = 1;
  private students: Student[];
  private logs: AttendanceLogRow[] = [];
  private sms: SmsLogRow[] = [];
private sections: Section[] = [];
  private announcements: Announcement[] = [];
  private announcementIdSeq = 1;
  private badges: Badge[] = [];
  private badgeSeq = 1;
  private excuses: Excuse[] = [];
  private excuseSeq = 1;
  private schoolYears: SchoolYear[] = [];
  private enrollments: { studentId: number; schoolYear: string; gradeSection: string }[] = [];
  private settings: Settings = { ...DEFAULT_MOCK_SETTINGS };
  /** B5: per-machine scheduled-jobs flag (browser mock — in-memory). */
  private runScheduledJobs = true;
  private idSeq = 1;
  private smsIdSeq = 1;
  private sectionIdSeq = 1;
  private schoolYearIdSeq = 1;
  private lastScanByStudent = new Map<number, { time: number; type: EntryType }>();
  private visitors: Visitor[] = [];
  private visitorLogs: { id: number; visitor_id: number; entry_type: EntryType; source: ScanSource; scanned_at: string }[] = [];
  private visitorSeq = 1;
  private guardians: Guardian[] = [];
  private guardianSeq = 1;
  private visitorLogSeq = 1;
  private lastScanByVisitor = new Map<number, { time: number; type: EntryType }>();
  // Kiosk gate-direction mode (mirrors electron/services/scan-mode.ts).
  private scanMode: ScanMode = 'auto';
  private scanCbs = new Set<(r: ScanResult) => void>();
  private activityCbs = new Set<(items: ActivityItem[]) => void>();
  private statusCbs = new Set<(s: SystemStatus) => void>();

  constructor() {
    // [student_no, full_name, gender, grade_section, parent_phone, lrn, guardian_name, guardian_address]
    const demo: Array<[string, string, Gender, string, string, string, string, string]> = [
      ['2024-0112', 'Juan Dela Cruz', 'male', 'Grade 7 - Section A', '09171234567', '136542110123', 'Maria Dela Cruz', '123 Mabini St., Barangay San Roque, Manila'],
      ['2024-0113', 'Maria Santos', 'female', 'Grade 7 - Section A', '09182345678', '136542110124', 'Antonio Santos', '456 Rizal Ave., Quezon City'],
      ['2024-0215', 'Carlos Garcia', 'male', 'Grade 8 - Section B', '09193456789', '136542110125', 'Maria Dela Cruz', '123 Mabini St., Barangay San Roque, Manila'],
      ['2024-0318', 'Ana Reyes', 'female', 'Grade 9 - Section C', '09184567890', '136542110126', 'Luzviminda Reyes', '789 Bonifacio Rd., Pasig City'],
      ['2024-0421', 'Miguel Torres', 'male', 'Grade 10 - Section D', '09195678901', '136542110127', '', ''],
      ['2024-0524', 'Liza Fernandez', 'female', 'Grade 11 - STEM', '09196789012', '136542110128', '', ''],
    ];
    // Demo accounts: admin (dashboard) + staff (kiosk manual check-in PIN).
    this.users = [
      {
        id: this.userSeq++,
        username: 'admin',
        password: 'admin',
        role: 'admin',
        pin: null,
        created_at: new Date().toISOString(),
      },
      {
        id: this.userSeq++,
        username: 'staff',
        password: '',
        role: 'staff',
        pin: '1234',
        created_at: new Date().toISOString(),
      },
    ];

    this.students = demo.map(
      ([student_no, full_name, gender, grade_section, parent_phone, lrn, guardian_name, guardian_address]) => ({
      id: this.idSeq++,
      student_no,
      qr_hash_payload: mockPayload(student_no),
      full_name,
      gender,
      grade_section,
      parent_phone,
      lrn,
      guardian_name,
      guardian_address,
      guardian_qr_hash_payload: guardian_name ? mockGuardianPayload(guardian_name, guardian_address) : null,
      guardian_id: null,
      photo_url: null,
      is_active: true,
      created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    }));

    // Demo guardians: registered from the demo students' guardian identities so
    // the registry + student links match (Maria Dela Cruz covers Juan + Carlos
    // — one shared guardian row, mirroring the shared guardian QR).
    const guardianByIdentity = new Map<string, Guardian>();
    for (const s of this.students) {
      if (!s.guardian_name) continue;
      const key = `${s.guardian_name}::${s.guardian_address}`;
      let g = guardianByIdentity.get(key);
      if (!g) {
        g = {
          id: this.guardianSeq++,
          full_name: s.guardian_name,
          mobile: s.parent_phone,
          address: s.guardian_address,
          qr_hash_payload: mockGuardianPayload(s.guardian_name, s.guardian_address),
          is_active: true,
          created_at: s.created_at,
          updated_at: s.created_at,
        };
        this.guardians.push(g);
        guardianByIdentity.set(key, g);
      }
      s.guardian_id = g.id;
    }

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
      updated_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    }));

    // Demo announcements for the kiosk idle carousel — one full-bleed image
    // slide and one text-only slide (exercises both layout variants).
    const svgBanner = (label: string, sub: string) =>
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'>` +
          `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
          `<stop offset='0' stop-color='#0f766e'/><stop offset='1' stop-color='#4338ca'/>` +
          `</linearGradient></defs>` +
          `<rect width='1280' height='720' fill='url(#g)'/>` +
          `<circle cx='1080' cy='150' r='220' fill='rgba(255,255,255,0.09)'/>` +
          `<circle cx='180' cy='640' r='300' fill='rgba(255,255,255,0.06)'/>` +
          `<text x='640' y='360' font-family='Segoe UI, Arial, sans-serif' font-size='76' font-weight='bold' fill='#ffffff' text-anchor='middle'>${label}</text>` +
          `<text x='640' y='432' font-family='Segoe UI, Arial, sans-serif' font-size='32' fill='#d1fae5' text-anchor='middle'>${sub}</text>` +
          `</svg>`,
      );
    const nowIso = new Date().toISOString();
    this.announcements = [
      {
        id: this.announcementIdSeq++,
        title: 'School Fair this Friday',
        content_text: 'Games, food stalls and performances — see you at the quad!\nDoors open at 9:00 AM.',
        media_url: svgBanner('School Fair this Friday', 'Games · Food · Performances'),
        media_type: 'image',
        is_active: true,
        sort_order: 0,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: this.announcementIdSeq++,
        title: 'Campus Tour Video',
        content_text: 'A look around our campus — fullscreen video slide.',
        media_url: '/demo-announcement.mp4',
        media_type: 'video',
        is_active: true,
        sort_order: 1,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: this.announcementIdSeq++,
        title: 'Welcome to TapIn School',
        content_text:
          'Present your QR code at the gate each morning. Students who forget their QR may use the manual check-in at the front desk.',
        media_url: null,
        media_type: 'none',
        is_active: true,
        sort_order: 2,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ];

    // Demo school year + enrollments: one current year, seeded from the demo
    // students' sections so the roster matches the current roster.
    this.schoolYears = [
      { id: this.schoolYearIdSeq++, name: '2026 - 2027', is_current: true, created_at: new Date().toISOString() },
    ];
    this.enrollments = this.students
      .filter((s) => s.grade_section)
      .map((s) => ({ studentId: s.id, schoolYear: '2026 - 2027', gradeSection: s.grade_section }));

    // Demo walk-in visitors: one mid-visit (IN today), one checked OUT, one
    // inactive (blocked) — exercises the registry, visit logs, and the kiosk
    // IN/OUT toggle for VP QR codes.
    const demoVisitors: Array<[string, string, string, string, string, boolean]> = [
      ['Ramon Bautista', '09175551234', 'Delivery — school supplies', 'Supplies Office', 'Driver\u2019s License N-12345678', true],
      ['Alma Concepcion', '09176667788', 'Parent meeting', 'Principal\u2019s Office', 'School ID 2024-118', true],
      ['Engr. Jose Lim', '09177889900', 'Facility inspection', 'Admin Office', 'PRC 123456', false],
    ];
    this.visitors = demoVisitors.map(([full_name, contact_phone, purpose, host_office, id_presented, is_active], i) => {
      const id = this.visitorSeq++;
      const created = new Date(Date.now() - (i + 1) * 86400000).toISOString();
      return {
        id,
        full_name,
        contact_phone,
        purpose,
        host_office,
        id_presented,
        qr_hash_payload: mockVisitorPayload(id),
        is_active,
        created_at: created,
        updated_at: created,
      };
    });
    // A couple of today's logs so the Visit Logs tab and the kiosk toggle demo
    // have history to show.
    const now = new Date();
    const pushVLog = (visitorId: number, entry_type: EntryType, h: number, m: number) => {
      const at = new Date(now);
      at.setHours(h, m, (visitorId * 17) % 60, 0);
      this.visitorLogs.push({
        id: this.visitorLogSeq++,
        visitor_id: visitorId,
        entry_type,
        source: 'SCANNER',
        scanned_at: at.toISOString(),
      });
      this.lastScanByVisitor.set(visitorId, { time: at.getTime(), type: entry_type });
    };
    if (this.visitors[0]) pushVLog(this.visitors[0].id, 'IN', 9, 12);
    if (this.visitors[1]) pushVLog(this.visitors[1].id, 'OUT', 10, 45);

    // Seed a week of history so the admin dashboard looks alive. Two demo
    // stories exercise the badge rules: Ana (2024-0318) missed a day inside
    // this week that is EXCUSED (badge preserved — lenient rule), Miguel
    // (2024-0421) missed a day with no excuse (this week's badge is missed).
    for (let d = 6; d >= 0; d--) {
      const day = new Date();
      day.setDate(day.getDate() - d);
      const count = d === 0 ? 6 : 8 + (d * 37) % 14;
      for (let i = 0; i < count; i++) {
        const s = this.students[i % this.students.length];
        if ((s.student_no === '2024-0318' && d === 2) || (s.student_no === '2024-0421' && d === 1)) continue;
        const inTime = new Date(day);
        inTime.setHours(6 + (i % 3), 20 + ((i * 13) % 35), (i * 7) % 60);
        this.addLog(s, 'IN', inTime, d === 0);
        // OUT after the 16:00 dismissal so no EARLY flags pollute the demo.
        const outTime = new Date(day);
        outTime.setHours(16 + (i % 2), 10 + ((i * 17) % 40), (i * 11) % 60);
        this.addLog(s, 'OUT', outTime, d === 0);
      }
    }
    this.sortLogs();

    // Ana's missed day is excused (sick) — demonstrates the lenient rule.
    const ana = this.students.find((s) => s.student_no === '2024-0318');
    if (ana) {
      const excDay = new Date();
      excDay.setDate(excDay.getDate() - 2);
      this.excuses.push({
        id: this.excuseSeq++,
        studentId: ana.id,
        excuseDate: dayKey(excDay),
        category: 'SICK',
        note: 'Flu — adviser approved',
      });
    }

    // Pre-seed badges for past periods that can NEVER collide with a CURRENT
    // window key (this week / this month / this quarter / this school year) —
    // otherwise mockBadgeSummary's self-heal would treat the stored row as
    // stale and delete it (e.g. a monthly row keyed to the current quarter's
    // start looks like a wrong quarter badge). Walk back until the key is
    // clear, so the sample Silver/Gold badges persist across scans.
    const seedYear = this.schoolYears[0]?.name ?? '2026 - 2027';
    const curKeys = new Set(currentBadgePeriods(this.currentYearName(), new Date()).map((p) => p.key));
    let seedMonthKey = dayKey(addMonths(monthStart(new Date()), -1));
    while (curKeys.has(seedMonthKey)) seedMonthKey = dayKey(addMonths(parseDay(seedMonthKey), -1));
    let seedQuarterKey = dayKey(quarterStart(addMonths(new Date(), -3)));
    while (curKeys.has(seedQuarterKey)) seedQuarterKey = dayKey(addMonths(parseDay(seedQuarterKey), -3));
    const seededBadges: Array<{ studentId: number; badgeCode: BadgeCode; periodStart: string }> = [];
    const juan = this.students.find((s) => s.student_no === '2024-0112');
    const maria = this.students.find((s) => s.student_no === '2024-0113');
    if (juan) {
      seededBadges.push(
        { studentId: juan.id, badgeCode: 'ATT_M', periodStart: seedMonthKey },
        { studentId: juan.id, badgeCode: 'PUNCT_M', periodStart: seedMonthKey },
        { studentId: juan.id, badgeCode: 'ATT_Q', periodStart: seedQuarterKey },
      );
    }
    if (maria) seededBadges.push({ studentId: maria.id, badgeCode: 'ATT_M', periodStart: seedMonthKey });
    for (const sb of seededBadges) {
      this.badges.push({
        id: this.badgeSeq++,
        studentId: sb.studentId,
        schoolYear: seedYear,
        badgeCode: sb.badgeCode,
        periodStart: sb.periodStart,
        earnedAt: new Date().toISOString(),
      });
    }
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

  // ---- Network database connection (browser demo: always "connected") -----
  async getDbConfig(): Promise<DbConfigInfo> {
    return {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      database: 'tapin_school',
      hasSavedPassword: false,
      isSaved: false,
      source: 'env',
      online: true,
    };
  }

  async connectDb(_input: DbConfigInput): Promise<DbConnectResult> {
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true };
  }

  async resetDbConfig(): Promise<DbConnectResult> {
    return { ok: true };
  }

  /**
   * Builds the kiosk guardian day report for EVERY child sharing the guardian
   * identity (mirrors the backend). Only active children are listed.
   */
  private guardianReport(guardians: Student[]): ScanResult {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const active = guardians.filter((s) => s.is_active);
    const children: GuardianChildReport[] = active.map((s) => {
      const today = this.logs
        .filter((l) => l.student_id === s.id && new Date(l.scanned_at).toDateString() === now.toDateString())
        .sort((a, b) => (a.scanned_at < b.scanned_at ? -1 : 1));
      return {
        studentId: s.id,
        studentNo: s.student_no,
        fullName: s.full_name,
        gradeSection: s.grade_section,
        scans: today.map((l) => {
          const at = new Date(l.scanned_at);
          return {
            time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
            entryType: l.entry_type,
            flag: this.flagFor(l.entry_type, at),
            source: l.source,
          };
        }),
        present: today.length > 0,
      };
    });
    const report: GuardianDayReport = {
      guardianName: guardians[0]?.guardian_name ?? '',
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      children,
    };
    return {
      kind: 'GUARDIAN',
      message: 'Guardian verified \u2014 here is today\u2019s attendance report.',
      student: active[0],
      guardianReport: report,
    };
  }

  async processScan(payload: string, _source: ScanSource): Promise<ScanResult> {
    await new Promise((r) => setTimeout(r, 450));
    const trimmed = payload.trim();
    const student = this.students.find(
      (s) => s.qr_hash_payload === trimmed || s.student_no === trimmed,
    );
    if (!student) {
      // Visitor QR (VP-…)? Walk-in gate pass — its own IN/OUT log + toggle,
      // separate from student attendance (mirrors electron/services/visitors.ts).
      if (trimmed.startsWith('VP-')) {
        const visitor = this.visitors.find((v) => v.qr_hash_payload === trimmed);
        if (!visitor) {
          const r: ScanResult = {
            kind: 'UNRECOGNIZED',
            message: 'Unrecognized visitor QR code. Please register at the gate.',
          };
          this.scanCbs.forEach((cb) => cb(r));
          return r;
        }
        if (!visitor.is_active) {
          const r: ScanResult = {
            kind: 'BLOCKED',
            message: 'Visitor access restricted. Please contact the admin office.',
            visitor,
          };
          this.scanCbs.forEach((cb) => cb(r));
          return r;
        }
        const last = this.lastScanByVisitor.get(visitor.id);
        const now = Date.now();
        if (last && now - last.time < this.settings.debounce_seconds * 1000) {
          const wait = Math.max(1, Math.ceil((this.settings.debounce_seconds * 1000 - (now - last.time)) / 1000));
          const r: ScanResult = { kind: 'DUPLICATE', message: `QR already scanned — please wait ${wait}s.`, visitor };
          this.scanCbs.forEach((cb) => cb(r));
          return r;
        }
        const entryType: EntryType = last?.type === 'IN' ? 'OUT' : 'IN';
        this.lastScanByVisitor.set(visitor.id, { time: now, type: entryType });
        const at = new Date();
        const vlog = {
          id: this.visitorLogSeq++,
          visitor_id: visitor.id,
          entry_type: entryType,
          source: _source,
          scanned_at: at.toISOString(),
        };
        this.visitorLogs.push(vlog);
        const r: ScanResult = {
          kind: 'VISITOR',
          message: entryType === 'IN' ? 'Visitor checked IN' : 'Visitor checked OUT',
          visitor,
          entryType,
          log: {
            id: vlog.id,
            student_id: 0, // not a student
            entry_type: entryType,
            scanned_at: at.toISOString(),
            source: _source,
            flag: '',
          },
        };
        this.scanCbs.forEach((cb) => cb(r));
        return r;
      }
      // Guardian QR (GP-…)? No attendance recorded — show the day report for
      // every child sharing this guardian identity.
      const guardians = this.students.filter((s) => s.guardian_qr_hash_payload === trimmed);
      if (guardians.length) {
        if (!guardians.some((s) => s.is_active)) {
          const r: ScanResult = {
            kind: 'BLOCKED',
            message: 'Access restricted. Please report to the Principal / Admin Office.',
            student: guardians[0],
          };
          this.scanCbs.forEach((cb) => cb(r));
          return r;
        }
        const r = this.guardianReport(guardians);
        this.scanCbs.forEach((cb) => cb(r));
        return r;
      }
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
    // Kiosk gate-direction mode: 'auto' keeps the toggle (last scan today
    // decides); 'in'/'out' force every scan to that entry type — mirrors the
    // real backend (electron/services/attendance.ts).
    const entryType: EntryType =
      this.scanMode === 'in' ? 'IN' : this.scanMode === 'out' ? 'OUT' : last?.type === 'IN' ? 'OUT' : 'IN';
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

  async getScanMode(): Promise<ScanMode> {
    return this.scanMode;
  }

  async setScanMode(mode: ScanMode): Promise<ScanMode> {
    this.scanMode = mode === 'in' || mode === 'out' ? mode : 'auto';
    return this.scanMode;
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
    const user = this.users.find((u) => u.username === username.trim());
    // Only admin accounts open the dashboard; staff use the kiosk PIN.
    if (user?.role === 'admin' && user.password === password) return { ok: true, role: 'admin' };
    return { ok: false, error: 'Invalid username or password.' };
  }

  async logout(): Promise<void> {
    // No-op in mock mode — the renderer owns the session.
  }

  async listUsers(): Promise<User[]> {
    return this.users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      has_pin: !!u.pin,
      created_at: u.created_at,
    }));
  }

  async createUser(input: UserInput): Promise<User> {
    const username = String(input?.username ?? '').trim();
    if (!username) throw new Error('Username is required.');
    if (this.users.some((u) => u.username === username)) throw new Error(`Username "${username}" is already taken.`);
    const role: UserRole = input?.role === 'staff' ? 'staff' : 'admin';
    let password = '';
    let pin: string | null = null;
    if (role === 'admin') {
      password = String(input?.password ?? '');
      if (password.length < 4) throw new Error('Admin users need a password (min 4 characters).');
      const digits = String(input?.pin ?? '').replace(/\D/g, '');
      if (digits && (digits.length < 4 || digits.length > 8)) throw new Error('Kiosk PIN must be 4-8 digits.');
      if (digits) pin = digits;
    } else {
      pin = String(input?.pin ?? '').replace(/\D/g, '');
      if (!pin || pin.length < 4 || pin.length > 8) throw new Error('Kiosk PIN must be 4-8 digits.');
    }
    const user = {
      id: this.userSeq++,
      username,
      password,
      role,
      pin,
      created_at: new Date().toISOString(),
    };
    this.users.push(user);
    return { id: user.id, username: user.username, role: user.role, has_pin: !!user.pin, created_at: user.created_at };
  }

  async updateUser(id: number, patch: Partial<UserInput>): Promise<User> {
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new Error('User not found.');

    // Validate everything BEFORE mutating so a rejected update never leaves the
    // in-memory user half-changed (mirrors the backend's pre-commit checks).
    const nextUsername = 'username' in patch ? String(patch.username ?? '').trim() : user.username;
    if (!nextUsername) throw new Error('Username is required.');
    if (this.users.some((u) => u.username === nextUsername && u.id !== id)) {
      throw new Error(`Username "${nextUsername}" is already taken.`);
    }
    const nextRole: UserRole = 'role' in patch ? (patch.role === 'staff' ? 'staff' : 'admin') : user.role;
    if (nextRole === 'admin') {
      const nextPassword = 'password' in patch ? String(patch.password ?? '') : '';
      const keepCurrent = !nextPassword && !!user.password;
      if (!keepCurrent && nextPassword.length < 4) throw new Error('Admin users need a password (min 4 characters).');
    }
    if ('password' in patch && !('role' in patch)) {
      const password = String(patch.password ?? '');
      if (password && password.length < 4) throw new Error('Password must be at least 4 characters.');
    }
    const pinCleared = 'pin' in patch && !String(patch.pin ?? '').replace(/\D/g, '');
    const nextPin =
      'pin' in patch && !pinCleared ? String(patch.pin ?? '').replace(/\D/g, '') : pinCleared ? null : user.pin;
    if (nextPin && (nextPin.length < 4 || nextPin.length > 8)) throw new Error('Kiosk PIN must be 4-8 digits.');
    if (nextRole === 'staff' && !nextPin) throw new Error('Staff users need a 4-8 digit kiosk PIN.');

    // All valid — apply.
    user.username = nextUsername;
    if ('role' in patch) {
      if (nextRole === 'admin') {
        const pw = 'password' in patch ? String(patch.password ?? '') : '';
        if (pw) user.password = pw;
      }
      user.role = nextRole;
    }
    if ('password' in patch && !('role' in patch)) {
      const pw = String(patch.password ?? '');
      if (pw) user.password = pw;
    }
    if ('pin' in patch) user.pin = nextPin;

    return { id: user.id, username: user.username, role: user.role, has_pin: !!user.pin, created_at: user.created_at };
  }

  async deleteUser(id: number): Promise<void> {
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new Error('User not found.');
    if (user.role === 'admin' && this.users.filter((u) => u.role === 'admin').length <= 1) {
      throw new Error('Cannot delete the last admin account.');
    }
    this.users = this.users.filter((u) => u.id !== id);
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

  /** Mirrors the real backend's generateStudentNo (electron/ipc.ts). */
  private nextStudentNo(): string {
    const year = new Date().getFullYear();
    const prefix = `${year}-`;
    const seqs = this.students
      .map((s) => s.student_no)
      .filter((n) => n.startsWith(prefix))
      .map((n) => parseInt(n.slice(prefix.length), 10))
      .filter((n) => Number.isInteger(n));
    const max = seqs.length ? Math.max(...seqs) : 0;
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  }

  async createStudent(input: StudentInput): Promise<Student> {
    // Auto-generate the student number when the Add form leaves it blank.
    const studentNo = String(input.student_no ?? '').trim() || this.nextStudentNo();
    // Guardian snapshot (mirrors ipc.ts): a linked guardian supplies the SMS
    // number, name, address, and QR; legacy free-text fields are the fallback.
    let guardianId: number | null = null;
    let guardianName = String(input.guardian_name ?? '').trim();
    let guardianAddress = String(input.guardian_address ?? '').trim();
    let guardianPhone = input.parent_phone || '';
    let guardianQr: string | null = guardianName ? mockGuardianPayload(guardianName, guardianAddress) : null;
    if (input.guardian_id) {
      const g = this.guardians.find((x) => x.id === input.guardian_id);
      if (!g) throw new Error('Selected guardian no longer exists.');
      guardianId = g.id;
      guardianName = g.full_name;
      guardianAddress = g.address;
      guardianPhone = g.mobile;
      guardianQr = g.qr_hash_payload;
    }
    // students.grade_section is the CURRENT year's live section — a student
    // enrolled into a past year starts unassigned this year (mirrors ipc.ts).
    const year = (input.school_year || '').trim() || this.currentYearName();
    const isCurrent = year ? (this.schoolYears.find((y) => y.name === year)?.is_current ?? false) : false;
    const s: Student = {
      id: this.idSeq++,
      student_no: studentNo,
      qr_hash_payload: mockPayload(studentNo),
      full_name: input.full_name,
      gender: normalizeGender(input.gender),
      grade_section: isCurrent ? (input.grade_section || '') : '',
      parent_phone: guardianPhone,
      lrn: String(input.lrn ?? '').trim(),
      guardian_name: guardianName,
      guardian_address: guardianAddress,
      guardian_qr_hash_payload: guardianQr,
      guardian_id: guardianId,
      photo_url: input.photo_url ?? null,
      is_active: input.is_active ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
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
    // Optimistic lock parity (mirrors ipc.ts): refuse to overwrite a student
    // saved by someone else since this form loaded.
    if (input.updated_at !== undefined && String(input.updated_at) !== s.updated_at) {
      throw new Error('This student was changed by someone else. Reload to see the latest version.');
    }
    // school_year is an enrollment hint, not a student column — keep it off the row.
    const { school_year, ...studentFields } = input;
    const prevSection = s.grade_section;
    // guardian_id is handled explicitly below (snapshot derivation) — keep it
    // out of the blanket merge so legacy fields can't fight the registry link.
    const { guardian_id, ...restFields } = studentFields;
    Object.assign(s, restFields);
    // Guardian link lifecycle (mirrors ipc.ts): linking a guardian copies its
    // identity onto the student; clearing the link (guardian_id: null) also
    // clears the SMS number + guardian QR.
    if ('guardian_id' in input) {
      const gid = input.guardian_id ? Number(input.guardian_id) : null;
      if (gid && Number.isInteger(gid)) {
        const g = this.guardians.find((x) => x.id === gid);
        if (!g) throw new Error('Selected guardian no longer exists.');
        s.guardian_id = g.id;
        s.parent_phone = g.mobile;
        s.guardian_name = g.full_name;
        s.guardian_address = g.address;
        s.guardian_qr_hash_payload = g.qr_hash_payload;
      } else {
        s.guardian_id = null;
        s.parent_phone = '';
        s.guardian_name = '';
        s.guardian_address = '';
        s.guardian_qr_hash_payload = null;
      }
    } else if ('guardian_name' in input || 'guardian_address' in input) {
      // Legacy Guardian QR lifecycle (mirrors ipc.ts): the payload hashes the
      // guardian identity, so editing name/address re-issues it; clearing the
      // name removes it.
      const name = String(input.guardian_name ?? s.guardian_name ?? '').trim();
      const address = String(input.guardian_address ?? s.guardian_address ?? '').trim();
      if (name) s.guardian_qr_hash_payload = mockGuardianPayload(name, address);
      else s.guardian_qr_hash_payload = null;
    }
    if ('gender' in input) s.gender = normalizeGender(input.gender);
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
    s.updated_at = new Date().toISOString();
    return { ...s };
  }

  async deleteStudent(id: number): Promise<void> {
    this.students = this.students.filter((s) => s.id !== id);
    this.enrollments = this.enrollments.filter((e) => e.studentId !== id);
  }

  async generateQrPayload(studentNo: string): Promise<string> {
    return mockPayload(studentNo);
  }

  // ---- Guardians (registry + duplicate-name registration flow) -------------
  async listGuardians(search?: string): Promise<Guardian[]> {
    const list = [...this.guardians];
    if (search) {
      const q = search.toLowerCase();
      return list.filter(
        (g) => g.full_name.toLowerCase().includes(q) || g.mobile.includes(q) || g.address.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  async findGuardiansByName(name: string): Promise<Guardian[]> {
    const n = String(name ?? '').trim().toLowerCase();
    return this.guardians.filter((g) => g.full_name.trim().toLowerCase() === n);
  }

  async createGuardian(input: GuardianInput, opts?: { allowSameName?: boolean }): Promise<GuardianWriteResult> {
    const fullName = String(input.full_name ?? '').trim();
    if (!fullName) throw new Error('Guardian name is required.');
    const mobile = String(input.mobile ?? '').trim();
    const address = String(input.address ?? '').trim();
    if (!opts?.allowSameName) {
      const existing = this.guardians.find((g) => g.full_name.trim().toLowerCase() === fullName.toLowerCase());
      if (existing) return { outcome: 'duplicate', existing: { ...existing } };
    }
    const payload = mockGuardianPayload(fullName, address);
    const sameIdentity = this.guardians.find((g) => g.qr_hash_payload === payload);
    if (sameIdentity) return { outcome: 'duplicate', existing: { ...sameIdentity } };
    const g: Guardian = {
      id: this.guardianSeq++,
      full_name: fullName,
      mobile,
      address,
      qr_hash_payload: payload,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.guardians.push(g);
    return { outcome: 'created', guardian: { ...g } };
  }

  async updateGuardian(
    id: number,
    patch: Partial<GuardianInput & { is_active?: boolean; updated_at?: string }>,
    opts?: { allowSameName?: boolean },
  ): Promise<GuardianWriteResult> {
    const g = this.guardians.find((x) => x.id === id);
    if (!g) throw new Error('Guardian not found.');
    // Optimistic lock parity (mirrors guardians.ts): refuse to overwrite a
    // guardian saved by someone else since this form loaded.
    if (patch.updated_at !== undefined && String(patch.updated_at) !== g.updated_at) {
      throw new Error('This guardian was changed by someone else. Reload to see the latest version.');
    }
    const nextName = patch.full_name !== undefined ? String(patch.full_name).trim() : g.full_name;
    const nextMobile = patch.mobile !== undefined ? String(patch.mobile).trim() : g.mobile;
    const nextAddress = patch.address !== undefined ? String(patch.address).trim() : g.address;
    const nextActive = patch.is_active !== undefined ? patch.is_active : g.is_active;
    if (!nextName) throw new Error('Guardian name is required.');
    // Only prompt when the name actually changes — editing a same-named
    // guardian's mobile/address alone must not re-trigger the duplicate check.
    if (!opts?.allowSameName && nextName.trim().toLowerCase() !== g.full_name.trim().toLowerCase()) {
      const other = this.guardians.find(
        (x) => x.id !== id && x.full_name.trim().toLowerCase() === nextName.toLowerCase(),
      );
      if (other) return { outcome: 'duplicate', existing: { ...other } };
    }
    const payload = mockGuardianPayload(nextName, nextAddress);
    const sameIdentity = this.guardians.find((x) => x.id !== id && x.qr_hash_payload === payload);
    if (sameIdentity) return { outcome: 'duplicate', existing: { ...sameIdentity } };
    g.full_name = nextName;
    g.mobile = nextMobile;
    g.address = nextAddress;
    g.qr_hash_payload = payload;
    g.is_active = nextActive;
    g.updated_at = new Date().toISOString();
    // Re-sync the denormalized snapshot onto every linked student.
    for (const s of this.students) {
      if (s.guardian_id === id) {
        s.parent_phone = g.mobile;
        s.guardian_name = g.full_name;
        s.guardian_address = g.address;
        s.guardian_qr_hash_payload = g.qr_hash_payload;
      }
    }
    return { outcome: 'updated', guardian: { ...g } };
  }

  async deleteGuardian(id: number): Promise<void> {
    this.guardians = this.guardians.filter((g) => g.id !== id);
    // Unlink students — their saved snapshot stays (mirrors the backend).
    for (const s of this.students) {
      if (s.guardian_id === id) s.guardian_id = null;
    }
  }

  async importStudentsCsv(csv: string): Promise<ImportResult> {
    const result: ImportResult = { added: 0, skipped: 0, errors: [] };
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const start = lines[0]?.toLowerCase().includes('student_no') ? 1 : 0;
    // Locate the gender column by header name when a header is present so it
    // can live anywhere in the file (docs put it last); legacy files without
    // a gender column fall back to ''; headerless files that append gender as
    // an 8th column keep working positionally.
    let genderIdx = -1;
    if (start === 1) {
      genderIdx = lines[0]
        .toLowerCase()
        .split(',')
        .map((c) => c.trim())
        .indexOf('gender');
    }
    for (let i = start; i < lines.length; i++) {
      const parts = lines[i].split(',');
      const [studentNo, fullName, gradeSection, phone, lrn, guardianName, guardianAddress] = parts;
      const gender = normalizeGender(genderIdx >= 0 ? parts[genderIdx] : parts.length > 7 ? parts[7] : undefined);
      if (!studentNo || !fullName) {
        result.errors.push(`Row ${i + 1}: missing student_no or full_name`);
        result.skipped++;
        continue;
      }
      if (this.students.some((s) => s.student_no === studentNo)) {
        result.skipped++;
        continue;
      }
      // Rows that name a guardian AUTO-REGISTER it (find-or-create by name +
      // address) and link the student — bulk import runs no duplicate prompt.
      const gName = String(guardianName ?? '').trim();
      const gAddress = String(guardianAddress ?? '').trim();
      let gid: number | null = null;
      if (gName) {
        let g = this.guardians.find(
          (x) =>
            x.full_name.trim().toLowerCase() === gName.toLowerCase() &&
            x.address.trim().toLowerCase() === gAddress.toLowerCase(),
        );
        if (!g) {
          const res = await this.createGuardian({ full_name: gName, mobile: phone ?? '', address: gAddress });
          if (res.outcome === 'created') g = res.guardian;
          else if (res.outcome === 'duplicate') g = res.existing;
          else throw new Error('Unexpected guardian write outcome.');
        }
        gid = g.id;
      }
      await this.createStudent({
        student_no: studentNo,
        full_name: fullName,
        gender,
        grade_section: gradeSection ?? '',
        parent_phone: phone ?? '',
        lrn: lrn ?? '',
        guardian_name: guardianName ?? '',
        guardian_address: guardianAddress ?? '',
        guardian_id: gid,
      });
      result.added++;
    }
    return result;
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
    // Chronological log: newest record first (the # column is the record id).
    rows.sort((a, b) => b.id - a.id);
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
    // Created-date range (inclusive YYYY-MM-DD) — mirrors real listSms.
    if (filter.from) rows = rows.filter((r) => r.created_at.slice(0, 10) >= filter.from!);
    if (filter.to) rows = rows.filter((r) => r.created_at.slice(0, 10) <= filter.to!);
    // Newest first (the # column is the record id) — mirrors real listSms.
    rows.sort((a, b) => b.id - a.id);
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

  async getSettings(): Promise<Settings> {
    return { ...this.settings };
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    // Mirror the Electron main process: the last-run guard is service-owned.
    // Only an ACTUAL frequency change re-arms the schedule for the new period
    // (the Settings page sends the full object on every save); otherwise a
    // stale renderer copy must not re-trigger/suppress a send.
    if (
      'adviser_report_frequency' in patch &&
      patch.adviser_report_frequency !== this.settings.adviser_report_frequency
    ) {
      patch.adviser_report_last_run = '';
    } else {
      delete patch.adviser_report_last_run;
    }
    this.settings = { ...this.settings, ...patch };
    this.emitStatus();
    return { ...this.settings };
  }

  async getJobsConfig(): Promise<JobsConfig> {
    return { runScheduledJobs: this.runScheduledJobs };
  }

  async setRunScheduledJobs(active: boolean): Promise<JobsConfig> {
    this.runScheduledJobs = Boolean(active);
    return { runScheduledJobs: this.runScheduledJobs };
  }

  async verifyStaffPin(pin: string): Promise<boolean> {
    const actual = String(pin ?? '').trim();
    return this.users.some((u) => !!u.pin && u.pin === actual);
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
      // Optimistic lock parity (mirrors ipc.ts): refuse to overwrite a section
      // saved by someone else since this form loaded.
      if (input.updated_at !== undefined && String(input.updated_at) !== existing.updated_at) {
        throw new Error('This section was changed by someone else. Reload to see the latest version.');
      }
      existing.grade = grade;
      existing.section = section;
      existing.adviser_name = (input.adviser_name || '').trim();
      existing.email = (input.email || '').trim();
      existing.updated_at = new Date().toISOString();
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
      updated_at: new Date().toISOString(),
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

  // ---- Announcements (kiosk idle slideshow) --------------------------------
  private toAnnouncement(input: AnnouncementInput): Announcement {
    const media = input.media ?? null;
    const mediaType: AnnouncementMediaType = media?.startsWith('data:video/')
      ? 'video'
      : media?.startsWith('data:image/')
        ? 'image'
        : input.media_type ?? 'none';
    return {
      id: this.announcementIdSeq++,
      title: input.title || '',
      content_text: input.content_text || '',
      media_url: media,
      media_type: mediaType,
      is_active: input.is_active ?? true,
      sort_order: input.sort_order ?? 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  async listAnnouncements(): Promise<Announcement[]> {
    return [...this.announcements].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }

  async listActiveAnnouncements(): Promise<Announcement[]> {
    return this.announcements
      .filter((a) => a.is_active)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }

  async createAnnouncement(input: AnnouncementInput): Promise<Announcement> {
    const ann = this.toAnnouncement(input);
    this.announcements.push(ann);
    return { ...ann };
  }

  async updateAnnouncement(id: number, input: Partial<AnnouncementInput>): Promise<Announcement> {
    const ann = this.announcements.find((a) => a.id === id);
    if (!ann) throw new Error('Announcement not found');
    if ('title' in input) ann.title = input.title ?? '';
    if ('content_text' in input) ann.content_text = input.content_text ?? '';
    if ('is_active' in input) ann.is_active = input.is_active ?? true;
    if ('sort_order' in input) ann.sort_order = input.sort_order ?? 0;
    if ('media' in input) {
      const media = input.media ?? null;
      ann.media_url = media;
      // A data URI is a fresh upload; anything else (an existing media URL)
      // keeps the caller's stated media_type (mirrors the real backend).
      ann.media_type = media
        ? media.startsWith('data:video/')
          ? 'video'
          : media.startsWith('data:image/')
            ? 'image'
            : input.media_type ?? 'none'
        : 'none';
    }
    ann.updated_at = new Date().toISOString();
    return { ...ann };
  }

  async deleteAnnouncement(id: number): Promise<void> {
    this.announcements = this.announcements.filter((a) => a.id !== id);
  }

  // ---- Visitors (walk-in QR registration & IN/OUT logging) -----------------
  /** Joins a stored visitor log with the visitor's CURRENT profile (mirrors
   *  the backend's SQL JOIN — edits to name/purpose/host show up in history). */
  private toVisitorLogRow(l: {
    id: number;
    visitor_id: number;
    entry_type: EntryType;
    source: ScanSource;
    scanned_at: string;
  }): VisitorLogRow {
    const v = this.visitors.find((x) => x.id === l.visitor_id);
    return {
      id: l.id,
      visitor_id: l.visitor_id,
      full_name: v?.full_name ?? 'Unknown visitor',
      contact_phone: v?.contact_phone ?? '',
      purpose: v?.purpose ?? '',
      host_office: v?.host_office ?? '',
      entry_type: l.entry_type,
      source: l.source,
      scanned_at: l.scanned_at,
    };
  }

  async listVisitors(search?: string): Promise<Visitor[]> {
    let list = [...this.visitors];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((v) => v.full_name.toLowerCase().includes(q) || v.contact_phone.includes(q));
    }
    return list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  async createVisitor(input: VisitorInput): Promise<Visitor> {
    const fullName = String(input.full_name ?? '').trim();
    if (!fullName) throw new Error('Visitor name is required.');
    const id = this.visitorSeq++;
    const visitor: Visitor = {
      id,
      full_name: fullName,
      contact_phone: String(input.contact_phone ?? '').trim(),
      purpose: String(input.purpose ?? '').trim(),
      host_office: String(input.host_office ?? '').trim(),
      id_presented: String(input.id_presented ?? '').trim(),
      qr_hash_payload: mockVisitorPayload(id),
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.visitors.push(visitor);
    return { ...visitor };
  }

  async updateVisitor(id: number, patch: Partial<VisitorInput & { is_active?: boolean }>): Promise<Visitor> {
    const v = this.visitors.find((x) => x.id === id);
    if (!v) throw new Error('Visitor not found.');
    if ('full_name' in patch && patch.full_name !== undefined) v.full_name = String(patch.full_name).trim();
    if ('contact_phone' in patch && patch.contact_phone !== undefined) v.contact_phone = String(patch.contact_phone).trim();
    if ('purpose' in patch && patch.purpose !== undefined) v.purpose = String(patch.purpose).trim();
    if ('host_office' in patch && patch.host_office !== undefined) v.host_office = String(patch.host_office).trim();
    if ('id_presented' in patch && patch.id_presented !== undefined) v.id_presented = String(patch.id_presented).trim();
    if ('is_active' in patch && patch.is_active !== undefined) v.is_active = patch.is_active;
    v.updated_at = new Date().toISOString();
    return { ...v };
  }

  async deleteVisitor(id: number): Promise<void> {
    this.visitors = this.visitors.filter((v) => v.id !== id);
    this.visitorLogs = this.visitorLogs.filter((l) => l.visitor_id !== id);
    this.lastScanByVisitor.delete(id);
  }

  async listVisitorLogs(visitorId: number): Promise<VisitorLogRow[]> {
    return this.visitorLogs
      .filter((l) => l.visitor_id === visitorId)
      .map((l) => this.toVisitorLogRow(l))
      .sort((a, b) => (a.scanned_at < b.scanned_at ? 1 : -1));
  }

  async listAllVisitorLogs(filter?: { from?: string; to?: string }): Promise<VisitorLogRow[]> {
    let rows = this.visitorLogs;
    if (filter?.from) rows = rows.filter((r) => r.scanned_at.slice(0, 10) >= filter.from!);
    if (filter?.to) rows = rows.filter((r) => r.scanned_at.slice(0, 10) <= filter.to!);
    return rows.map((l) => this.toVisitorLogRow(l)).sort((a, b) => (a.scanned_at < b.scanned_at ? 1 : -1));
  }

  // ---- Badges & excused days (attendance recognition) -----------------------
  /** Mirrors electron/services/badges.ts evaluatePeriods against the mock's
   *  in-memory logs / excuses (same window math + same rules). */
  private mockEvalPeriods(studentId: number, periods: BadgePeriod[]): MockPeriodResult[] {
    const excused = new Set(this.excuses.filter((e) => e.studentId === studentId).map((e) => e.excuseDate));
    const mine = this.logs.filter((l) => l.student_id === studentId);
    const joinKey = mine.map((l) => dayKey(new Date(l.scanned_at))).sort()[0] ?? null;
    const schoolSet = new Set(this.logs.map((l) => dayKey(new Date(l.scanned_at))));
    const presentDays = new Set<string>();
    const punctMissedDays = new Set<string>();
    for (const l of mine) {
      const d = dayKey(new Date(l.scanned_at));
      presentDays.add(d);
      if (!excused.has(d) && l.flag) punctMissedDays.add(d);
    }
    return periods.map((period) => {
      const startKey = period.key;
      const endKey = dayKey(period.end);
      const inRange = (d: string) => d >= startKey && d < endKey;
      const afterJoin = (d: string) => !joinKey || d >= joinKey;
      const requiredDays = [...schoolSet].filter((d) => inRange(d) && afterJoin(d) && !excused.has(d)).length;
      const present = [...presentDays].filter((d) => inRange(d) && afterJoin(d)).length;
      const punctualityMissed = [...punctMissedDays].some((d) => inRange(d) && afterJoin(d));
      const active = requiredDays >= BADGE_MIN_SCHOOL_DAYS[period.kind];
      const attendanceComplete = active && present >= requiredDays;
      return {
        kind: period.kind,
        periodKey: period.key,
        requiredDays,
        presentDays: present,
        excusedDays: [...schoolSet].filter((d) => inRange(d) && excused.has(d)).length,
        attendanceMissed: active && !attendanceComplete,
        punctualityMissed,
        attendanceComplete,
        punctualityComplete: attendanceComplete && !punctualityMissed,
      };
    });
  }

  private mockBadgeSummary(studentId: number): StudentBadgeSummary {
    const year = this.currentYearName();
    const periods = currentBadgePeriods(year, new Date());
    const results = this.mockEvalPeriods(studentId, periods);
    const wanted: Array<{ code: BadgeCode; periodKey: string }> = [];
    for (const res of results) {
      if (res.attendanceComplete) wanted.push({ code: ATT_CODE[res.kind], periodKey: res.periodKey });
      if (res.punctualityComplete) wanted.push({ code: PUNCT_CODE[res.kind], periodKey: res.periodKey });
    }
    const want = new Map(wanted.map((w) => [`${w.code}|${w.periodKey}`, w]));
    const existing = this.badges.filter((b) => b.studentId === studentId && b.schoolYear === year);
    const have = new Set(existing.map((b) => `${b.badgeCode}|${b.periodStart}`));
    let newlyEarned: Badge | null = null;
    for (const key of want.keys()) {
      if (!have.has(key)) {
        const w = want.get(key)!;
        const b: Badge = {
          id: this.badgeSeq++,
          studentId,
          schoolYear: year,
          badgeCode: w.code,
          periodStart: w.periodKey,
          earnedAt: new Date().toISOString(),
        };
        this.badges.push(b);
        if (!newlyEarned) newlyEarned = b;
      }
    }
    // Authoritative: drop CURRENT-period rows no longer earned; past rows
    // (including pre-seeded demo badges) are left intact.
    const currentKeys = new Set(periods.map((p) => p.key));
    this.badges = this.badges.filter(
      (b) =>
        !(
          b.studentId === studentId &&
          b.schoolYear === year &&
          currentKeys.has(b.periodStart) &&
          !want.has(`${b.badgeCode}|${b.periodStart}`)
        ),
    );
    const weekRes = results.find((r) => r.kind === 'week') ?? null;
    const currentWeek: BadgeWeekProgress | null = weekRes
      ? {
          weekStart: weekRes.periodKey,
          weekEnd: dayKey(addDays(parseDay(weekRes.periodKey), 6)),
          requiredDays: weekRes.requiredDays,
          presentDays: weekRes.presentDays,
          excusedDays: weekRes.excusedDays,
          attendanceMissed: weekRes.attendanceMissed,
          punctualityMissed: weekRes.punctualityMissed,
          attendanceComplete: weekRes.attendanceComplete,
          punctualityComplete: weekRes.punctualityComplete,
        }
      : null;
    return {
      badges: this.badges
        .filter((b) => b.studentId === studentId && b.schoolYear === year)
        .sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
      currentWeek,
      newlyEarned,
    };
  }

  async getStudentBadges(studentId: number): Promise<StudentBadgeSummary> {
    return this.mockBadgeSummary(Number(studentId));
  }

  async listBadges(schoolYear?: string, from?: string, to?: string): Promise<Badge[]> {
    const year = schoolYear || this.currentYearName();
    return [...this.badges].filter((b) => {
      if (b.schoolYear !== year) return false;
      if (from && b.earnedAt.slice(0, 10) < from) return false;
      if (to && b.earnedAt.slice(0, 10) > to) return false;
      return true;
    });
  }

  async badgeLeaderboard(topN = 10, section?: string, schoolYear?: string, from?: string, to?: string): Promise<BadgeLeaderboardRow[]> {
    const year = schoolYear || this.currentYearName();
    // Sections resolve through the selected school year's enrollments, falling
    // back to the live section — mirrors electron/services/badges.ts.
    const secOf = new Map(
      this.enrollments.filter((e) => e.schoolYear === year && e.gradeSection).map((e) => [e.studentId, e.gradeSection]),
    );
    const sectionFilter = (section ?? '').trim();
    const counts = new Map<number, { badgeCount: number; att: number; punct: number; score: number }>();
    for (const b of this.badges) {
      if (b.schoolYear !== year) continue;
      // Optional earned-date range (inclusive YYYY-MM-DD) — mirrors the backend.
      if (from && b.earnedAt.slice(0, 10) < from) continue;
      if (to && b.earnedAt.slice(0, 10) > to) continue;
      const info = BADGE_INFO[b.badgeCode];
      const c = counts.get(b.studentId) ?? { badgeCount: 0, att: 0, punct: 0, score: 0 };
      c.badgeCount++;
      if (b.badgeCode.startsWith('ATT')) c.att++;
      else c.punct++;
      c.score += info.points;
      counts.set(b.studentId, c);
    }
    return [...counts.entries()]
      .map(([studentId, c]) => {
        const s = this.students.find((x) => x.id === studentId);
        if (!s) return null;
        const gradeSection = secOf.get(studentId) ?? s.grade_section;
        if (sectionFilter && gradeSection !== sectionFilter) return null;
        return {
          studentId,
          fullName: s.full_name,
          gradeSection,
          studentNo: s.student_no,
          badgeCount: c.badgeCount,
          score: c.score,
          attendanceBadges: c.att,
          punctualityBadges: c.punct,
        };
      })
      .filter((r): r is BadgeLeaderboardRow => r !== null)
      .sort((a, b) => b.score - a.score || b.badgeCount - a.badgeCount || a.fullName.localeCompare(b.fullName))
      .slice(0, Math.max(1, Number(topN) || 10));
  }

  async listExcuses(studentId: number): Promise<Excuse[]> {
    return this.excuses.filter((e) => e.studentId === Number(studentId));
  }

  async addExcuse(studentId: number, excuseDate: string, category: ExcuseCategory, note?: string): Promise<Excuse> {
    const sid = Number(studentId);
    const existing = this.excuses.find((e) => e.studentId === sid && e.excuseDate === excuseDate);
    if (existing) {
      existing.category = category;
      existing.note = note || '';
      this.mockBadgeSummary(sid); // self-heal
      return { ...existing };
    }
    const e: Excuse = { id: this.excuseSeq++, studentId: sid, excuseDate, category, note: note || '' };
    this.excuses.push(e);
    this.mockBadgeSummary(sid); // self-heal
    return { ...e };
  }

  async removeExcuse(excuseId: number): Promise<void> {
    const e = this.excuses.find((x) => x.id === Number(excuseId));
    if (e) {
      this.excuses = this.excuses.filter((x) => x.id !== e.id);
      this.mockBadgeSummary(e.studentId); // self-heal
    }
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

  /** One summary stat card's student-level breakdown (mirrors the backend). */
  async getReportDrilldown(query: ReportDrilldownQuery): Promise<ReportDrilldownResult> {
    const metric = query.metric;
    const section = (query.section ?? '').trim();
    const maskPhones = !!query.maskPhones;
    const schoolYear = (query.schoolYear ?? '').trim();
    const { from, to } = query;
    const yearSection = new Map(
      this.enrollments
        .filter((e) => e.schoolYear === schoolYear && e.gradeSection)
        .map((e) => [e.studentId, e.gradeSection]),
    );
    const secOf = (s: Student) => yearSection.get(s.id) ?? s.grade_section;
    const dayOf = (iso: string) => iso.slice(0, 10);
    const pad = (n: number) => String(n).padStart(2, '0');
    const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const phone = (p: string) => (maskPhones ? mockMaskPhone(p) : p);
    const flag = (l: AttendanceLogRow) => this.flagFor(l.entry_type, new Date(l.scanned_at));
    const parseT = (raw: string) => {
      const [h, m] = String(raw || '').split(':').map(Number);
      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
    };
    const grace = Math.max(0, Number(this.settings.bell_grace_minutes) || 0);
    const lateMins = this.settings.bell_time_in ? parseT(this.settings.bell_time_in)! + grace : null;

    const logs = this.logs.filter((l) => dayOf(l.scanned_at) >= from && dayOf(l.scanned_at) <= to);
    const active = this.students.filter((s) => s.is_active && (!section || secOf(s) === section));
    const schoolDayList = [...new Set(logs.map((l) => dayOf(l.scanned_at)))];
    const schoolDays = schoolDayList.length;
    const toRow = (
      s: Student,
      value: number,
      value2?: number,
      value3?: number,
      time?: string,
    ): ReportDrilldownRow => ({
      studentId: s.id,
      studentNo: s.student_no,
      fullName: s.full_name,
      gradeSection: secOf(s),
      parentPhone: phone(s.parent_phone),
      value,
      value2,
      value3,
      time,
    });
    const byName = (a: ReportDrilldownRow, b: ReportDrilldownRow) =>
      compareGrades(a.gradeSection, b.gradeSection) || a.fullName.localeCompare(b.fullName);

    let rows: ReportDrilldownRow[] = [];
    if (metric === 'scans' || metric === 'in' || metric === 'out' || metric === 'late' || metric === 'early' || metric === 'onTime') {
      const per = new Map<
        number,
        { ins: number; outs: number; late: number; early: number; onTime: number; lateMins: number; lastIn: Date | null; lastOut: Date | null }
      >();
      for (const l of logs) {
        if (!active.some((s) => s.id === l.student_id)) continue;
        const at = new Date(l.scanned_at);
        const cur = per.get(l.student_id) ?? { ins: 0, outs: 0, late: 0, early: 0, onTime: 0, lateMins: 0, lastIn: null as Date | null, lastOut: null as Date | null };
        if (l.entry_type === 'IN') {
          cur.ins++;
          if (flag(l) === 'LATE') {
            cur.late++;
            cur.lateMins += Math.max(0, at.getHours() * 60 + at.getMinutes() - (lateMins ?? 0));
          } else cur.onTime++;
          if (!cur.lastIn || at > cur.lastIn) cur.lastIn = at;
        } else {
          cur.outs++;
          if (flag(l) === 'EARLY') cur.early++;
          if (!cur.lastOut || at > cur.lastOut) cur.lastOut = at;
        }
        per.set(l.student_id, cur);
      }
      for (const s of active) {
        const c = per.get(s.id);
        if (!c) continue;
        if (metric === 'scans') rows.push(toRow(s, c.ins + c.outs, c.ins, c.outs));
        else if (metric === 'in') rows.push(toRow(s, c.ins, undefined, undefined, c.lastIn ? hm(c.lastIn) : undefined));
        else if (metric === 'out') rows.push(toRow(s, c.outs, undefined, undefined, c.lastOut ? hm(c.lastOut) : undefined));
        else if (metric === 'late') rows.push(toRow(s, c.late, c.lateMins));
        else if (metric === 'early') rows.push(toRow(s, c.early));
        else rows.push(toRow(s, c.onTime));
      }
      if (metric === 'in' || metric === 'out') rows.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
      else rows.sort((a, b) => b.value - a.value || byName(a, b));
    } else if (metric === 'absent') {
      for (const s of active) {
        const absentDays = schoolDayList.filter(
          (d) => !logs.some((l) => l.student_id === s.id && dayOf(l.scanned_at) === d),
        ).length;
        if (absentDays > 0) rows.push(toRow(s, absentDays));
      }
      rows.sort((a, b) => b.value - a.value || byName(a, b));
    } else if (metric === 'present' || metric === 'attendance' || metric === 'atRisk') {
      for (const s of active) {
        const presentDays = new Set(logs.filter((l) => l.student_id === s.id).map((l) => dayOf(l.scanned_at))).size;
        const rate = schoolDays > 0 ? Math.round((presentDays / schoolDays) * 1000) / 10 : undefined;
        if (metric === 'present') {
          if (presentDays > 0) rows.push(toRow(s, presentDays, rate));
        } else if (metric === 'attendance') {
          rows.push(toRow(s, presentDays, schoolDays - presentDays, rate));
        } else if (rate !== undefined && rate < 80) {
          rows.push(toRow(s, rate, schoolDays - presentDays));
        }
      }
      if (metric === 'atRisk') rows.sort((a, b) => a.value - b.value || (b.value2 ?? 0) - (a.value2 ?? 0));
      else if (metric === 'attendance') rows.sort((a, b) => (b.value3 ?? -1) - (a.value3 ?? -1));
      else rows.sort((a, b) => (b.value2 ?? 0) - (a.value2 ?? 0) || byName(a, b));
    } else if (metric === 'sms') {
      const smsInRange = this.sms.filter((s) => dayOf(s.created_at) >= from && dayOf(s.created_at) <= to);
      const smsForStudent = new Map<number, number>();
      for (const sm of smsInRange) {
        const linked = sm.attendance_id != null ? this.logs.find((l) => l.id === sm.attendance_id) : undefined;
        const sid = linked
          ? linked.student_id
          : this.students.find((s) => s.is_active && s.parent_phone && s.parent_phone === sm.parent_phone)?.id;
        if (sid) smsForStudent.set(sid, (smsForStudent.get(sid) ?? 0) + 1);
      }
      for (const s of active) {
        const c = smsForStudent.get(s.id);
        if (c) rows.push(toRow(s, c));
      }
      rows.sort((a, b) => b.value - a.value || byName(a, b));
    }

    return { metric, from, to, rows };
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

async testEmail(to: string, _settings: Settings): Promise<EmailResult> {
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
    return { valid: true, message: `Activated ${licenseKey} (browser mock)`, machineId: 'browser-mock' };
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
