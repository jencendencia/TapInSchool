// IPC surface for the renderer. Every channel maps 1:1 to a method on the
// shared TapinApi contract (shared/types.ts).
import { ipcMain, app, BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'fs';
import { db } from './db/connection';
import { settingsStore } from './db/settings';
import { enqueueScan, getRecentActivity } from './services/attendance';
import { getScanMode, setScanMode } from './services/scan-mode';
import {
  createUser as authCreateUser,
  deleteUser as authDeleteUser,
  listUsers as authListUsers,
  login as authLogin,
  updateUser as authUpdateUser,
  verifyStaffPin as authVerifyStaffPin,
} from './services/auth';
import { deleteAllLogos, saveLogo } from './services/logo';
import { deleteMediaUrl, saveMedia } from './services/announcement';
import { decorateDbDetail } from './services/clock';
import { flagCutoffs, flagSelectParams, flagSelectSql } from './services/bell-times';
import { pendingQueueCount, refreshOfflineCache } from './services/offline';
import {
  addExcuse,
  badgeLeaderboard,
  evaluateStudentToday,
  listBadges,
  listExcuses,
  recomputeAllBadges,
  recomputeStudent,
  removeExcuse,
} from './services/badges';
import { generateGuardianPayload, generatePayload } from './services/qr';
import {
  createGuardian,
  deleteGuardian,
  findGuardianById,
  findGuardiansByName,
  findOrCreateGuardian,
  listGuardians,
  updateGuardian,
} from './services/guardians';
import {
  createVisitor,
  deleteVisitor,
  listAllVisitorLogs,
  listVisitorLogs,
  listVisitors,
  updateVisitor,
} from './services/visitors';
import { getReportData, getReportDrilldown } from './services/report';
import { exportReportToPdf } from './services/report-pdf';
import { buildReportWorkbook } from './services/report-export';
import { sendAdviserReportEmails, sendReportEmail, sendTestEmail } from './services/report-email';
import { checkForUpdates, downloadUpdate, installUpdate } from './services/updater';
import { activateLicense, checkLicense, getMachineIdValue } from './services/license';
import { getProvider } from './sms/providers';
import type {
  ActivityItem,
  AdviserSendResult,
  Announcement,
  AnnouncementInput,
  AttendanceLogRow,
  Badge,
  BadgeLeaderboardRow,
  EmailResult,
  EnrollmentRow,
  Excuse,
  ExcuseCategory,
  ExportResult,
  Guardian,
  GuardianInput,
  GuardianWriteResult,
  ImportResult,
  LogFilter,
  LoginResult,
  OverviewStats,
  ReportData,
  ReportDrilldownQuery,
  ReportDrilldownResult,
  ReportQuery,
  ScanMode,
  ScanResult,
  ScanSource,
  SchoolYear,
  Section,
  SectionInput,
  Settings,
  SmsFilter,
  SmsLog,
  SmsLogRow,
  Student,
  StudentBadgeSummary,
  StudentInput,
  SystemStatus,
  User,
  UserInput,
  Visitor,
  VisitorInput,
  VisitorLogRow,
} from '../shared/types';

interface ScannerHook {
  setKioskMode(active: boolean): void;
}

export function registerIpc(scanner: ScannerHook): void {
  const broadcast = (channel: string, ...args: unknown[]) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, ...args);
    }
  };

  // ---- System status -------------------------------------------------------
  ipcMain.handle('tapin:getStatus', async (): Promise<SystemStatus> => {
    const settings = settingsStore.get();
    const provider = getProvider(settings.sms_provider);
    const dbStatus = db.getStatus();
    return {
      db: { online: dbStatus.online, detail: decorateDbDetail(dbStatus.detail) },
      sms: await provider.verify(settings),
      queue: { pending: await pendingQueueCount() },
    };
  });

  ipcMain.handle('tapin:processScan', async (_e, payload: string, source: ScanSource): Promise<ScanResult> => {
    // enqueueScan serializes scanner/webcam/manual so scans can't interleave.
    // The kiosk gate-direction mode is applied inside enqueueScan, so every
    // path (scanner/webcam/manual) honours the same Auto/IN/OUT setting.
    return enqueueScan(payload, source, {
      onScanResult: (r) => broadcast('tapin:scan-result', r),
      onActivity: (items) => broadcast('tapin:activity', items),
    });
  });

  // Kiosk gate-direction mode (Auto / force IN / force OUT). Held in the main
  // process so the USB scanner path shares the renderer's setting; resets to
  // 'auto' on every app start.
  ipcMain.handle('tapin:getScanMode', async (): Promise<ScanMode> => getScanMode());

  ipcMain.handle('tapin:setScanMode', async (_e, mode: ScanMode): Promise<ScanMode> => {
    return setScanMode(mode);
  });

  ipcMain.handle('tapin:getRecentActivity', async (_e, limit = 5): Promise<ActivityItem[]> => {
    return getRecentActivity(limit);
  });

  ipcMain.handle('tapin:setKioskMode', async (_e, active: boolean): Promise<void> => {
    scanner.setKioskMode(active);
    // The app is frameless and runs fullscreen in both kiosk and admin modes;
    // the custom window controls (and F11 / the sidebar Fullscreen toggle)
    // handle window management.
  });

  ipcMain.handle('tapin:toggleFullscreen', async (): Promise<void> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  // ---- Frameless window controls ------------------------------------------
  ipcMain.handle('tapin:windowMinimize', async (): Promise<void> => {
    (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.minimize();
  });

  ipcMain.handle('tapin:windowMaximizeToggle', async (): Promise<void> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return;
    // In fullscreen the button acts as "restore to window" (then maximizes);
    // otherwise it toggles maximize / restore as usual. setFullScreen is an
    // async transition, so maximize unconditionally after it instead of
    // relying on a possibly-stale isMaximized() check.
    if (win.isFullScreen()) {
      win.setFullScreen(false);
      win.maximize();
    } else if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle('tapin:windowClose', async (): Promise<void> => {
    (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.close();
  });

  // ---- Overview ------------------------------------------------------------
  ipcMain.handle('tapin:getOverview', async (): Promise<OverviewStats> => {
    const count = async (sql: string, params?: unknown[]) => {
      const [row] = await db.query<{ c: number }[]>(sql, params);
      return row?.c ?? 0;
    };
    const todayTotal = await count('SELECT COUNT(*) c FROM attendance_logs WHERE scanned_at >= CURDATE()');
    const todayIn = await count(`SELECT COUNT(*) c FROM attendance_logs WHERE scanned_at >= CURDATE() AND entry_type = 'IN'`);
    const todayOut = await count(`SELECT COUNT(*) c FROM attendance_logs WHERE scanned_at >= CURDATE() AND entry_type = 'OUT'`);
    const activeStudents = await count('SELECT COUNT(*) c FROM students WHERE is_active = 1');
    const totalStudents = await count('SELECT COUNT(*) c FROM students');
    const smsSentToday = await count(`SELECT COUNT(*) c FROM sms_logs WHERE status = 'SENT' AND created_at >= CURDATE()`);
    const smsPendingToday = await count(`SELECT COUNT(*) c FROM sms_logs WHERE status = 'PENDING'`);
    const smsFailedToday = await count(`SELECT COUNT(*) c FROM sms_logs WHERE status = 'FAILED' AND created_at >= CURDATE()`);

    // Attendance-quality counts (Phase 2, 4.1 + 4.2). Only queried when the
    // matching bell time is configured; TIME() compares against HH:MM:SS.
    const cuts = flagCutoffs(settingsStore.get());
    const lateToday = cuts.late
      ? await count(
          `SELECT COUNT(*) c FROM attendance_logs WHERE scanned_at >= CURDATE() AND entry_type = 'IN' AND TIME(scanned_at) > ?`,
          [cuts.late],
        )
      : 0;
    const earlyToday = cuts.early
      ? await count(
          `SELECT COUNT(*) c FROM attendance_logs WHERE scanned_at >= CURDATE() AND entry_type = 'OUT' AND TIME(scanned_at) < ?`,
          [cuts.early],
        )
      : 0;
    const absentToday = await count(
      `SELECT COUNT(*) c FROM students s
       WHERE s.is_active = 1 AND NOT EXISTS (
         SELECT 1 FROM attendance_logs a WHERE a.student_id = s.id AND a.scanned_at >= CURDATE())`,
    );

    const hourly = await db.query<{ hour: number; entry_type: 'IN' | 'OUT'; c: number }[]>(
      `SELECT HOUR(scanned_at) hour, entry_type, COUNT(*) c FROM attendance_logs
       WHERE scanned_at >= CURDATE() GROUP BY HOUR(scanned_at), entry_type`,
    );
    const hourlyToday = Array.from({ length: 24 }, (_, hour) => {
      const row = hourly.filter((h) => h.hour === hour);
      return {
        hour,
        in: row.filter((r) => r.entry_type === 'IN').reduce((s, r) => s + r.c, 0),
        out: row.filter((r) => r.entry_type === 'OUT').reduce((s, r) => s + r.c, 0),
      };
    });

    // Explicitly format as 'YYYY-MM-DD' so last7Days[].date is a plain string
    // (renderer slices it). The pool also sets dateStrings, so this is
    // defensive double-coverage against driver defaulting to Date objects.
    const days = await db.query<{ d: string; c: number }[]>(
      `SELECT DATE_FORMAT(scanned_at, '%Y-%m-%d') d, COUNT(*) c FROM attendance_logs
       WHERE scanned_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY DATE_FORMAT(scanned_at, '%Y-%m-%d') ORDER BY d`,
    );
    const last7Days = days.map((r) => ({ date: r.d, total: r.c }));

    return {
      todayTotal,
      todayIn,
      todayOut,
      activeStudents,
      totalStudents,
      smsSentToday,
      smsPendingToday,
      smsFailedToday,
      lateToday,
      earlyToday,
      absentToday,
      hourlyToday,
      last7Days,
    };
  });

  // ---- Students CRUD -------------------------------------------------------
  ipcMain.handle('tapin:listStudents', async (_e, search?: string): Promise<Student[]> => {
    if (search) {
      const like = `%${search}%`;
      return db.query<Student[]>(
        'SELECT * FROM students WHERE full_name LIKE ? OR student_no LIKE ? OR grade_section LIKE ? ORDER BY full_name',
        [like, like, like],
      );
    }
    return db.query<Student[]>('SELECT * FROM students ORDER BY full_name');
  });

  /**
   * Splits "Grade 7 - Section A" into grade "Grade 7" / section "Section A".
   * Must match the SQL backfill in db/schema.ts (grade = before the FIRST
   * ' - ', section = after the LAST ' - ') so both paths parse identically.
   */
  function splitSection(name: string): { grade: string; section: string } {
    const first = name.indexOf(' - ');
    const last = name.lastIndexOf(' - ');
    if (first >= 0) return { grade: name.slice(0, first).trim(), section: name.slice(last + 3).trim() };
    return { grade: name.trim(), section: '' };
  }

  /** Registers a section (auto-created by enrollment paths), deriving grade/section. */
  async function upsertSectionRow(gradeSection: string): Promise<void> {
    const { grade, section } = splitSection(gradeSection);
    await db.execute(
      `INSERT INTO sections (grade_section, grade, section) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE grade = ?, section = ?`,
      [gradeSection, grade, section, grade, section],
    );
  }

  /**
   * Keeps a student's section in sync within a school year (default: the
   * current year). Only the CURRENT year's enrollment is mirrored onto
   * students.grade_section — the live section attendance/SMS/reports read.
   * Editing a past year only touches that year's enrollment history.
   */
  async function syncEnrollment(studentId: number, section: string, schoolYear?: string): Promise<void> {
    const [cur] = await db.query<{ name: string }[]>(
      'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
    );
    const year = String(schoolYear ?? '').trim() || (cur?.name ?? '');
    if (!year) return;
    const [yearRow] = await db.query<SchoolYearRow[]>('SELECT * FROM school_years WHERE name = ?', [year]);
    const isCurrent = !!yearRow?.is_current;
    if (section) {
      await upsertSectionRow(section);
      await db.execute(
        `INSERT INTO enrollments (student_id, school_year, grade_section) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE grade_section = ?`,
        [studentId, year, section, section],
      );
      if (isCurrent) await db.execute('UPDATE students SET grade_section = ? WHERE id = ?', [section, studentId]);
    } else {
      await db.execute('DELETE FROM enrollments WHERE student_id = ? AND school_year = ?', [studentId, year]);
      if (isCurrent) await db.execute('UPDATE students SET grade_section = ? WHERE id = ?', ['', studentId]);
    }
  }

  /**
   * Computes the next auto-generated student number for the current year,
   * e.g. "2025-0001" → "2025-0002". Only row numbers matching the
   * "{year}-{4-digit seq}" pattern under this year are counted; anything else
   * (legacy / free-form) is left untouched.
   */
  async function generateStudentNo(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `${year}-`;
    const [row] = await db.query<{ max_seq: number | null }[]>(
      `SELECT MAX(CAST(SUBSTRING(student_no, ?) AS UNSIGNED)) max_seq
       FROM students WHERE student_no LIKE ?`,
      [prefix.length + 1, `${prefix}%`],
    );
    const next = (row?.max_seq ?? 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  ipcMain.handle('tapin:createStudent', async (_e, input: StudentInput): Promise<Student> => {
    // Auto-generate the student number when the Add form leaves it blank.
    const studentNo = String(input.student_no ?? '').trim() || (await generateStudentNo());
    const payload = generatePayload(studentNo);
    // Guardian snapshot: the new student form links a registered guardian (the
    // dropdown). When present, the guardian's identity is copied onto the
    // student (SMS number, name, address, QR); otherwise fall back to the
    // legacy free-text fields (CSV import / older clients). The QR payload
    // hashes the guardian identity, so children sharing a guardian share one QR.
    let guardianId: number | null = null;
    let guardianName = String(input.guardian_name ?? '').trim();
    let guardianAddress = String(input.guardian_address ?? '').trim();
    let guardianPhone = String(input.parent_phone ?? '').trim();
    let guardianPayload: string | null = null;
    if (input.guardian_id) {
      const g = await findGuardianById(Number(input.guardian_id));
      if (!g) throw new Error('Selected guardian no longer exists.');
      guardianId = g.id;
      guardianName = g.full_name;
      guardianAddress = g.address;
      guardianPhone = g.mobile;
      guardianPayload = g.qr_hash_payload;
    }
    if (!guardianPayload && guardianName) {
      guardianPayload = generateGuardianPayload(guardianName, guardianAddress);
    }
    // students.grade_section is the CURRENT year's live section — a student
    // enrolled into a past year starts unassigned this year.
    const [cur] = await db.query<{ name: string }[]>(
      'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
    );
    const year = String(input.school_year ?? '').trim() || (cur?.name ?? '');
    const [yearRow] = year
      ? await db.query<SchoolYearRow[]>('SELECT * FROM school_years WHERE name = ?', [year])
      : [];
    const liveSection = yearRow?.is_current ? String(input.grade_section ?? '').trim() : '';
    const res = await db.execute(
      `INSERT INTO students (student_no, qr_hash_payload, full_name, gender, grade_section, parent_phone,
                             lrn, guardian_name, guardian_address, guardian_qr_hash_payload, guardian_id,
                             photo_url, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentNo,
        payload,
        input.full_name,
        normalizeGender(input.gender),
        liveSection,
        guardianPhone,
        String(input.lrn ?? '').trim(),
        guardianName,
        guardianAddress,
        guardianPayload,
        guardianId,
        input.photo_url || null,
        input.is_active ?? true,
      ],
    );
    // A new student with a section is enrolled in the requested school year
    // (defaults to the current year).
    await syncEnrollment(res.insertId, String(input.grade_section ?? '').trim(), year);
    const [row] = await db.query<Student[]>('SELECT * FROM students WHERE id = ?', [res.insertId]);
    // Keep the offline snapshot current so offline scans see new students.
    void refreshOfflineCache();
    return row;
  });

  ipcMain.handle('tapin:updateStudent', async (_e, id: number, input: Partial<StudentInput>): Promise<Student> => {
    // Partial semantics: only the keys actually provided are updated, so a
    // caller like the Sections roster can safely send { grade_section: '' }
    // without wiping the student's other fields. Matches the mock's merge.
    // When the form sends guardian_id, the guardian snapshot (phone/name/
    // address/QR) is derived from the registry row — the legacy free-text
    // fields are then ignored for that update.
    const usesGuardianLink = 'guardian_id' in input;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, key: keyof StudentInput, fallback: unknown) => {
      if (key in input) {
        sets.push(`${col} = ?`);
        params.push(input[key] ?? fallback);
      }
    };
    add('student_no', 'student_no', '');
    add('full_name', 'full_name', '');
    add('lrn', 'lrn', '');
    add('photo_url', 'photo_url', null);
    add('is_active', 'is_active', true);
    // Legacy free-text guardian fields — skipped when the form sends
    // guardian_id (the registry link wins and the snapshot is derived below).
    if (!usesGuardianLink) {
      add('parent_phone', 'parent_phone', '');
      add('guardian_name', 'guardian_name', '');
      add('guardian_address', 'guardian_address', '');
    }
    if ('gender' in input) {
      sets.push('gender = ?');
      params.push(normalizeGender(input.gender));
    }
    // Guardian link lifecycle: linking a guardian copies its identity onto the
    // student; passing guardian_id: null clears the link (and with it the SMS
    // number + guardian QR — no guardian, no alerts).
    if (usesGuardianLink) {
      const gid = input.guardian_id ? Number(input.guardian_id) : null;
      if (gid && Number.isInteger(gid)) {
        const g = await findGuardianById(gid);
        if (!g) throw new Error('Selected guardian no longer exists.');
        sets.push('guardian_id = ?', 'parent_phone = ?', 'guardian_name = ?', 'guardian_address = ?', 'guardian_qr_hash_payload = ?');
        params.push(g.id, g.mobile, g.full_name, g.address, g.qr_hash_payload);
      } else {
        sets.push('guardian_id = NULL', 'parent_phone = ?', 'guardian_name = ?', 'guardian_address = ?', 'guardian_qr_hash_payload = NULL');
        params.push('', '', '');
      }
    }
    // Legacy Guardian QR lifecycle: the payload is a hash of the guardian
    // identity (name + address), so changing either field re-issues the QR;
    // clearing the name removes it. Children sharing the identity share the
    // same QR. Skipped when the form used the registry dropdown instead.
    if (!usesGuardianLink && ('guardian_name' in input || 'guardian_address' in input)) {
      const [existing] = await db.query<{ guardian_name: string; guardian_address: string }[]>(
        'SELECT guardian_name, guardian_address FROM students WHERE id = ?',
        [id],
      );
      const name = String(input.guardian_name ?? existing?.guardian_name ?? '').trim();
      const address = String(input.guardian_address ?? existing?.guardian_address ?? '').trim();
      if (name) {
        sets.push('guardian_qr_hash_payload = ?');
        params.push(generateGuardianPayload(name, address));
      } else {
        sets.push('guardian_qr_hash_payload = NULL');
      }
    }
    // students.grade_section (the live, current-year section) only changes when
    // the requested school year IS the current year — editing a past year must
    // not rewrite the live section.
    if ('grade_section' in input) {
      const [cur] = await db.query<{ name: string }[]>(
        'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
      );
      const year = String(input.school_year ?? '').trim() || (cur?.name ?? '');
      const [yearRow] = year
        ? await db.query<SchoolYearRow[]>('SELECT * FROM school_years WHERE name = ?', [year])
        : [];
      if (yearRow?.is_current) {
        sets.push('grade_section = ?');
        params.push(input.grade_section ?? '');
      }
    }
    if (!sets.length) throw new Error('Nothing to update.');
    params.push(id);
    await db.execute(`UPDATE students SET ${sets.join(', ')} WHERE id = ?`, params);
    // Keep the (requested) school year's enrollment in sync when the section
    // changes — the Students page edits the globally selected year. Only the
    // current year's enrollment is mirrored onto students.grade_section.
    if ('grade_section' in input) {
      await syncEnrollment(id, String(input.grade_section ?? '').trim(), input.school_year);
    }
    const [row] = await db.query<Student[]>('SELECT * FROM students WHERE id = ?', [id]);
    void refreshOfflineCache();
    return row;
  });

  ipcMain.handle('tapin:deleteStudent', async (_e, id: number): Promise<void> => {
    // Remove the student's enrollments first — the FK on enrollments.student_id
    // (no cascade on pre-existing installs) would otherwise block the delete.
    await db.execute('DELETE FROM enrollments WHERE student_id = ?', [id]);
    await db.execute('DELETE FROM students WHERE id = ?', [id]);
    void refreshOfflineCache();
  });

  ipcMain.handle('tapin:generateQrPayload', (_e, studentNo: string): string => {
    return generatePayload(studentNo);
  });

  // ---- Guardians (registry + duplicate-name registration flow) -------------
  ipcMain.handle('tapin:listGuardians', async (_e, search?: string): Promise<Guardian[]> => {
    return listGuardians(search);
  });

  ipcMain.handle('tapin:findGuardiansByName', async (_e, name: string): Promise<Guardian[]> => {
    return findGuardiansByName(name);
  });

  ipcMain.handle(
    'tapin:createGuardian',
    async (_e, input: GuardianInput, opts?: { allowSameName?: boolean }): Promise<GuardianWriteResult> => {
      return createGuardian(input, opts);
    },
  );

  ipcMain.handle(
    'tapin:updateGuardian',
    async (
      _e,
      id: number,
      patch: Partial<GuardianInput & { is_active?: boolean }>,
      opts?: { allowSameName?: boolean },
    ): Promise<GuardianWriteResult> => {
      return updateGuardian(id, patch, opts);
    },
  );

  ipcMain.handle('tapin:deleteGuardian', async (_e, id: number): Promise<void> => {
    return deleteGuardian(id);
  });

  // ---- Sections (registry wired to the Students page + report emailing) ----
  ipcMain.handle('tapin:listSections', async (): Promise<Section[]> => {
    return db.query<Section[]>('SELECT * FROM sections ORDER BY grade_section');
  });

  ipcMain.handle('tapin:saveSection', async (_e, input: SectionInput): Promise<Section> => {
    const gradeSection = String(input?.grade_section ?? '').trim();
    // Prefer the form's separated grade/section; fall back to parsing the
    // composite (legacy rows / auto-created sections).
    const grade = String(input?.grade ?? '').trim() || splitSection(gradeSection).grade;
    const section = String(input?.section ?? '').trim() || splitSection(gradeSection).section;
    const adviserName = String(input?.adviser_name ?? '').trim();
    const email = String(input?.email ?? '').trim();
    if (!gradeSection) throw new Error('Section is required.');
    // Upsert by grade_section — a section has at most one registry row.
    await db.execute(
      `INSERT INTO sections (grade_section, grade, section, adviser_name, email) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE grade = ?, section = ?, adviser_name = ?, email = ?`,
      [gradeSection, grade, section, adviserName, email, grade, section, adviserName, email],
    );
    const [row] = await db.query<Section[]>('SELECT * FROM sections WHERE grade_section = ?', [gradeSection]);
    return row;
  });

  ipcMain.handle('tapin:deleteSection', async (_e, gradeSection: string): Promise<void> => {
    await db.execute('DELETE FROM sections WHERE grade_section = ?', [String(gradeSection ?? '')]);
  });

  /** Sets (or clears, with '') one student's section within a school year. */
  ipcMain.handle(
    'tapin:setStudentEnrollment',
    async (_e, studentId: number, schoolYear: string, gradeSection: string): Promise<void> => {
      const id = Number(studentId);
      const year = String(schoolYear ?? '').trim();
      const section = String(gradeSection ?? '').trim();
      if (!Number.isInteger(id) || !year) throw new Error('Student and school year are required.');
      await syncEnrollment(id, section, year);
      void refreshOfflineCache();
    },
  );

  ipcMain.handle('tapin:listEnrollments', async (_e, schoolYear: string): Promise<EnrollmentRow[]> => {
    const rows = await db.query<{ student_id: number; grade_section: string }[]>(
      `SELECT student_id, grade_section FROM enrollments WHERE school_year = ? AND grade_section <> ''`,
      [String(schoolYear ?? '')],
    );
    return rows.map((r) => ({ studentId: r.student_id, gradeSection: r.grade_section }));
  });

  // ---- School years ---------------------------------------------------------
  type SchoolYearRow = { id: number; name: string; is_current: number; created_at: string };
  const toSchoolYear = (r: SchoolYearRow): SchoolYear => ({
    id: r.id,
    name: r.name,
    is_current: !!r.is_current,
    created_at: r.created_at,
  });

  ipcMain.handle('tapin:listSchoolYears', async (): Promise<SchoolYear[]> => {
    let rows = await db.query<SchoolYearRow[]>('SELECT * FROM school_years ORDER BY name');
    // Self-heal: never empty, and exactly one current year.
    if (!rows.length) {
      await db.execute("INSERT IGNORE INTO school_years (name, is_current) VALUES ('2026 - 2027', 1)");
      rows = await db.query<SchoolYearRow[]>('SELECT * FROM school_years ORDER BY name');
    }
    if (!rows.some((r) => r.is_current)) {
      await db.execute('UPDATE school_years SET is_current = 0');
      await db.execute('UPDATE school_years SET is_current = 1 ORDER BY id LIMIT 1');
      rows = await db.query<SchoolYearRow[]>('SELECT * FROM school_years ORDER BY name');
    }
    return rows.map(toSchoolYear);
  });

  ipcMain.handle('tapin:saveSchoolYear', async (_e, name: string): Promise<SchoolYear> => {
    const year = String(name ?? '').trim();
    if (!year) throw new Error('School year is required.');
    if (year.length > 32) throw new Error('School year is too long (max 32 characters).');
    await db.execute('INSERT IGNORE INTO school_years (name) VALUES (?)', [year]);
    const [row] = await db.query<SchoolYearRow[]>('SELECT * FROM school_years WHERE name = ?', [year]);
    return toSchoolYear(row);
  });

  ipcMain.handle('tapin:setCurrentSchoolYear', async (_e, name: string): Promise<void> => {
    const year = String(name ?? '').trim();
    if (!year) throw new Error('School year is required.');
    const [existing] = await db.query<SchoolYearRow[]>('SELECT * FROM school_years WHERE name = ?', [year]);
    if (!existing) throw new Error('School year not found.');
    await db.execute('UPDATE school_years SET is_current = 0');
    await db.execute('UPDATE school_years SET is_current = 1 WHERE name = ?', [year]);
    // Rollover: rebuild each student's current section from the new year's
    // enrollments — a fresh year has none, so sections are cleared until the
    // new year's rosters are built. Past years stay intact in enrollments.
    await db.execute(
      `UPDATE students s LEFT JOIN enrollments e ON e.student_id = s.id AND e.school_year = ?
       SET s.grade_section = COALESCE(e.grade_section, '')`,
      [year],
    );
    void refreshOfflineCache();
  });

  ipcMain.handle('tapin:deleteSchoolYear', async (_e, name: string): Promise<void> => {
    const year = String(name ?? '').trim();
    if (!year) return;
    const [row] = await db.query<SchoolYearRow[]>('SELECT * FROM school_years WHERE name = ?', [year]);
    if (row?.is_current) throw new Error('Cannot delete the current school year.');
    await db.execute('DELETE FROM enrollments WHERE school_year = ?', [year]);
    await db.execute('DELETE FROM school_years WHERE name = ?', [year]);
  });

  /** Bulk-enrolls students into a section for a school year. Returns count. */
  ipcMain.handle(
    'tapin:assignStudentsToSection',
    async (_e, studentIds: number[], gradeSection: string, schoolYear: string): Promise<number> => {
      const section = String(gradeSection ?? '').trim();
      const year = String(schoolYear ?? '').trim();
      if (!section || !year) throw new Error('Section and school year are required.');
      const ids = (Array.isArray(studentIds) ? studentIds : []).filter((n) => Number.isInteger(n));
      if (!ids.length) return 0;
      // The section must exist in the registry for the strict Students picker.
      await upsertSectionRow(section);
      const yearRows = await db.query<SchoolYearRow[]>('SELECT * FROM school_years WHERE name = ?', [year]);
      const isCurrent = !!yearRows[0]?.is_current;
      for (const id of ids) {
        await db.execute(
          `INSERT INTO enrollments (student_id, school_year, grade_section) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE grade_section = ?`,
          [id, year, section, section],
        );
        // The current year's enrollment also drives the student's live section.
        if (isCurrent) await db.execute('UPDATE students SET grade_section = ? WHERE id = ?', [section, id]);
      }
      void refreshOfflineCache();
      return ids.length;
    },
  );

// ---- Announcements (kiosk idle slideshow) --------------------------------
  type AnnouncementRow = {
    id: number;
    title: string;
    content_text: string;
    media_url: string | null;
    media_type: 'none' | 'image' | 'video';
    is_active: number;
    sort_order: number;
    created_at: string;
    updated_at: string;
  };
  const toAnnouncement = (r: AnnouncementRow): Announcement => ({
    id: r.id,
    title: r.title,
    content_text: r.content_text,
    media_url: r.media_url,
    media_type: r.media_type,
    is_active: !!r.is_active,
    sort_order: r.sort_order,
    created_at: r.created_at,
    updated_at: r.updated_at,
  });

  ipcMain.handle('tapin:listAnnouncements', async (): Promise<Announcement[]> => {
    const rows = await db.query<AnnouncementRow[]>(
      'SELECT * FROM announcements ORDER BY sort_order ASC, id ASC',
    );
    return rows.map(toAnnouncement);
  });

  ipcMain.handle('tapin:listActiveAnnouncements', async (): Promise<Announcement[]> => {
    const rows = await db.query<AnnouncementRow[]>(
      `SELECT * FROM announcements WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`,
    );
    return rows.map(toAnnouncement);
  });

  ipcMain.handle('tapin:createAnnouncement', async (_e, input: AnnouncementInput): Promise<Announcement> => {
    const title = String(input?.title ?? '').trim();
    const content = String(input?.content_text ?? '').trim();
    if (!title && !content) throw new Error('Announcement needs a title or message.');
// Persist an uploaded media data URI to disk; text-only announcements get null.
    // The media_type is inferred from the data URI prefix when provided.
    let mediaUrl: string | null = null;
    let mediaType = input?.media_type ?? 'none';
    if (input?.media) {
      const dataUrl = String(input.media);
      mediaType = dataUrl.startsWith('data:video/') ? 'video' : dataUrl.startsWith('data:image/') ? 'image' : 'none';
      if (mediaType !== 'none') mediaUrl = await saveMedia(dataUrl);
    }
    const res = await db.execute(
      `INSERT INTO announcements (title, content_text, media_url, media_type, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, content, mediaUrl, mediaType, input?.is_active ?? true, input?.sort_order ?? 0],
    );
    const [row] = await db.query<AnnouncementRow[]>('SELECT * FROM announcements WHERE id = ?', [res.insertId]);
    return toAnnouncement(row);
  });

  ipcMain.handle(
    'tapin:updateAnnouncement',
    async (_e, id: number, input: Partial<AnnouncementInput>): Promise<Announcement> => {
      const sets: string[] = [];
      const params: unknown[] = [];
      if ('title' in input) {
        sets.push('title = ?');
        params.push(String(input.title ?? '').trim());
      }
      if ('content_text' in input) {
        sets.push('content_text = ?');
        params.push(String(input.content_text ?? '').trim());
      }
      if ('media_type' in input) {
        sets.push('media_type = ?');
        params.push(input.media_type ?? 'none');
      }
      if ('is_active' in input) {
        sets.push('is_active = ?');
        params.push(input.is_active ? 1 : 0);
      }
      if ('sort_order' in input) {
        sets.push('sort_order = ?');
        params.push(input.sort_order ?? 0);
      }
// Media replacement: persist a NEWLY uploaded file (a data URI), drop the
      // old one, and update the URL. The edit form sends back the existing
      // media URL (tapin-media://…) unchanged when the admin didn't touch it —
      // that is NOT a new upload, so it must not be re-persisted (saveMedia
      // only accepts data URIs).
      if (input?.media && typeof input.media === 'string' && input.media.startsWith('data:')) {
        const dataUrl = input.media;
        const [old] = await db.query<AnnouncementRow[]>(
          'SELECT media_url FROM announcements WHERE id = ?',
          [id],
        );
        const mediaUrl = await saveMedia(dataUrl, old?.media_url);
        const mediaType = dataUrl.startsWith('data:video/') ? 'video' : 'image';
        sets.push('media_url = ?');
        sets.push('media_type = ?');
        params.push(mediaUrl, mediaType);
      } else if ('media' in input && input?.media === null) {
        // Explicitly clearing media.
        const [old] = await db.query<AnnouncementRow[]>(
          'SELECT media_url FROM announcements WHERE id = ?',
          [id],
        );
        await deleteMediaUrl(old?.media_url);
        sets.push('media_url = NULL');
        sets.push("media_type = 'none'");
      }
      if (!sets.length) throw new Error('Nothing to update.');
      params.push(id);
      await db.execute(`UPDATE announcements SET ${sets.join(', ')} WHERE id = ?`, params);
      const [row] = await db.query<AnnouncementRow[]>('SELECT * FROM announcements WHERE id = ?', [id]);
      return toAnnouncement(row);
    },
  );

  ipcMain.handle('tapin:deleteAnnouncement', async (_e, id: number): Promise<void> => {
    const [old] = await db.query<AnnouncementRow[]>(
      'SELECT media_url FROM announcements WHERE id = ?',
      [id],
    );
    await deleteMediaUrl(old?.media_url);
    await db.execute('DELETE FROM announcements WHERE id = ?', [id]);
  });

  ipcMain.handle('tapin:importStudentsCsv', async (_e, csv: string): Promise<ImportResult> => {
    return importCsv(csv);
  });

  ipcMain.handle('tapin:seedDemoData', async (): Promise<ImportResult> => {
    const csv = [
      'student_no,full_name,grade_section,parent_phone,gender',
      '2024-0112,Juan Dela Cruz,Grade 7 - Section A,09171234567,Male',
      '2024-0113,Maria Santos,Grade 7 - Section A,09182345678,Female',
      '2024-0215,Carlos Garcia,Grade 8 - Section B,09193456789,Male',
      '2024-0318,Ana Reyes,Grade 9 - Section C,09184567890,Female',
      '2024-0421,Miguel Torres,Grade 10 - Section D,09195678901,Male',
      '2024-0524,Liza Fernandez,Grade 11 - STEM,09196789012,Female',
    ].join('\n');
    const result = await importCsv(csv);
    // Fresh demo import: seed ~30 days of attendance history so the badge
    // system has real data to evaluate — weekly/monthly/quarterly badges show
    // up right away instead of waiting for real scans. Story mirrors the
    // browser mock: Ana missed a day that is EXCUSED (badge preserved), Miguel
    // missed a day with no excuse (his badges are missed). Skipped when the
    // demo students already have logs (e.g. a real roster that happens to use
    // the same student numbers).
    const demoNos = ['2024-0112', '2024-0113', '2024-0215', '2024-0318', '2024-0421', '2024-0524'];
    const placeholders = demoNos.map(() => '?').join(',');
    const rows = await db.query<{ id: number; student_no: string }[]>(
      `SELECT id, student_no FROM students WHERE student_no IN (${placeholders})`,
      demoNos,
    );
    if (rows.length) {
      const [logCount] = await db.query<{ c: number }[]>(
        `SELECT COUNT(*) c FROM attendance_logs a JOIN students s ON s.id = a.student_id
         WHERE s.student_no IN (${placeholders})`,
        demoNos,
      );
      if (result.added > 0 || (logCount?.c ?? 0) === 0) {
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const iso = (dt: Date) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
        const values: string[] = [];
        const params: unknown[] = [];
        for (let d = 29; d >= 0; d--) {
          const day = new Date();
          day.setDate(day.getDate() - d);
          rows.forEach((s, i) => {
            if ((s.student_no === '2024-0318' && d === 2) || (s.student_no === '2024-0421' && d === 1)) return;
            const inTime = new Date(day);
            inTime.setHours(6 + (i % 3), 20 + ((i * 13) % 35), (i * 7) % 60, 0);
            // OUT after the 16:00 dismissal so no EARLY flags pollute the demo
            // (students 1/2/4/5 arrive after the 07:15 late cutoff → LATE,
            // which is what keeps their punctuality badges unearned).
            const outTime = new Date(day);
            outTime.setHours(16 + (i % 2), 10 + ((i * 17) % 40), (i * 11) % 60, 0);
            values.push("(?, ?, 'SCANNER', ?)", "(?, ?, 'SCANNER', ?)");
            params.push(s.id, 'IN', inTime, s.id, 'OUT', outTime);
          });
        }
        if (values.length) {
          await db.execute(
            `INSERT INTO attendance_logs (student_id, entry_type, source, scanned_at) VALUES ${values.join(', ')}`,
            params,
          );
        }
        const ana = rows.find((r) => r.student_no === '2024-0318');
        if (ana) {
          const excDay = new Date();
          excDay.setDate(excDay.getDate() - 2);
          await db.execute(
            `INSERT INTO excuses (student_id, excuse_date, category, note) VALUES (?, ?, 'SICK', 'Flu — adviser approved')
             ON DUPLICATE KEY UPDATE category = 'SICK', note = 'Flu — adviser approved'`,
            [ana.id, iso(excDay)],
          );
        }
        // Compute badges from the seeded history so the demo shows them now.
        await recomputeAllBadges();
        void refreshOfflineCache();
      }
    }
    return result;
  });

  async function importCsv(csv: string): Promise<ImportResult> {
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const result: ImportResult = { added: 0, skipped: 0, errors: [] };
    if (lines.length <= 1) return result;
    const syncSectionRegistry = async () => {
      // Also derive grade/section so the Sections page grade filter is correct
      // immediately after an import (startup backfill would only cover restarts).
      await db.execute(
        `INSERT IGNORE INTO sections (grade_section, grade, section)
         SELECT DISTINCT grade_section,
           CASE WHEN grade_section LIKE '% - %' THEN SUBSTRING_INDEX(grade_section, ' - ', 1) ELSE grade_section END,
           CASE WHEN grade_section LIKE '% - %' THEN SUBSTRING_INDEX(grade_section, ' - ', -1) ELSE '' END
         FROM students WHERE grade_section <> ''`,
      );
    };
    const header = lines[0].toLowerCase();
    const start = header.includes('student_no') ? 1 : 0;
    // When a header row is present, locate the gender column by name so it can
    // live anywhere in the file (docs put it last). Legacy files without a
    // gender column fall back to ''; headerless files that append gender as an
    // 8th column keep working positionally.
    let genderIdx = -1;
    if (start === 1) {
      genderIdx = splitCsvLine(lines[0]).map((c) => c.trim().toLowerCase()).indexOf('gender');
    }
    for (let i = start; i < lines.length; i++) {
      const parts = splitCsvLine(lines[i]);
      const [studentNo, fullName, gradeSection, parentPhone, lrn, guardianName, guardianAddress] = parts;
      const gender = genderIdx >= 0 ? parts[genderIdx] : parts.length > 7 ? parts[7] : undefined;
      if (!studentNo || !fullName) {
        result.errors.push(`Row ${i + 1}: missing student_no or full_name`);
        result.skipped++;
        continue;
      }
      try {
        const payload = generatePayload(studentNo);
        // Guardian QR is issued only when a guardian name is present (same rule
        // as the Add/Edit form); it hashes the guardian identity so shared
        // guardians reuse one QR. Rows that name a guardian AUTO-REGISTER it
        // in the guardians registry (find-or-create by name + address) and
        // link the student — bulk import runs no duplicate-name prompt.
        const gName = String(guardianName ?? '').trim();
        const gAddress = String(guardianAddress ?? '').trim();
        let guardianId: number | null = null;
        let guardianPhone = parentPhone || '';
        let guardianQr: string | null = gName ? generateGuardianPayload(gName, gAddress) : null;
        if (gName) {
          const g = await findOrCreateGuardian(gName, gAddress, parentPhone || '');
          guardianId = g.id;
          guardianPhone = g.mobile;
          guardianQr = g.qr_hash_payload;
        }
        const res = await db.execute(
          `INSERT INTO students (student_no, qr_hash_payload, full_name, gender, grade_section, parent_phone,
                                 lrn, guardian_name, guardian_address, guardian_qr_hash_payload, guardian_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            studentNo,
            payload,
            fullName,
            normalizeGender(gender),
            gradeSection || '',
            guardianPhone,
            String(lrn ?? '').trim(),
            gName,
            gAddress,
            guardianQr,
            guardianId,
          ],
        );
        if (gradeSection) await syncEnrollment(res.insertId, gradeSection);
        result.added++;
      } catch (err) {
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
          result.skipped++;
        } else {
          result.errors.push(`Row ${i + 1}: ${(err as Error).message}`);
          result.skipped++;
        }
      }
    }
    await syncSectionRegistry();
    void refreshOfflineCache();
    return result;
  }

  /** Coerces a raw gender value to 'male' | 'female' | '' (lenient about
   *  case and single letters, e.g. 'M' / 'F' from CSV imports). */
  function normalizeGender(raw: unknown): '' | 'male' | 'female' {
    const v = String(raw ?? '').trim().toLowerCase();
    if (v === 'male' || v === 'm') return 'male';
    if (v === 'female' || v === 'f') return 'female';
    return '';
  }

  function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  // ---- Attendance logs -----------------------------------------------------
  ipcMain.handle('tapin:listLogs', async (_e, filter: LogFilter = {}): Promise<{ rows: AttendanceLogRow[]; total: number }> => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.search) {
      const like = `%${filter.search}%`;
      where.push('(s.full_name LIKE ? OR s.student_no LIKE ? OR s.grade_section LIKE ?)');
      params.push(like, like, like);
    }
    if (filter.entryType) {
      where.push('a.entry_type = ?');
      params.push(filter.entryType);
    }
    if (filter.from) {
      where.push('a.scanned_at >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('a.scanned_at <= ?');
      params.push(filter.to);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 50, 500);
    const offset = filter.offset ?? 0;
    const [count] = await db.query<{ c: number }[]>(
      `SELECT COUNT(*) c FROM attendance_logs a JOIN students s ON s.id = a.student_id ${whereSql}`,
      params,
    );
    const flagParams = flagSelectParams(settingsStore.get());
    // Chronological log: newest record first (the # column is the record id).
    const rows = await db.query<AttendanceLogRow[]>(
      `SELECT a.id, a.student_id, a.entry_type, a.scanned_at, a.source,
              s.full_name, s.student_no, s.grade_section,
              ${flagSelectSql()}
       FROM attendance_logs a JOIN students s ON s.id = a.student_id
       ${whereSql}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...flagParams, ...params, limit, offset],
    );
    return { rows, total: count?.c ?? 0 };
  });

  ipcMain.handle('tapin:exportLogsCsv', async (_e, filter: LogFilter = {}): Promise<string> => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.search) {
      const like = `%${filter.search}%`;
      where.push('(s.full_name LIKE ? OR s.student_no LIKE ?)');
      params.push(like, like);
    }
    if (filter.entryType) {
      where.push('a.entry_type = ?');
      params.push(filter.entryType);
    }
    if (filter.from) {
      where.push('a.scanned_at >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      where.push('a.scanned_at <= ?');
      params.push(filter.to);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const flagParams = flagSelectParams(settingsStore.get());
    const rows = await db.query<AttendanceLogRow[]>(
      `SELECT a.id, a.student_id, a.entry_type, a.scanned_at, a.source,
              s.full_name, s.student_no, s.grade_section,
              ${flagSelectSql()}
       FROM attendance_logs a JOIN students s ON s.id = a.student_id
       ${whereSql}
       ORDER BY a.id DESC LIMIT 5000`,
      [...flagParams, ...params],
    );
    const header = 'ID,Student No,Full Name,Grade Section,Type,Source,Flag,Scanned At';
    const body = rows
      .map((r) =>
        [r.id, r.student_no, `"${r.full_name}"`, `"${r.grade_section}"`, r.entry_type, r.source, r.flag, r.scanned_at].join(','),
      )
      .join('\n');
    return `${header}\n${body}`;
  });

  // ---- SMS outbox ----------------------------------------------------------
  // Resolves the Student name for messages without a linked scan (nightly
  // absence alerts insert sms_logs rows with attendance_id = NULL): fall back
  // to any active student whose phone matches the recipient. Used in both the
  // row SELECT and the search WHERE so the two can never drift.
  const studentNameFallback = `COALESCE(s.full_name,
    (SELECT full_name FROM students WHERE parent_phone = sm.parent_phone AND is_active = 1 ORDER BY id LIMIT 1))`;
  ipcMain.handle('tapin:listSms', async (_e, filter: SmsFilter = {}): Promise<{ rows: SmsLogRow[]; total: number }> => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      where.push('sm.status = ?');
      params.push(filter.status);
    }
    if (filter.search) {
      const like = `%${filter.search}%`;
      // Names resolve through the attendance join OR, for messages with no
      // linked scan (nightly absence alerts), by the recipient phone number.
      where.push(`(${studentNameFallback} LIKE ? OR sm.parent_phone LIKE ?)`);
      params.push(like, like);
    }
    if (filter.from) {
      where.push('sm.created_at >= ?');
      params.push(`${filter.from} 00:00:00`);
    }
    if (filter.to) {
      where.push('sm.created_at <= ?');
      params.push(`${filter.to} 23:59:59`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 50, 500);
    const offset = filter.offset ?? 0;
    const [count] = await db.query<{ c: number }[]>(
      `SELECT COUNT(*) c FROM sms_logs sm
       LEFT JOIN attendance_logs a ON a.id = sm.attendance_id
       LEFT JOIN students s ON s.id = a.student_id ${whereSql}`,
      params,
    );
    const rows = await db.query<SmsLogRow[]>(
      `SELECT sm.id, sm.attendance_id, sm.parent_phone, sm.message, sm.status, sm.provider,
              sm.attempts, sm.error, sm.created_at, sm.sent_at,
              ${studentNameFallback} AS full_name,
              a.entry_type, a.scanned_at
       FROM sms_logs sm
       LEFT JOIN attendance_logs a ON a.id = sm.attendance_id
       LEFT JOIN students s ON s.id = a.student_id
       ${whereSql}
       ORDER BY sm.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { rows, total: count?.c ?? 0 };
  });

  ipcMain.handle('tapin:retrySms', async (_e, id: number): Promise<SmsLog> => {
    await db.execute("UPDATE sms_logs SET status = 'PENDING', attempts = 0, error = NULL WHERE id = ?", [id]);
    const [row] = await db.query<SmsLog[]>('SELECT * FROM sms_logs WHERE id = ?', [id]);
    return row;
  });

  ipcMain.handle('tapin:testSms', async (_e, phone: string): Promise<{ ok: boolean; message: string }> => {
    const settings = settingsStore.get();
    const provider = getProvider(settings.sms_provider);
    try {
      await provider.send(
        settings,
        phone,
        `[TapIn Test] ${settings.school_name} SMS gateway test at ${new Date().toLocaleTimeString()}.`,
      );
      return { ok: true, message: `Test SMS delivered via ${provider.id} to ${phone}` };
    } catch (err) {
      return { ok: false, message: `${provider.id}: ${(err as Error).message}` };
    }
  });

  // ---- Reports (PDF / Excel export) ----------------------------------------
  ipcMain.handle('tapin:getReport', async (_e, query: ReportQuery): Promise<ReportData> => {
    return getReportData(query);
  });

  ipcMain.handle('tapin:getReportDrilldown', async (_e, query: ReportDrilldownQuery): Promise<ReportDrilldownResult> => {
    return getReportDrilldown(query);
  });

  async function pickSavePath(
    win: BrowserWindow | null,
    defaultName: string,
    label: string,
    extensions: string[],
  ): Promise<string | null> {
    const opts = {
      defaultPath: defaultName,
      filters: [{ name: label, extensions }],
    };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    return res.canceled || !res.filePath ? null : res.filePath;
  }

  ipcMain.handle('tapin:exportReportPdf', async (e, report: ReportData): Promise<ExportResult> => {
    if (!report) return { ok: false, error: 'No report data to export.' };
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const filePath = await pickSavePath(
        win,
        `tapin-report-${report.from}-to-${report.to}.pdf`,
        'PDF document',
        ['pdf'],
      );
      if (!filePath) return { ok: false };
      // Generated in a dedicated hidden window from the report data — no
      // dependence on the live UI or its print stylesheet.
      const pdf = await exportReportToPdf(report);
      await fs.writeFile(filePath, pdf);
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('tapin:exportReportXlsx', async (e, report: ReportData): Promise<ExportResult> => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const filePath = await pickSavePath(
        win,
        `tapin-report-${report.from}-to-${report.to}.xlsx`,
        'Excel workbook',
        ['xlsx'],
      );
      if (!filePath) return { ok: false };
      const buf = await buildReportWorkbook(report);
      await fs.writeFile(filePath, buf);
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('tapin:sendReportEmail', async (_e, report: ReportData): Promise<EmailResult> => {
    if (!report) return { ok: false, error: 'No report data to send.' };
    return sendReportEmail(report, settingsStore.get());
  });

  ipcMain.handle(
    'tapin:sendReportToAdvisers',
    async (_e, from: string, to: string, schoolYear?: string): Promise<AdviserSendResult> => {
      return sendAdviserReportEmails(
        String(from ?? ''),
        String(to ?? ''),
        settingsStore.get(),
        String(schoolYear ?? '').trim() || undefined,
      );
    },
  );

ipcMain.handle('tapin:testEmail', async (_e, to: string, settings: Settings): Promise<EmailResult> => {
    // Use the settings the admin currently has in the form so the test reflects
    // exactly what they typed (no separate save required first).
    return sendTestEmail(String(to ?? '').trim(), settings ?? settingsStore.get());
  });

  // ---- Admin auth ----------------------------------------------------------
  ipcMain.handle('tapin:login', async (_e, username: string, password: string): Promise<LoginResult> => {
    return authLogin(String(username ?? ''), String(password ?? ''));
  });

  ipcMain.handle('tapin:logout', async (): Promise<void> => {
    // The renderer owns the auth session; this exists so the bridge stays
    // symmetric. (Nothing server-side to tear down for a local kiosk.)
  });

  // ---- Users & roles (dashboard accounts + kiosk staff PINs) ----------------
  ipcMain.handle('tapin:listUsers', async (): Promise<User[]> => {
    return authListUsers();
  });

  ipcMain.handle('tapin:createUser', async (_e, input: UserInput): Promise<User> => {
    return authCreateUser(input);
  });

  ipcMain.handle('tapin:updateUser', async (_e, id: number, patch: Partial<UserInput>): Promise<User> => {
    return authUpdateUser(id, patch);
  });

  ipcMain.handle('tapin:deleteUser', async (_e, id: number): Promise<void> => {
    return authDeleteUser(id);
  });

  // ---- Settings ------------------------------------------------------------
  ipcMain.handle('tapin:getSettings', async (): Promise<Settings> => settingsStore.get());

  ipcMain.handle('tapin:verifyStaffPin', async (_e, pin: string): Promise<boolean> => {
    // Matches any account's stored PIN hash (constant-time via pbkdf2).
    return authVerifyStaffPin(pin);
  });

  ipcMain.handle('tapin:updateSettings', async (_e, patch: Partial<Settings>): Promise<Settings> => {
    // absence_last_run is owned by the absence service; never let a stale
    // renderer copy clobber it (that would re-trigger backfill + SMS).
    delete patch.absence_last_run;
    // adviser_report_last_run is owned by the adviser-report service; a stale
    // renderer copy must not re-trigger (or suppress) today's send.
    delete patch.adviser_report_last_run;
    // In auto-detect mode the GSM provider owns gsm_com_port/gsm_baud (it
    // persists the detected port/baud itself) — a stale renderer copy must
    // not overwrite the live detection.
    if (patch.gsm_auto_port === true) {
      delete patch.gsm_com_port;
      delete patch.gsm_baud;
    }
    // The renderer sends the logo as a data URI; persist it to a file on disk
    // and store only the tapin-logo:// URL so the settings table never holds
    // binary blobs. Clearing the logo removes the file(s).
    if (typeof patch.logo_url === 'string' && patch.logo_url.startsWith('data:')) {
      try {
        patch.logo_url = await saveLogo(patch.logo_url);
      } catch (err) {
        // Fall back to storing the data URI itself — the logo keeps working,
        // it just lives in the settings table until the next successful save.
        console.error('[tapin] failed to persist logo file:', err);
      }
    } else if (patch.logo_url === null) {
      await deleteAllLogos();
    }
const next = await settingsStore.update(patch);
    const provider = getProvider(next.sms_provider);
    broadcast('tapin:status', { db: db.getStatus(), sms: await provider.verify(next) });
    return next;
  });

  // ---- Badges & excused days (weekly recognition) ---------------------------
  ipcMain.handle('tapin:getStudentBadges', async (_e, studentId: number): Promise<StudentBadgeSummary> => {
    return evaluateStudentToday(Number(studentId));
  });

  ipcMain.handle(
    'tapin:listBadges',
    async (_e, schoolYear?: string, from?: string, to?: string): Promise<Badge[]> => {
      return listBadges(schoolYear, from, to);
    },
  );

  ipcMain.handle(
    'tapin:badgeLeaderboard',
    async (_e, topN = 10, section?: string, schoolYear?: string, from?: string, to?: string): Promise<BadgeLeaderboardRow[]> => {
      return badgeLeaderboard(topN, section, schoolYear, from, to);
    },
  );

  ipcMain.handle('tapin:listExcuses', async (_e, studentId: number): Promise<Excuse[]> => {
    return listExcuses(Number(studentId));
  });

  ipcMain.handle(
    'tapin:addExcuse',
    async (
      _e,
      studentId: number,
      excuseDate: string,
      category: ExcuseCategory,
      note?: string,
    ): Promise<Excuse> => {
      const excuse = await addExcuse(studentId, excuseDate, category, note);
      // Self-heal: an excuse can restore (or a typo can break) a badge.
      await recomputeStudent(excuse.studentId);
      return excuse;
    },
  );

  ipcMain.handle('tapin:removeExcuse', async (_e, excuseId: number): Promise<void> => {
    const studentId = await removeExcuse(Number(excuseId));
    if (studentId) await recomputeStudent(studentId);
  });

  // ---- Visitors (walk-in QR registration & IN/OUT logging) -----------------
  ipcMain.handle('tapin:listVisitors', async (_e, search?: string): Promise<Visitor[]> => {
    return listVisitors(search);
  });

  ipcMain.handle('tapin:createVisitor', async (_e, input: VisitorInput): Promise<Visitor> => {
    return createVisitor(input);
  });

  ipcMain.handle(
    'tapin:updateVisitor',
    async (_e, id: number, patch: Partial<VisitorInput & { is_active?: boolean }>): Promise<Visitor> => {
      return updateVisitor(id, patch);
    },
  );

  ipcMain.handle('tapin:deleteVisitor', async (_e, id: number): Promise<void> => {
    return deleteVisitor(id);
  });

  ipcMain.handle('tapin:listVisitorLogs', async (_e, visitorId: number): Promise<VisitorLogRow[]> => {
    return listVisitorLogs(visitorId);
  });

  ipcMain.handle(
    'tapin:listAllVisitorLogs',
    async (_e, filter?: { from?: string; to?: string }): Promise<VisitorLogRow[]> => {
      return listAllVisitorLogs(filter);
    },
  );

  // ---- Auto-update (GitHub Releases) --------------------------------------
  ipcMain.handle('tapin:checkForUpdates', async (): Promise<{ success: boolean; message?: string }> => {
    return checkForUpdates();
  });

  ipcMain.handle('tapin:downloadUpdate', async (): Promise<{ success: boolean; message?: string }> => {
    return downloadUpdate();
  });

  ipcMain.handle('tapin:installUpdate', async (): Promise<{ success: boolean }> => {
    return installUpdate();
  });

  ipcMain.handle('tapin:getAppVersion', async (): Promise<string> => {
    return app.getVersion();
  });

  // ---- App activation (license server) ------------------------------------
  ipcMain.handle('tapin:checkLicense', async (): Promise<import('../shared/types').LicenseStatus> => {
    return checkLicense();
  });

  ipcMain.handle(
    'tapin:activateLicense',
    async (_e, licenseKey: string): Promise<import('../shared/types').ActivationResult> => {
      return activateLicense(String(licenseKey ?? ''));
    },
  );

  ipcMain.handle('tapin:getMachineId', async (): Promise<string> => {
    return getMachineIdValue();
  });
}
