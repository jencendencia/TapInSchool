// ---------------------------------------------------------------------------
// Shared type contract between the Electron main process, the preload bridge,
// and the React renderer. Keep this file dependency-free.
// ---------------------------------------------------------------------------

export type EntryType = 'IN' | 'OUT';
export type SmsStatus = 'PENDING' | 'SENT' | 'FAILED';
export type ScanSource = 'SCANNER' | 'WEBCAM' | 'MANUAL';

/** Attendance quality flag derived from bell times ('' when on time). */
export type AttendanceFlag = '' | 'LATE' | 'EARLY';

/** How the student photo renders on the kiosk scan-result card. */
export type KioskPhotoStyle = 'avatar' | 'zoom' | 'fullbleed';

export type ScanResultKind =
  | 'SUCCESS'
  | 'BLOCKED'
  | 'UNRECOGNIZED'
  | 'DUPLICATE'
  | 'OFFLINE'
  | 'ERROR';

export interface Student {
  id: number;
  student_no: string;
  qr_hash_payload: string;
  full_name: string;
  grade_section: string;
  parent_phone: string;
  /** URL or inline data URI of the uploaded student photo (resized thumbnail). */
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface StudentInput {
  student_no: string;
  full_name: string;
  grade_section: string;
  parent_phone: string;
  /** URL or inline data URI of the uploaded student photo (resized thumbnail). */
  photo_url?: string | null;
  is_active?: boolean;
  /**
   * School year to record the enrollment in (defaults to the current year).
   * Only the CURRENT year's enrollment is mirrored onto students.grade_section
   * (the live section); editing a past year only touches that year's history.
   */
  school_year?: string;
}

export interface AttendanceLog {
  id: number;
  student_id: number;
  entry_type: EntryType;
  scanned_at: string;
  source: ScanSource;
  /** LATE (IN after bell_time_in + grace) / EARLY (OUT before bell_time_out). */
  flag: AttendanceFlag;
}

export interface AttendanceLogRow extends AttendanceLog {
  full_name: string;
  student_no: string;
  grade_section: string;
}

export interface SmsLog {
  id: number;
  /** Null for non-attendance alerts (e.g. automated absence SMS). */
  attendance_id: number | null;
  parent_phone: string;
  message: string;
  status: SmsStatus;
  provider: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface SmsLogRow extends SmsLog {
  full_name: string | null;
  entry_type: EntryType | null;
  scanned_at: string | null;
}

export interface ScanResult {
  kind: ScanResultKind;
  message: string;
  student?: Student;
  entryType?: EntryType;
  log?: AttendanceLog;
  smsQueued?: boolean;
  parentPhoneMasked?: string;
  /** True when the scan was accepted while MySQL was offline and queued for sync. */
  queuedOffline?: boolean;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export type SmsProviderId = 'simulator' | 'gsm' | 'cloud';

export type CloudProviderId = 'semaphore' | 'messagebird' | 'philsms' | 'generic';

export interface Settings {
  school_name: string;
  /** URL or inline data URI of the uploaded school logo (resized thumbnail). */
  logo_url: string | null;
  show_photos: boolean;
  debounce_seconds: number;
  sms_provider: SmsProviderId;
  gsm_com_port: string;
  gsm_baud: number;
  /** When true, the GSM provider locates the modem by probing serial ports. */
  gsm_auto_port: boolean;
  /** Kiosk scan-result photo layout: round avatar / zoomed square / full-bleed. */
  kiosk_photo_style: KioskPhotoStyle;
  cloud_provider: CloudProviderId;
  cloud_api_key: string;
  cloud_sender: string;
  cloud_endpoint: string;
  sms_template: string;
  /** Bell / attendance-intelligence settings (Phase 2, 4.1 + 4.2). */
  bell_time_in: string;
  bell_time_out: string;
  bell_grace_minutes: number;
  absence_detect: boolean;
  absence_sms: boolean;
  /** Internal: last date (YYYY-MM-DD) the absence detector ran. */
  absence_last_run: string;

  // ---- Report email delivery (SMTP) -------------------------------------
  smtp_host: string;
  /** SMTP port — 587 (STARTTLS) is the default; 465 pairs with smtp_secure. */
  smtp_port: number;
  /** True = implicit TLS (usually port 465); false = STARTTLS (port 587). */
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  /** Allow self-signed TLS certs — needed for some on-prem school mail servers. */
  smtp_allow_self_signed: boolean;
  /** From header — falls back to smtp_user when blank. */
  email_from: string;
  /** Report recipient(s), comma or semicolon separated. */
  email_recipient: string;
}

export interface ProviderStatus {
  provider: SmsProviderId;
  online: boolean;
  detail: string;
}

export interface SystemStatus {
  db: { online: boolean; detail: string };
  sms: ProviderStatus;
  /** Offline scans still waiting to be replayed into MySQL. */
  queue: { pending: number };
}

export interface ActivityItem {
  id: number;
  full_name: string;
  grade_section: string;
  student_no: string;
  entry_type: EntryType;
  scanned_at: string;
  source: ScanSource;
  sms_status: SmsStatus | null;
  parent_phone: string | null;
  flag: AttendanceFlag;
}

export interface OverviewStats {
  todayTotal: number;
  todayIn: number;
  todayOut: number;
  activeStudents: number;
  totalStudents: number;
  smsSentToday: number;
  smsPendingToday: number;
  smsFailedToday: number;
  /** IN scans after bell_time_in + grace today. */
  lateToday: number;
  /** OUT scans before bell_time_out today. */
  earlyToday: number;
  /** Active students with no scan today ("not scanned yet" live view). */
  absentToday: number;
  hourlyToday: { hour: number; in: number; out: number }[];
  last7Days: { date: string; total: number }[];
}

export interface Paged<T> {
  rows: T[];
  total: number;
}

export interface ImportResult {
  added: number;
  skipped: number;
  errors: string[];
}

export interface LogFilter {
  search?: string;
  from?: string;
  to?: string;
  entryType?: EntryType;
  limit?: number;
  offset?: number;
}

export interface SmsFilter {
  status?: SmsStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

// ---- Reports (admin → PDF / Excel / email export) -------------------------

export type ReportType =
  | 'summary'
  | 'register'
  | 'per-student'
  | 'per-section'
  | 'absentee'
  | 'tardiness'
  | 'sms-audit'
  | 'trends'
  | 'student';

export interface ReportQuery {
  /** Inclusive start date, YYYY-MM-DD. */
  from: string;
  /** Inclusive end date, YYYY-MM-DD. */
  to: string;
  /** Which report section to build (controls which payloads are populated). */
  type?: ReportType;
  /** Optional exact grade_section filter for the student-level lists. */
  section?: string;
  /** Mask parent phone numbers in the returned data (applies to exports too). */
  maskPhones?: boolean;
  /**
   * School year the section groupings should reflect (students appear under
   * the section they were enrolled in that year). Empty = current sections.
   */
  schoolYear?: string;
  /** Required for type 'student' — whose full attendance record to build. */
  studentId?: number;
}

export interface ReportDailyRow {
  day: string;
  scans: number;
  in: number;
  out: number;
  /** Live-computed IN-after-cutoff scans that day. */
  late: number;
  /** Live-computed OUT-before-dismissal scans that day. */
  early: number;
  /** Active students with zero scans that day (scan-derived; 0 on non-gate days). */
  absent: number;
  /** Distinct students with ≥1 scan that day (gate-used days only). */
  present: number;
}

export interface PerStudentRow {
  studentId: number;
  studentNo: string;
  fullName: string;
  gradeSection: string;
  parentPhone: string;
  /** Distinct days with ≥1 scan. */
  daysPresent: number;
  /** Distinct days with ≥1 flagged-late IN (a second IN after returning also flags the day). */
  daysLate: number;
  /** schoolDays − daysPresent (≥ 0). */
  daysAbsent: number;
  /** daysPresent / schoolDays × 100; null when there are no school days. */
  attendanceRate: number | null;
  totalIn: number;
  totalOut: number;
  /** Sum of minutes past the cutoff on flagged IN scans. */
  totalMinutesLate: number;
  smsCount: number;
  /** Status of that student's most recent SMS in range (null when none). */
  lastSmsStatus: SmsStatus | null;
}

export interface PerSectionRow {
  gradeSection: string;
  /** Active students in the section. */
  enrolled: number;
  /** Distinct students with ≥1 scan in the range. */
  present: number;
  /** Distinct active students with zero scans. */
  absent: number;
  /** Distinct students with ≥1 flagged-late IN. */
  late: number;
  /** Distinct students with ≥1 flagged-early OUT. */
  early: number;
  /** Σ daily present / (enrolled × schoolDays) × 100; null when undefined. */
  attendanceRate: number | null;
}

/** One (student, day) cell in the SF2-style register matrix. */
export interface RegisterRow {
  studentId: number;
  /** YYYY-MM-DD. */
  day: string;
  /** First IN time 'HH:MM' or null (no IN scan that day). */
  firstIn: string | null;
  /** Last OUT time 'HH:MM' or null. */
  lastOut: string | null;
}

export interface ReportRegister {
  windowFrom: string;
  windowTo: string;
  /** True when the requested range exceeded the 35-day matrix cap. */
  capped: boolean;
  /** Gate-used (school) days inside the window. */
  days: string[];
  students: { studentId: number; studentNo: string; fullName: string; gradeSection: string }[];
  rows: RegisterRow[];
}

export interface AbsenteeRow {
  studentId: number;
  studentNo: string;
  fullName: string;
  gradeSection: string;
  parentPhone: string;
  /** YYYY-MM-DD the student had zero scans on a school day. */
  day: string;
  /** Whether a scan-triggered SMS was sent for that student that day. */
  smsSent: boolean;
}

export interface AbsenteeTotalsRow {
  studentId: number;
  studentNo: string;
  fullName: string;
  gradeSection: string;
  parentPhone: string;
  /** Number of absent days for this student in the range. */
  daysAbsent: number;
}

export interface TardinessRow {
  id: number;
  studentNo: string;
  fullName: string;
  gradeSection: string;
  parentPhone: string;
  day: string;
  /** 'HH:MM' scan time. */
  scannedTime: string;
  minutesLate: number;
}

export interface TardinessFrequencyRow {
  studentId: number;
  studentNo: string;
  fullName: string;
  gradeSection: string;
  /** Number of flagged-late IN scans in the range. */
  lateCount: number;
}

/** One individual scan inside a single-student attendance record. */
export interface StudentScanRow {
  id: number;
  /** 'HH:MM' scan time. */
  time: string;
  entryType: EntryType;
  /** '' when on time. */
  flag: AttendanceFlag;
  source: ScanSource;
}

/** One calendar day inside a single-student attendance record. */
export interface StudentDayRow {
  /** YYYY-MM-DD. */
  day: string;
  /** True when the gate was used that day (≥1 scan anywhere). */
  schoolDay: boolean;
  /** The student had ≥1 scan that day. */
  present: boolean;
  /** ≥1 flagged-late IN that day. */
  late: boolean;
  /** ≥1 flagged-early OUT that day. */
  early: boolean;
  /** First IN time 'HH:MM' or null. */
  firstIn: string | null;
  /** Last OUT time 'HH:MM' or null. */
  lastOut: string | null;
  /** Every scan that day, oldest first. */
  scans: StudentScanRow[];
}

/** Full attendance record for a single student (report type 'student'). */
export interface StudentRecord {
  studentId: number;
  studentNo: string;
  fullName: string;
  /** The section they were enrolled in for the selected school year. */
  gradeSection: string;
  parentPhone: string;
  summary: {
    /** Distinct days with ≥1 scan in range. */
    daysPresent: number;
    /** Distinct days with ≥1 flagged-late IN. */
    daysLate: number;
    /** schoolDays − daysPresent (≥ 0). */
    daysAbsent: number;
    /** daysPresent / schoolDays × 100; null when no school days. */
    attendanceRate: number | null;
    totalIn: number;
    totalOut: number;
    /** Sum of minutes past the late cutoff on flagged IN scans. */
    totalMinutesLate: number;
    smsCount: number;
    lastSmsStatus: SmsStatus | null;
  };
  /** One entry per calendar day in range, oldest first. */
  days: StudentDayRow[];
}

export interface SmsAuditDay {
  day: string;
  total: number;
  sent: number;
  pending: number;
  failed: number;
}

export interface SmsFailureRow {
  id: number;
  parentPhone: string;
  fullName: string | null;
  provider: string | null;
  attempts: number;
  error: string | null;
  createdAt: string;
}

export interface WeeklyTrend {
  /** Monday of the ISO week, YYYY-MM-DD. */
  weekStart: string;
  days: number;
  /** Σ daily distinct-present across the week. */
  presentDays: number;
  attendanceRate: number | null;
}

export interface DayOfWeekTrend {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  days: number;
  presentDays: number;
  attendanceRate: number | null;
}

export interface GateHourTrend {
  hour: number;
  in: number;
  out: number;
}

export interface ReportTrends {
  weekly: WeeklyTrend[];
  dayOfWeek: DayOfWeekTrend[];
  gateHours: GateHourTrend[];
}

export interface ReportData {
  schoolName: string;
  from: string;
  to: string;
  /** School year the report's section groupings reflect ('' = current). */
  schoolYear: string;
  generatedAt: string;
  /** The section that produced this report. */
  type: ReportType;
  /** Echo of the section filter ('' = all). */
  section: string;
  /** Echo of the mask toggle (phones are already masked in the data). */
  maskPhones: boolean;
  /** Distinct grade_sections with at least one student (for filters). */
  sections: string[];
  /** Late / early cutoff 'HH:MM:SS' strings ('' when disabled). */
  cutoffs: { late: string; early: string };
  /** Echo of the student filter (type 'student'). */
  studentId?: number;
  /** Populated for type 'student' (null when no student selected). */
  studentRecord: StudentRecord | null;
  summary: {
    scans: number;
    in: number;
    out: number;
    late: number;
    early: number;
    /** Sum of scan-derived daily absences (active students with zero scans on gate-used days). */
    absent: number;
    /** Distinct students with at least one scan in the range. */
    present: number;
    sms: number;
    smsSent: number;
    /** Calendar days in the selected range. */
    days: number;
    /** Gate-used days (≥1 scan) in the range. */
    schoolDays: number;
    /** Active (enrolled) students — the attendance-% denominator. */
    activeStudents: number;
    /** Σ daily present / (activeStudents × schoolDays) × 100; null when undefined. */
    attendanceRate: number | null;
    /** Average daily attendance: Σ daily present / schoolDays. */
    ada: number | null;
    /** IN scans at/before the late cutoff. */
    onTime: number;
    onTimePct: number | null;
    latePct: number | null;
    /** Active students with attendance < 80% (DepEd at-risk threshold). */
    atRiskCount: number;
  };
  daily: ReportDailyRow[];
  /** Populated for type 'per-student'. */
  perStudent: PerStudentRow[];
  /** Populated for type 'per-section'. */
  perSection: PerSectionRow[];
  /** Populated for type 'register' (SF2-style matrix, ≤35 days). */
  register: ReportRegister;
  /** Populated for type 'absentee'. */
  absentee: AbsenteeRow[];
  /** Populated for type 'absentee' — days absent per student. */
  absenteeTotals: AbsenteeTotalsRow[];
  /** Populated for type 'tardiness'. */
  tardiness: TardinessRow[];
  /** Populated for type 'tardiness' — late count per student. */
  tardinessFrequency: TardinessFrequencyRow[];
  /** Populated for type 'sms-audit'. */
  smsAudit: { daily: SmsAuditDay[]; failures: SmsFailureRow[] };
  /** Populated for type 'trends'. */
  trends: ReportTrends;
}

export interface ExportResult {
  ok: boolean;
  filePath?: string;
  error?: string;
}

export interface EmailResult {
  ok: boolean;
  /** Success detail (e.g. recipient list). */
  message?: string;
  error?: string;
}

// ---- Sections (section registry + adviser report email delivery) -----------

/**
 * A registered grade/section. The adviser name + email are optional extras
 * used by the Reports → "Send to advisers" feature. `grade` and `section` are
 * the separated parts ("Grade 7" / "Section A"); `grade_section` is the
 * composite display key ("Grade 7 - Section A") that enrollments + students
 * join on.
 */
export interface Section {
  id: number;
  grade_section: string;
  grade: string;
  section: string;
  adviser_name: string;
  email: string;
  created_at: string;
}

export interface SectionInput {
  /** Full composite name, e.g. "Grade 7 - Section A" (the registry key). */
  grade_section: string;
  /** Grade part, e.g. "Grade 7". */
  grade: string;
  /** Section part, e.g. "Section A". */
  section: string;
  adviser_name: string;
  email: string;
}

// ---- School years & enrollments --------------------------------------------

/** A school year label (e.g. "2026 - 2027"); exactly one is current. */
export interface SchoolYear {
  id: number;
  name: string;
  is_current: boolean;
  created_at: string;
}

/** One student's section within a school year (join with students client-side). */
export interface EnrollmentRow {
  studentId: number;
  gradeSection: string;
}

/** Outcome of a per-adviser report send. */
export interface AdviserSendDetail {
  gradeSection: string;
  adviserName: string;
  email: string;
  ok: boolean;
  /** Success note or the error message for this adviser. */
  detail: string;
}

export interface AdviserSendResult {
  ok: boolean;
  /** Human-readable summary (shown as the toast / dialog text). */
  message: string;
  sent: number;
  /** Advisers skipped because no valid email was configured. */
  skipped: number;
  failed: number;
  details: AdviserSendDetail[];
}

// ---- Auto-update (electron-updater → GitHub Releases) ----------------------

export type UpdateStatusKind =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateInfo {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
}

/** Payload pushed to the renderer over the `update-status` channel. */
export interface UpdateStatus {
  status: UpdateStatusKind;
  data?: UpdateInfo | { percent?: number; transferred?: number; total?: number } | string;
}

/** Shape of the auto-updater API exposed on window.tapin. */
export interface UpdateApi {
  checkForUpdates(): Promise<{ success: boolean; message?: string }>;
  downloadUpdate(): Promise<{ success: boolean; message?: string }>;
  installUpdate(): Promise<{ success: boolean }>;
  getAppVersion(): Promise<string>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
}

// ---- App activation (license server → Cloudflare Worker) --------------------

export interface LicenseStatus {
  activated: boolean;
  licenseKey?: string;
  machineId?: string;
}

export interface ActivationResult {
  valid: boolean;
  message?: string;
  machineId?: string;
}

/** Shape of the license API exposed on window.tapin. */
export interface LicenseApi {
  checkLicense(): Promise<LicenseStatus>;
  activateLicense(licenseKey: string): Promise<ActivationResult>;
  getMachineId(): Promise<string>;
}

// ---------------------------------------------------------------------------
// The full API surface exposed on window.tapin by the preload script.
// The renderer mock (used when running in a plain browser) implements this too.
// ---------------------------------------------------------------------------
export interface TapinApi {
  getStatus(): Promise<SystemStatus>;
  processScan(payload: string, source: ScanSource): Promise<ScanResult>;
  getRecentActivity(limit?: number): Promise<ActivityItem[]>;
  setKioskMode(active: boolean): Promise<void>;
  toggleFullscreen(): Promise<void>;

  /** Frameless-window controls (Electron only; no-ops in browser mock mode). */
  windowMinimize(): Promise<void>;
  windowMaximizeToggle(): Promise<void>;
  windowClose(): Promise<void>;

  /** Validates admin credentials. The renderer holds the auth session. */
  login(username: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;

  getOverview(): Promise<OverviewStats>;
  listStudents(search?: string): Promise<Student[]>;
  createStudent(input: StudentInput): Promise<Student>;
  updateStudent(id: number, input: Partial<StudentInput>): Promise<Student>;
  deleteStudent(id: number): Promise<void>;
  generateQrPayload(studentNo: string): Promise<string>;
  importStudentsCsv(csv: string): Promise<ImportResult>;
  seedDemoData(): Promise<ImportResult>;

  listLogs(filter?: LogFilter): Promise<Paged<AttendanceLogRow>>;
  exportLogsCsv(filter?: LogFilter): Promise<string>;

  listSms(filter?: SmsFilter): Promise<Paged<SmsLogRow>>;
  retrySms(id: number): Promise<SmsLog>;
  testSms(phone: string): Promise<{ ok: boolean; message: string }>;

  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  /** Registered sections (one row per grade_section, with adviser + email). */
  listSections(): Promise<Section[]>;
  /** Inserts or updates a section (upsert by grade_section). */
  saveSection(input: SectionInput): Promise<Section>;
  /** Removes a section from the registry. */
  deleteSection(gradeSection: string): Promise<void>;
  /** Enrolls the given students into a section for a school year (bulk). */
  assignStudentsToSection(studentIds: number[], gradeSection: string, schoolYear: string): Promise<number>;
  /** Sets (or clears, with '') a single student's section within a school year. */
  setStudentEnrollment(studentId: number, schoolYear: string, gradeSection: string): Promise<void>;
  /** All enrollments for a school year (studentId → gradeSection). */
  listEnrollments(schoolYear: string): Promise<EnrollmentRow[]>;
  /** School years (exactly one flagged current). */
  listSchoolYears(): Promise<SchoolYear[]>;
  /** Adds a new school year (e.g. "2027 - 2028"). */
  saveSchoolYear(name: string): Promise<SchoolYear>;
  /** Sets the current school year; students' current sections rebuild from it. */
  setCurrentSchoolYear(name: string): Promise<void>;
  /** Removes a non-current school year and its enrollments. */
  deleteSchoolYear(name: string): Promise<void>;

  getReport(query: ReportQuery): Promise<ReportData>;
  /** Generates a PDF of the given report (main-process hidden-window print). */
  exportReportPdf(report: ReportData): Promise<ExportResult>;
  /** Exports a styled .xlsx of the given report data. */
  exportReportXlsx(report: ReportData): Promise<ExportResult>;
  /** Emails the report (PDF attachment) via the configured SMTP server. */
  sendReportEmail(report: ReportData): Promise<EmailResult>;
  /** Sends a plain test message to verify the SMTP settings. */
  testEmail(to: string): Promise<EmailResult>;
  /** Emails each section adviser a per-student report for their section. */
  sendReportToAdvisers(from: string, to: string, schoolYear?: string): Promise<AdviserSendResult>;

// ---- Push events (return unsubscribe functions) -------------------------
  onScanResult(cb: (result: ScanResult) => void): () => void;
  onActivity(cb: (items: ActivityItem[]) => void): () => void;
  onStatus(cb: (status: SystemStatus) => void): () => void;
  /** Fired when the user presses Ctrl+Shift+A (global shortcut in main). */
  onToggleAdmin(cb: () => void): () => void;

  // ---- Auto-update (GitHub Releases) --------------------------------------
  checkForUpdates(): Promise<{ success: boolean; message?: string }>;
  downloadUpdate(): Promise<{ success: boolean; message?: string }>;
  installUpdate(): Promise<{ success: boolean }>;
  getAppVersion(): Promise<string>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;

  // ---- App activation (license server) ------------------------------------
  checkLicense(): Promise<LicenseStatus>;
  activateLicense(licenseKey: string): Promise<ActivationResult>;
  getMachineId(): Promise<string>;
}
