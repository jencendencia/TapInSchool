// The core scan event processor (PRD §3.2):
//   1. Decode QR payload → exact match on students.qr_hash_payload
//   2. Debounce: reject identical scans within `debounce_seconds`
//   3. Toggle: latest scan today IN → OUT, otherwise IN
//   4. Insert attendance_logs + enqueue sms_logs (PENDING)
//
// When MySQL is unreachable, scans are processed from the local offline
// snapshot (students + today's scan state) and written to the write-behind
// queue (services/offline.ts) so no scan is ever lost.
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { maskPhone } from './qr';
import { computeScanFlag, flagSelectParams, flagSelectSql } from './bell-times';
import { buildSmsMessage, resolveTemplate } from '../sms/message-builder';
import {
  enqueueScanEvent,
  getCachedStudentByPayload,
  getLastScanToday,
  recordScan,
  toLocalMysqlTime,
  upsertCachedStudent,
  type CachedStudent,
} from './offline';
import type {
  ActivityItem,
  AttendanceLog,
  ScanResult,
  ScanSource,
  Student,
} from '../../shared/types';

export interface ScanEventBus {
  onScanResult(result: ScanResult): void;
  onActivity(items: ActivityItem[]): void;
}

// Serializes ALL scan processing (scanner, webcam, manual) so debounce/toggle
// checks and inserts can never interleave for the same student.
let scanChain: Promise<unknown> = Promise.resolve();

// Set once the online path has committed the attendance insert. The offline
// fallback must NOT run after a commit — it would duplicate the log + SMS.
let onlineScanCommitted = false;

export function enqueueScan(payload: string, source: ScanSource, bus: ScanEventBus): Promise<ScanResult> {
  const run = scanChain.then(() => processScan(payload, source, bus));
  scanChain = run.catch(() => undefined);
  return run;
}

export async function processScan(payload: string, source: ScanSource, bus: ScanEventBus): Promise<ScanResult> {
  const trimmed = (payload || '').trim();
  if (!trimmed) {
    return { kind: 'UNRECOGNIZED', message: 'Empty scan payload' };
  }

  onlineScanCommitted = false;
  if (!db.isOnline()) {
    return processScanOffline(trimmed, source, bus);
  }
  try {
    return await processScanOnline(trimmed, source, bus);
  } catch (err) {
    // A query failed while nominally online (connection dropped mid-scan) —
    // fall back to the local snapshot so the scan is still recorded. Only do
    // this when nothing has been committed yet (avoid duplicating a log whose
    // attendance insert already succeeded).
    if (isConnectionError(err) && !onlineScanCommitted) {
      console.error('[tapin] online scan failed, using offline queue:', err);
      return processScanOffline(trimmed, source, bus);
    }
    throw err;
  }
}

function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = String(e?.code ?? '');
  return (
    e?.message === 'Database is offline' ||
    code.startsWith('ECONN') ||
    code.startsWith('ETIMEDOUT') ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' ||
    code === 'ER_CON_COUNT_ERROR' ||
    code === 'ER_ACCESS_DENIED_ERROR'
  );
}

function toCachedStudent(student: Student): CachedStudent {
  return {
    id: student.id,
    student_no: student.student_no,
    qr_hash_payload: student.qr_hash_payload,
    full_name: student.full_name,
    grade_section: student.grade_section,
    parent_phone: student.parent_phone || null,
    photo_url: student.photo_url || null,
    is_active: student.is_active,
  };
}

function toStudent(c: CachedStudent): Student {
  return {
    id: c.id,
    student_no: c.student_no,
    qr_hash_payload: c.qr_hash_payload,
    full_name: c.full_name,
    grade_section: c.grade_section,
    parent_phone: c.parent_phone || '',
    photo_url: c.photo_url,
    is_active: c.is_active,
    created_at: '',
  };
}

async function processScanOnline(
  trimmed: string,
  source: ScanSource,
  bus: ScanEventBus,
): Promise<ScanResult> {
  const settings = settingsStore.get();

  const students = await db.query<Student[]>(
    'SELECT * FROM students WHERE qr_hash_payload = ? LIMIT 1',
    [trimmed],
  );
  const student = students[0];

  if (!student) {
    const result: ScanResult = {
      kind: 'UNRECOGNIZED',
      message: 'Unrecognized QR code. Please report to the admin office.',
    };
    bus.onScanResult(result);
    return result;
  }
  if (!student.is_active) {
    const result: ScanResult = {
      kind: 'BLOCKED',
      message: 'Access restricted. Please report to the Principal / Admin Office.',
      student,
    };
    bus.onScanResult(result);
    return result;
  }

  // --- Debounce (FR-5): ignore the same student within debounce_seconds ----
  const recent = await db.query<{ id: number; scanned_at: Date }[]>(
    'SELECT id, scanned_at FROM attendance_logs WHERE student_id = ? AND scanned_at >= CURDATE() ORDER BY scanned_at DESC LIMIT 1',
    [student.id],
  );
  if (recent[0]) {
    const elapsedMs = Date.now() - new Date(recent[0].scanned_at).getTime();
    if (elapsedMs < settings.debounce_seconds * 1000) {
      const wait = Math.max(1, Math.ceil((settings.debounce_seconds * 1000 - elapsedMs) / 1000));
      const result: ScanResult = {
        kind: 'DUPLICATE',
        message: `QR already scanned — please wait ${wait}s.`,
        student,
      };
      bus.onScanResult(result);
      return result;
    }
  }

  // --- Toggle engine (FR-4) ------------------------------------------------
  const lastToday = await db.query<{ entry_type: 'IN' | 'OUT' }[]>(
    'SELECT entry_type FROM attendance_logs WHERE student_id = ? AND scanned_at >= CURDATE() ORDER BY scanned_at DESC LIMIT 1',
    [student.id],
  );
  const entryType = lastToday[0]?.entry_type === 'IN' ? 'OUT' : 'IN';

  // --- Commit log (FR-1, FR-3) ---------------------------------------------
  const insert = await db.execute(
    'INSERT INTO attendance_logs (student_id, entry_type, source) VALUES (?, ?, ?)',
    [student.id, entryType, source],
  );
  onlineScanCommitted = true;
  const scannedAt = new Date();
  const flag = computeScanFlag(entryType, scannedAt, settings);
  const log: AttendanceLog = {
    id: insert.insertId,
    student_id: student.id,
    entry_type: entryType,
    scanned_at: scannedAt.toISOString(),
    source,
    flag,
  };

  // --- Enqueue SMS (FR-3) --------------------------------------------------
  let smsQueued = false;
  if (student.parent_phone) {
    const message = buildSmsMessage(resolveTemplate(settings), {
      fullName: student.full_name,
      gradeSection: student.grade_section,
      entryType,
      flag,
      scannedAt,
      school: settings.school_name,
    });
    await db.execute(
      "INSERT INTO sms_logs (attendance_id, parent_phone, message, status) VALUES (?, ?, ?, 'PENDING')",
      [log.id, student.parent_phone, message],
    );
    smsQueued = true;
  }

  const result: ScanResult = {
    kind: 'SUCCESS',
    message:
      entryType === 'IN'
        ? 'Checked IN — have a great day!'
        : 'Checked OUT — see you tomorrow!',
    student,
    entryType,
    log,
    smsQueued,
    parentPhoneMasked: smsQueued ? maskPhone(student.parent_phone) : undefined,
  };

  // Keep the offline snapshot fresh in case the DB drops right after this scan.
  const cached = toCachedStudent(student);
  upsertCachedStudent(cached);
  recordScan(cached.id, entryType, Date.now());

  bus.onScanResult(result);
  const activityItems = await getRecentActivity(5);
  bus.onActivity(activityItems);
  return result;
}

/** Processes a scan purely from the local snapshot and queues it for replay. */
async function processScanOffline(
  trimmed: string,
  source: ScanSource,
  bus: ScanEventBus,
): Promise<ScanResult> {
  const settings = settingsStore.get();
  const student = getCachedStudentByPayload(trimmed);

  if (!student) {
    const result: ScanResult = {
      kind: 'OFFLINE',
      message:
        'Database offline and no local student data loaded yet — scan not recorded. Check the MySQL connection.',
    };
    bus.onScanResult(result);
    return result;
  }
  if (!student.is_active) {
    const result: ScanResult = {
      kind: 'BLOCKED',
      message: 'Access restricted. Please report to the Principal / Admin Office.',
      student: toStudent(student),
    };
    bus.onScanResult(result);
    return result;
  }

  // --- Debounce (FR-5) from the local snapshot -------------------------------
  const lastToday = getLastScanToday(student.id);
  const now = Date.now();
  if (lastToday) {
    const elapsedMs = now - lastToday.time;
    if (elapsedMs < settings.debounce_seconds * 1000) {
      const wait = Math.max(1, Math.ceil((settings.debounce_seconds * 1000 - elapsedMs) / 1000));
      const result: ScanResult = {
        kind: 'DUPLICATE',
        message: `QR already scanned — please wait ${wait}s.`,
        student: toStudent(student),
      };
      bus.onScanResult(result);
      return result;
    }
  }

  // --- Toggle engine (FR-4) from the local snapshot --------------------------
  const entryType = lastToday?.type === 'IN' ? 'OUT' : 'IN';
  const scannedAtDate = new Date(now);
  const flag = computeScanFlag(entryType, scannedAtDate, settings);
  const scannedAt = toLocalMysqlTime(scannedAtDate);

  // --- Write-behind: persist locally, replay when MySQL returns --------------
  try {
    await enqueueScanEvent({
      studentId: student.id,
      studentNo: student.student_no,
      fullName: student.full_name,
      gradeSection: student.grade_section,
      parentPhone: student.parent_phone || null,
      entryType,
      scannedAt,
      source,
      smsQueued: !!student.parent_phone,
      flag,
    });
  } catch (err) {
    // Couldn't persist the scan locally (e.g. disk full) — do NOT claim it was
    // recorded; surface an error and keep the toggle state untouched so the
    // student can retry.
    console.error('[tapin] failed to queue offline scan:', err);
    const result: ScanResult = {
      kind: 'ERROR',
      message: 'Scan could not be saved (storage error). Please report to the admin office.',
      student: toStudent(student),
    };
    bus.onScanResult(result);
    return result;
  }
  recordScan(student.id, entryType, now);

  const result: ScanResult = {
    kind: 'SUCCESS',
    message:
      entryType === 'IN'
        ? 'Checked IN — have a great day!'
        : 'Checked OUT — see you tomorrow!',
    student: toStudent(student),
    entryType,
    log: { id: 0, student_id: student.id, entry_type: entryType, scanned_at: scannedAt, source, flag },
    smsQueued: !!student.parent_phone,
    parentPhoneMasked: student.parent_phone ? maskPhone(student.parent_phone) : undefined,
    queuedOffline: true,
  };
  bus.onScanResult(result);
  // The activity feed is DB-backed; it refreshes once the queue is replayed.
  return result;
}

// Shared by the SMS queue worker too, so the activity feed labels LATE/EARLY
// rows identically everywhere.
export async function getRecentActivity(limit = 5): Promise<ActivityItem[]> {
  const settings = settingsStore.get();
  return db.query<ActivityItem[]>(
    `SELECT a.id, s.full_name, s.grade_section, s.student_no,
            a.entry_type, a.scanned_at, a.source,
            sm.status AS sms_status, sm.parent_phone,
            ${flagSelectSql()}
     FROM attendance_logs a
     JOIN students s ON s.id = a.student_id
     LEFT JOIN sms_logs sm ON sm.attendance_id = a.id
     ORDER BY a.scanned_at DESC
     LIMIT ?`,
    [...flagSelectParams(settings), limit],
  );
}
