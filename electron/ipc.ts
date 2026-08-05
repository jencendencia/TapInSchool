// IPC surface for the renderer. Every channel maps 1:1 to a method on the
// shared TapinApi contract (shared/types.ts).
import { ipcMain, BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'fs';
import { db } from './db/connection';
import { settingsStore } from './db/settings';
import { enqueueScan, getRecentActivity } from './services/attendance';
import { login as authLogin } from './services/auth';
import { deleteAllLogos, saveLogo } from './services/logo';
import { decorateDbDetail } from './services/clock';
import { flagCutoffs, flagSelectParams, flagSelectSql } from './services/bell-times';
import { pendingQueueCount, refreshOfflineCache } from './services/offline';
import { generatePayload } from './services/qr';
import { getReportData } from './services/report';
import { exportReportToPdf } from './services/report-pdf';
import { buildReportWorkbook } from './services/report-export';
import { sendReportEmail, sendTestEmail } from './services/report-email';
import { getProvider } from './sms/providers';
import type {
  ActivityItem,
  AttendanceLogRow,
  EmailResult,
  ExportResult,
  ImportResult,
  LogFilter,
  LoginResult,
  OverviewStats,
  ReportData,
  ReportQuery,
  ScanResult,
  ScanSource,
  Settings,
  SmsFilter,
  SmsLog,
  SmsLogRow,
  Student,
  StudentInput,
  SystemStatus,
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
    return enqueueScan(payload, source, {
      onScanResult: (r) => broadcast('tapin:scan-result', r),
      onActivity: (items) => broadcast('tapin:activity', items),
    });
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

  ipcMain.handle('tapin:createStudent', async (_e, input: StudentInput): Promise<Student> => {
    const payload = generatePayload(input.student_no);
    const res = await db.execute(
      `INSERT INTO students (student_no, qr_hash_payload, full_name, grade_section, parent_phone, photo_url, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.student_no,
        payload,
        input.full_name,
        input.grade_section || '',
        input.parent_phone || '',
        input.photo_url || null,
        input.is_active ?? true,
      ],
    );
    const [row] = await db.query<Student[]>('SELECT * FROM students WHERE id = ?', [res.insertId]);
    // Keep the offline snapshot current so offline scans see new students.
    void refreshOfflineCache();
    return row;
  });

  ipcMain.handle('tapin:updateStudent', async (_e, id: number, input: Partial<StudentInput>): Promise<Student> => {
    await db.execute(
      'UPDATE students SET student_no = ?, full_name = ?, grade_section = ?, parent_phone = ?, photo_url = ?, is_active = ? WHERE id = ?',
      [
        input.student_no ?? '',
        input.full_name ?? '',
        input.grade_section ?? '',
        input.parent_phone ?? '',
        input.photo_url ?? null,
        input.is_active ?? true,
        id,
      ],
    );
    const [row] = await db.query<Student[]>('SELECT * FROM students WHERE id = ?', [id]);
    void refreshOfflineCache();
    return row;
  });

  ipcMain.handle('tapin:deleteStudent', async (_e, id: number): Promise<void> => {
    await db.execute('DELETE FROM students WHERE id = ?', [id]);
    void refreshOfflineCache();
  });

  ipcMain.handle('tapin:generateQrPayload', (_e, studentNo: string): string => {
    return generatePayload(studentNo);
  });

  ipcMain.handle('tapin:importStudentsCsv', async (_e, csv: string): Promise<ImportResult> => {
    return importCsv(csv);
  });

  ipcMain.handle('tapin:seedDemoData', async (): Promise<ImportResult> => {
    const csv = [
      'student_no,full_name,grade_section,parent_phone',
      '2024-0112,Juan Dela Cruz,Grade 7 - Section A,09171234567',
      '2024-0113,Maria Santos,Grade 7 - Section A,09182345678',
      '2024-0215,Carlos Garcia,Grade 8 - Section B,09193456789',
      '2024-0318,Ana Reyes,Grade 9 - Section C,09184567890',
      '2024-0421,Miguel Torres,Grade 10 - Section D,09195678901',
      '2024-0524,Liza Fernandez,Grade 11 - STEM,09196789012',
    ].join('\n');
    return importCsv(csv);
  });

  async function importCsv(csv: string): Promise<ImportResult> {
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const result: ImportResult = { added: 0, skipped: 0, errors: [] };
    if (lines.length <= 1) return result;
    const header = lines[0].toLowerCase();
    const start = header.includes('student_no') ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const [studentNo, fullName, gradeSection, parentPhone] = splitCsvLine(lines[i]);
      if (!studentNo || !fullName) {
        result.errors.push(`Row ${i + 1}: missing student_no or full_name`);
        result.skipped++;
        continue;
      }
      try {
        const payload = generatePayload(studentNo);
        await db.execute(
          'INSERT INTO students (student_no, qr_hash_payload, full_name, grade_section, parent_phone) VALUES (?, ?, ?, ?, ?)',
          [studentNo, payload, fullName, gradeSection || '', parentPhone || ''],
        );
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
    void refreshOfflineCache();
    return result;
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
    const rows = await db.query<AttendanceLogRow[]>(
      `SELECT a.id, a.student_id, a.entry_type, a.scanned_at, a.source,
              s.full_name, s.student_no, s.grade_section,
              ${flagSelectSql()}
       FROM attendance_logs a JOIN students s ON s.id = a.student_id
       ${whereSql}
       ORDER BY a.scanned_at DESC LIMIT ? OFFSET ?`,
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
       ORDER BY a.scanned_at DESC LIMIT 5000`,
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
  ipcMain.handle('tapin:listSms', async (_e, filter: SmsFilter = {}): Promise<{ rows: SmsLogRow[]; total: number }> => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      where.push('sm.status = ?');
      params.push(filter.status);
    }
    if (filter.search) {
      const like = `%${filter.search}%`;
      where.push('(s.full_name LIKE ? OR sm.parent_phone LIKE ?)');
      params.push(like, like);
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
              s.full_name, a.entry_type, a.scanned_at
       FROM sms_logs sm
       LEFT JOIN attendance_logs a ON a.id = sm.attendance_id
       LEFT JOIN students s ON s.id = a.student_id
       ${whereSql}
       ORDER BY sm.created_at DESC LIMIT ? OFFSET ?`,
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

  ipcMain.handle('tapin:testEmail', async (_e, to: string): Promise<EmailResult> => {
    return sendTestEmail(String(to ?? '').trim(), settingsStore.get());
  });

  // ---- Admin auth ----------------------------------------------------------
  ipcMain.handle('tapin:login', async (_e, username: string, password: string): Promise<LoginResult> => {
    return authLogin(String(username ?? ''), String(password ?? ''));
  });

  ipcMain.handle('tapin:logout', async (): Promise<void> => {
    // The renderer owns the auth session; this exists so the bridge stays
    // symmetric. (Nothing server-side to tear down for a local kiosk.)
  });

  // ---- Settings ------------------------------------------------------------
  ipcMain.handle('tapin:getSettings', async (): Promise<Settings> => settingsStore.get());

  ipcMain.handle('tapin:updateSettings', async (_e, patch: Partial<Settings>): Promise<Settings> => {
    // absence_last_run is owned by the absence service; never let a stale
    // renderer copy clobber it (that would re-trigger backfill + SMS).
    delete patch.absence_last_run;
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
}
