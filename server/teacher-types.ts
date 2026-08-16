// Companion-shaped types for the embedded teacher portal. The kiosk's own
// shared/types.ts has different report/roster shapes (its ReportData is a
// unified object, not a union), so the portal module keeps its own copies of
// the exact shapes the TapIn Teacher renderer expects. Keep in sync with
// "TapIn Teacher Companion app"/shared/types.ts.
import type { AttendanceFlag, EntryType, ScanSource } from '../shared/types';

// ---- Attendance --------------------------------------------------------------
/** One scan inside a roster row or a student-day drilldown. */
export interface StudentScan {
  id: number;
  /** 'HH:MM' local time. */
  time: string;
  entryType: EntryType;
  flag: AttendanceFlag;
  source: ScanSource;
}

/** One student on a section roster for a given day. */
export interface RosterStudent {
  id: number;
  student_no: string;
  full_name: string;
  gender: string;
  grade_section: string;
  lrn: string;
  photo_url: string | null;
  /** That day's scans, oldest first. */
  scans: StudentScan[];
  /** True when the student has at least one scan that day. */
  present: boolean;
  /** First IN time 'HH:MM' or null. */
  firstIn: string | null;
  /** Last OUT time 'HH:MM' or null. */
  lastOut: string | null;
  /** ≥1 flagged-late IN that day. */
  late: boolean;
  /** ≥1 flagged-early OUT that day. */
  early: boolean;
}

export interface SectionTodayStats {
  enrolled: number;
  present: number;
  absent: number;
  late: number;
  early: number;
  scans: number;
}

export interface ManualCheckResult {
  ok: boolean;
  error?: string;
  entryType?: EntryType;
  flag?: AttendanceFlag;
  /** 'HH:MM' of the recorded scan. */
  time?: string;
}

// ---- Sections ------------------------------------------------------------------
export interface SectionSummary {
  grade_section: string;
  school_year: string;
  /** Active students currently in this section. */
  enrolled: number;
}

// ---- Auth -----------------------------------------------------------------------
export type TeacherRole = 'teacher' | 'dept_head';

export interface TeacherSession {
  id: number;
  username: string;
  role: TeacherRole;
}

export interface LoginResult {
  ok: boolean;
  error?: string;
  /** Populated on success — the signed-in account. */
  teacher?: TeacherSession;
}

export interface TeacherInfo {
  id: number;
  username: string;
  /** Optional contact email — copied onto assigned sections as the adviser email. */
  email: string;
  /** Sections mapped to this teacher for the current school year. */
  sections: string[];
  created_at: string;
}

export interface TeacherInput {
  username: string;
  /** Required on create; optional on update (blank = keep current). */
  password?: string;
  /** Optional contact email (used as the adviser report recipient). */
  email?: string;
  /** grade_section keys to map this teacher to (current school year). */
  sections?: string[];
}

// ---- Reports (companion union shapes) --------------------------------------------
export interface SectionReportRow {
  studentId: number;
  studentNo: string;
  fullName: string;
  daysPresent: number;
  daysLate: number;
  /** schoolDays − daysPresent (≥ 0). */
  daysAbsent: number;
  /** daysPresent / schoolDays × 100; null when there are no school days. */
  attendanceRate: number | null;
  totalIn: number;
  totalOut: number;
  /** Sum of minutes past the late cutoff on flagged IN scans. */
  totalMinutesLate: number;
}

export interface SectionReport {
  kind: 'section';
  section: string;
  from: string;
  to: string;
  /** Gate-used (school) days inside the range. */
  schoolDays: number;
  rows: SectionReportRow[];
}

export interface PerSectionRow {
  gradeSection: string;
  enrolled: number;
  present: number;
  absent: number;
  late: number;
  early: number;
  attendanceRate: number | null;
}

export interface PerSectionReport {
  kind: 'per-section';
  sections: string[];
  from: string;
  to: string;
  rows: PerSectionRow[];
}

export interface AbsenteeReportRow {
  studentId: number;
  studentNo: string;
  fullName: string;
  /** YYYY-MM-DD the student had zero scans on a school day. */
  day: string;
}

export interface AbsenteeReport {
  kind: 'absentee';
  section: string;
  from: string;
  to: string;
  rows: AbsenteeReportRow[];
}

export interface TardinessRow {
  studentNo: string;
  fullName: string;
  day: string;
  /** 'HH:MM' scan time. */
  scannedTime: string;
  minutesLate: number;
}

export interface TardinessReport {
  kind: 'tardiness';
  section: string;
  from: string;
  to: string;
  rows: TardinessRow[];
}

/** One learner row of the SF2 (School Form 2) daily-attendance matrix. */
export interface RegisterRow {
  studentId: number;
  studentNo: string;
  lrn: string;
  fullName: string;
  /** 'M' or 'F' (from students.gender). */
  sex: string;
  /** One mark per entry in RegisterReport.days: '' = present, 'X' = absent,
   *  'L' = tardy (late IN), 'E' = excused (logged excuse, no scan). */
  marks: string[];
  daysPresent: number;
  daysLate: number;
  /** No scan and not excused. */
  daysAbsent: number;
  daysExcused: number;
}

export interface RegisterReport {
  kind: 'register';
  section: string;
  from: string;
  to: string;
  /** True when the requested range exceeded the 35-day matrix cap. */
  capped: boolean;
  /** School days in the range — the matrix columns. */
  days: string[];
  /** Weekday letter per column ('M' | 'T' | 'W' | 'TH' | 'F' | 'SA' | 'SU'). */
  dayLetters: string[];
  /** Learners present per day column (the SF2 "per day" total rows). */
  perDayTotal: number[];
  perDayMale: number[];
  perDayFemale: number[];
  /** School name for the DepEd letterhead (settings.school_name). */
  schoolName: string;
  /** Current school year, e.g. "2026 - 2027". */
  schoolYear: string;
  /** "August 2026" — a span when the range crosses months. */
  monthLabel: string;
  rows: RegisterRow[];
}

/** Any report payload — carried into the export endpoint. */
export type ReportData =
  | SectionReport
  | PerSectionReport
  | AbsenteeReport
  | TardinessReport
  | RegisterReport;
