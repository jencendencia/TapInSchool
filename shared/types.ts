// ---------------------------------------------------------------------------
// Shared type contract between the Electron main process, the preload bridge,
// and the React renderer. Keep this file dependency-free.
// ---------------------------------------------------------------------------

export type EntryType = 'IN' | 'OUT';
export type SmsStatus = 'PENDING' | 'SENT' | 'FAILED';
export type ScanSource = 'SCANNER' | 'WEBCAM' | 'MANUAL';

/**
 * Kiosk gate-direction mode. 'auto' keeps the IN/OUT toggle engine (the last
 * scan of the day decides, so a student who forgot their morning swipe would
 * still be recorded IN in the afternoon); 'in' / 'out' force every scan to
 * that entry type regardless of history. Resets to 'auto' on app restart.
 */
export type ScanMode = 'auto' | 'in' | 'out';

/** Attendance quality flag derived from bell times ('' when on time). */
export type AttendanceFlag = '' | 'LATE' | 'EARLY';

/** Student gender ('' when not set). */
export type Gender = 'male' | 'female' | '';

/** How the student photo renders on the kiosk scan-result card. */
export type KioskPhotoStyle = 'avatar' | 'zoom' | 'fullbleed';

export type ScanResultKind =
  | 'SUCCESS'
  | 'BLOCKED'
  | 'UNRECOGNIZED'
  | 'DUPLICATE'
  | 'OFFLINE'
  | 'ERROR'
  | 'GUARDIAN';

export interface Student {
  id: number;
  student_no: string;
  qr_hash_payload: string;
  full_name: string;
  gender: Gender;
  grade_section: string;
  parent_phone: string;
  /** Learner Reference Number (DepEd LRN), optional. */
  lrn: string;
  /** Guardian's full name — when set, a guardian QR is generated. */
  guardian_name: string;
  guardian_address: string;
  /** Guardian's own QR payload (GP-… prefix). Null when no guardian is set. */
  guardian_qr_hash_payload: string | null;
  /** URL or inline data URI of the uploaded student photo (resized thumbnail). */
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface StudentInput {
  student_no: string;
  full_name: string;
  /** Optional — Male / Female ('' = not set). */
  gender?: Gender;
  grade_section: string;
  parent_phone: string;
  /** Learner Reference Number (DepEd LRN), optional. */
  lrn?: string;
  /** Guardian's full name — when set, a guardian QR is generated. */
  guardian_name?: string;
  guardian_address?: string;
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

/** One scan shown on the kiosk guardian day report. */
export interface GuardianScanRow {
  /** 'HH:MM' local time. */
  time: string;
  entryType: EntryType;
  flag: AttendanceFlag;
  source: ScanSource;
}

/** One child's attendance so far today, inside a guardian day report. */
export interface GuardianChildReport {
  studentId: number;
  studentNo: string;
  fullName: string;
  gradeSection: string;
  /** All scans today, oldest first. */
  scans: GuardianScanRow[];
  /** True when the child has at least one scan today. */
  present: boolean;
}

/**
 * Today's attendance report a guardian sees after scanning their QR.
 * One guardian QR covers every child whose student record carries the same
 * guardian name + address — each shows up as one entry in `children`.
 */
export interface GuardianDayReport {
  guardianName: string;
  /** YYYY-MM-DD of the report. */
  date: string;
  children: GuardianChildReport[];
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
  /** Populated for kind 'GUARDIAN' — the child's attendance so far today. */
  guardianReport?: GuardianDayReport;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
  /** Role of the signed-in user (admin can open the dashboard; staff is kiosk-only). */
  role?: UserRole;
}

// ---- Users & roles ---------------------------------------------------------

/** Who the account is: admin (dashboard access) or staff (kiosk manual check-in PIN). */
export type UserRole = 'admin' | 'staff';

/** A dashboard/kiosk account. The PIN hash is never exposed to the renderer. */
export interface User {
  id: number;
  username: string;
  role: UserRole;
  /** True when the account has a kiosk PIN set (staff use it for manual check-in). */
  has_pin: boolean;
  created_at: string;
}

export interface UserInput {
  username: string;
  role: UserRole;
  /** Required when creating/updating an admin (hashed server-side). */
  password?: string;
  /** 4–8 digit kiosk PIN. Required for staff; pass '' to clear an existing PIN. */
  pin?: string;
}

export type SmsProviderId = 'simulator' | 'gsm' | 'cloud';

export type CloudProviderId = 'semaphore' | 'messagebird' | 'philsms' | 'generic';

export interface Settings {
  school_name: string;
  /** Minutes of kiosk inactivity before idle announcements start (default 1). */
  announcements_idle_minutes: number;
  /** Seconds each non-video announcement shows before advancing (default 8). */
  announcement_slide_seconds: number;
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

  // ---- Automatic adviser reports (scheduled daily email) -----------------
  /** When true, every day at adviser_report_time each section adviser is
   *  emailed their section's per-student attendance report for the current
   *  day (midnight → send time). Requires SMTP + adviser emails (Sections). */
  adviser_report_enabled: boolean;
  /** Local 'HH:MM' time the daily adviser report emails are sent (e.g. '20:00'). */
  adviser_report_time: string;
  /** Internal: last date (YYYY-MM-DD) the adviser report emails were sent. */
  adviser_report_last_run: string;
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

// ---- Announcements (kiosk idle slideshow) -----------------------------------

/** What kind of media an announcement carries ('none' = text only). */
export type AnnouncementMediaType = 'none' | 'image' | 'video';

/** A kiosk announcement displayed on the idle screen. */
export interface Announcement {
  id: number;
  title: string;
  content_text: string;
  /** tapin-media:// URL for an uploaded image/video, or null for text-only. */
  media_url: string | null;
  media_type: AnnouncementMediaType;
  is_active: boolean;
  /** Display order in the kiosk carousel (lowest first). */
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementInput {
  title: string;
  content_text: string;
  /** Inline data URI (data:image/... or data:video/...) sent on upload; the
   * backend persists it and returns a tapin-media:// URL. */
  media?: string | null;
  media_type: AnnouncementMediaType;
  is_active?: boolean;
  sort_order?: number;
}

// ---- Badges & attendance recognition (positive/lenient) ---------------------

/** Badge families (ATT attendance / PUNCT punctuality) × duration tiers:
 *  weekly (Bronze) → monthly (Silver) → quarterly (Gold) → school year
 *  (Platinum). Excused days never break a badge. */
export type BadgeCode =
  | 'ATT_W'
  | 'ATT_M'
  | 'ATT_Q'
  | 'ATT_Y'
  | 'PUNCT_W'
  | 'PUNCT_M'
  | 'PUNCT_Q'
  | 'PUNCT_Y';

/** Why a school day was excused — excused days never break a badge. */
export type ExcuseCategory = 'SICK' | 'RELIGIOUS' | 'SCHOOL_ACTIVITY' | 'OTHER';

/** Display + scoring metadata for badge codes (shared by kiosk, admin, mock). */
export interface BadgeInfo {
  /** Family name, e.g. "Attendance Champion". */
  label: string;
  /** Family icon (🎖 attendance / ⏱ punctuality). */
  icon: string;
  /** 1 = weekly … 4 = school year (drives ordering + tie-breaks). */
  tier: 1 | 2 | 3 | 4;
  /** Score weight (1/3/6/10) — badge score = Σ points of earned badges. */
  points: number;
  /** Duration label, e.g. "Weekly". */
  windowLabel: string;
  /** Tier medal: 🥉 / 🥈 / 🥇 / 💎. */
  tierIcon: string;
  /** Tier name: Bronze / Silver / Gold / Platinum. */
  metal: string;
}

export const BADGE_INFO: Record<BadgeCode, BadgeInfo> = {
  ATT_W: { label: 'Attendance Champion', icon: '🎖', tier: 1, points: 1, windowLabel: 'Weekly', tierIcon: '🥉', metal: 'Bronze' },
  ATT_M: { label: 'Attendance Champion', icon: '🎖', tier: 2, points: 3, windowLabel: 'Monthly', tierIcon: '🥈', metal: 'Silver' },
  ATT_Q: { label: 'Attendance Champion', icon: '🎖', tier: 3, points: 6, windowLabel: 'Quarterly', tierIcon: '🥇', metal: 'Gold' },
  ATT_Y: { label: 'Attendance Champion', icon: '🎖', tier: 4, points: 10, windowLabel: 'School Year', tierIcon: '💎', metal: 'Platinum' },
  PUNCT_W: { label: 'Punctuality Champion', icon: '⏱', tier: 1, points: 1, windowLabel: 'Weekly', tierIcon: '🥉', metal: 'Bronze' },
  PUNCT_M: { label: 'Punctuality Champion', icon: '⏱', tier: 2, points: 3, windowLabel: 'Monthly', tierIcon: '🥈', metal: 'Silver' },
  PUNCT_Q: { label: 'Punctuality Champion', icon: '⏱', tier: 3, points: 6, windowLabel: 'Quarterly', tierIcon: '🥇', metal: 'Gold' },
  PUNCT_Y: { label: 'Punctuality Champion', icon: '⏱', tier: 4, points: 10, windowLabel: 'School Year', tierIcon: '💎', metal: 'Platinum' },
};

export const EXCUSE_CATEGORIES: ExcuseCategory[] = ['SICK', 'RELIGIOUS', 'SCHOOL_ACTIVITY', 'OTHER'];

/** A stored badge row — a student earned this badge for one window. */
export interface Badge {
  id: number;
  studentId: number;
  schoolYear: string;
  badgeCode: BadgeCode;
  /** YYYY-MM-DD start of the covered window (Monday / 1st of month / quarter
   *  / school year) — persisted in the student_badges.week_start column. */
  periodStart: string;
  earnedAt: string;
}

/** An admin-recorded excused day (student, date, reason). */
export interface Excuse {
  id: number;
  studentId: number;
  /** YYYY-MM-DD */
  excuseDate: string;
  category: ExcuseCategory;
  note: string;
}

/** Live progress for the current week — drives the kiosk + admin display. */
export interface BadgeWeekProgress {
  weekStart: string;
  weekEnd: string;
  /** Non-excused school days on/after the student's join day this week. */
  requiredDays: number;
  /** Distinct days the student scanned this week (on/after join day). */
  presentDays: number;
  /** Excused school days this week. */
  excusedDays: number;
  /** True once the attendance badge can no longer be earned this week. */
  attendanceMissed: boolean;
  /** True when a LATE/EARLY flag exists on a non-excused day this week. */
  punctualityMissed: boolean;
  attendanceComplete: boolean;
  punctualityComplete: boolean;
}

export interface StudentBadgeSummary {
  /** Earned badges (this school year), newest first. */
  badges: Badge[];
  currentWeek: BadgeWeekProgress | null;
  /** Badge earned by the scan that produced this summary (kiosk celebration). */
  newlyEarned: Badge | null;
}

export interface BadgeLeaderboardRow {
  studentId: number;
  fullName: string;
  gradeSection: string;
  studentNo: string;
  /** Total earned badges this school year. */
  badgeCount: number;
  /** Σ points of earned badges (ATT_W/PUNCT_W=1 … ATT_Y/PUNCT_Y=10). */
  score: number;
  /** Earned attendance-family badges (any tier). */
  attendanceBadges: number;
  /** Earned punctuality-family badges (any tier). */
  punctualityBadges: number;
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
  /** The kiosk gate-direction mode ('auto' | 'in' | 'out'). */
  getScanMode(): Promise<ScanMode>;
  /** Sets the kiosk gate-direction mode; applies to every scan path. */
  setScanMode(mode: ScanMode): Promise<ScanMode>;
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

  /** All accounts (username, role, PIN set) — never the password/PIN hashes. */
  listUsers(): Promise<User[]>;
  /** Creates an account. Admin needs a password; staff needs a 4–8 digit PIN. */
  createUser(input: UserInput): Promise<User>;
  /** Updates an account (username/role/password/PIN). Pass pin: '' to clear it. */
  updateUser(id: number, patch: Partial<UserInput>): Promise<User>;
  /** Deletes an account; refuses to remove the last admin. */
  deleteUser(id: number): Promise<void>;

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
  /** True when the given PIN matches the configured kiosk staff PIN (manual check-in). */
  verifyStaffPin(pin: string): Promise<boolean>;

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

  // ---- Badges & excused days (weekly recognition) -------------------------
  /** Earned badges + current-week progress for one student (kiosk scan path). */
  getStudentBadges(studentId: number): Promise<StudentBadgeSummary>;
  /** All stored badges, optionally filtered to one school year. */
  listBadges(schoolYear?: string): Promise<Badge[]>;
  /** Badge ranking (highest score first), optionally narrowed to one section
   *  or a specific school year (defaults to the current year). */
  badgeLeaderboard(topN?: number, section?: string, schoolYear?: string): Promise<BadgeLeaderboardRow[]>;
  /** A student's recorded excused days. */
  listExcuses(studentId: number): Promise<Excuse[]>;
  /** Records an excused day (self-heals that student's badges). */
  addExcuse(studentId: number, excuseDate: string, category: ExcuseCategory, note?: string): Promise<Excuse>;
  /** Removes an excused day (self-heals that student's badges). */
  removeExcuse(excuseId: number): Promise<void>;

  /** All announcements, newest first (both active and inactive). */
  listAnnouncements(): Promise<Announcement[]>;
  /** Creates an announcement (persists uploaded media to disk). */
  createAnnouncement(input: AnnouncementInput): Promise<Announcement>;
  /** Updates an announcement (replaces media when a new one is supplied). */
  updateAnnouncement(id: number, input: Partial<AnnouncementInput>): Promise<Announcement>;
  /** Deletes an announcement and its persisted media file. */
  deleteAnnouncement(id: number): Promise<void>;
  /** Active announcements ordered for the kiosk carousel (sort_order asc). */
  listActiveAnnouncements(): Promise<Announcement[]>;

  getReport(query: ReportQuery): Promise<ReportData>;
  /** Generates a PDF of the given report (main-process hidden-window print). */
  exportReportPdf(report: ReportData): Promise<ExportResult>;
  /** Exports a styled .xlsx of the given report data. */
  exportReportXlsx(report: ReportData): Promise<ExportResult>;
/** Emails the report (PDF attachment) via the configured SMTP server. */
  sendReportEmail(report: ReportData): Promise<EmailResult>;
  /**
   * Sends a plain test message to verify the SMTP settings.
   * Passes the current form settings so the test reflects exactly what the
   * admin typed (no separate save required first).
   */
  testEmail(to: string, settings: Settings): Promise<EmailResult>;
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
