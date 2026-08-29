// The core scan event processor (PRD §3.2):
//   1. Decode QR payload → exact match on students.qr_hash_payload
//   2. Debounce: reject identical scans within `debounce_seconds`
//   3. Toggle: latest scan today IN → OUT, otherwise IN
//   4. Insert attendance_logs + enqueue sms_logs (PENDING)
//
// When MySQL is unreachable, scans are processed from the local offline
// snapshot (students + today's scan state) and written to the write-behind
// queue (services/offline.ts) so no scan is ever lost.
import type { ResultSetHeader } from 'mysql2/promise';
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { withRetry } from './db-retry';
import { maskPhone } from './qr';
import { computeScanFlag, flagSelectParams, flagSelectSql, midpointMinutes } from './bell-times';
import { buildSmsMessage, resolveTemplate } from '../sms/message-builder';
import { forcedEntryType, getScanMode, getSessionMode } from './scan-mode';
import {
  enqueueScanEvent,
  enqueueVisitorScanEvent,
  getCachedStudentByGuardianPayload,
  getCachedStudentByPayload,
  getCachedVisitorByPayload,
  getLastScanToday,
  getVisitorLastScanToday,
  recordScan,
  recordVisitorScan,
  toLocalMysqlTime,
  upsertCachedStudent,
  upsertCachedVisitor,
  type CachedStudent,
} from './offline';
import { processVisitorScan } from './visitors';
import type {
  ActivityItem,
  AttendanceLog,
  EntryType,
  GuardianChildReport,
  GuardianDayReport,
  ScanResult,
  ScanSource,
  SessionMode,
  Student,
  Visitor,
} from '../../shared/types';

export interface ScanEventBus {
  onScanResult(result: ScanResult): void;
  onActivity(items: ActivityItem[]): void;
}

// Context-aware scan messages: the toggle engine supports 4 scans per day
// (IN/OUT morning, IN/OUT afternoon). The message reflects which session
// the student is in based on the bell times.
function scanMessage(entryType: EntryType, settings: { am_time_in: string; am_time_out: string; pm_time_in: string; pm_time_out: string }): string {
  const mid = midpointMinutes(settings as any);
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  const isAfternoon = now >= mid;
  if (entryType === 'IN') {
    return isAfternoon ? 'Checked IN — welcome back!' : 'Checked IN — have a great day!';
  }
  return isAfternoon ? 'Checked OUT — see you tomorrow!' : 'Checked OUT — enjoy your break!';
}

// Serializes scans for the same payload while allowing different students to
// proceed concurrently. This keeps a slow student lookup from blocking the
// whole gate without allowing duplicate same-student toggles to interleave.
const scanChains = new Map<string, Promise<unknown>>();

export function enqueueScan(payload: string, source: ScanSource, bus: ScanEventBus): Promise<ScanResult> {
  const key = (payload || '').trim();
  const previous = scanChains.get(key) ?? Promise.resolve();
  const run = previous.then(() => processScan(payload, source, bus));
  const settled = run.catch(() => undefined);
  scanChains.set(key, settled);
  void settled.then(() => {
    if (scanChains.get(key) === settled) scanChains.delete(key);
  });
  return run;
}

export async function processScan(payload: string, source: ScanSource, bus: ScanEventBus): Promise<ScanResult> {
  const trimmed = (payload || '').trim();
  if (!trimmed) {
    return { kind: 'UNRECOGNIZED', message: 'Empty scan payload' };
  }

  // Kiosk gate-direction mode: 'auto' → undefined (toggle engine decides);
  // 'in'/'out' → every scan is forced to that entry type.
  const forcedType = forcedEntryType(getScanMode());
  // Capture the session with the scan request. Manual PIN/search can take
  // long enough for the UI mode to change before the DB insert completes.
  const session = getSessionMode();

  const scanState = { onlineCommitted: false };
  if (!db.isOnline()) {
    return processScanOffline(trimmed, source, bus, forcedType, session);
  }
  try {
    return await processScanOnline(trimmed, source, bus, forcedType, session, scanState);
  } catch (err) {
    // A query failed while nominally online (connection dropped mid-scan) —
    // fall back to the local snapshot so the scan is still recorded. Only do
    // this when nothing has been committed yet (avoid duplicating a log whose
    // attendance insert already succeeded).
    if (isConnectionError(err) && !scanState.onlineCommitted) {
      console.error('[tapin] online scan failed, using offline queue:', err);
      return processScanOffline(trimmed, source, bus, forcedType, session);
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
    guardian_qr_hash_payload: student.guardian_qr_hash_payload || null,
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
    // The offline snapshot is a minimal scan-validity cache — gender is not
    // needed to process a scan, so it defaults to '' here (the full row with
    // gender is loaded on the online path).
    gender: '',
    grade_section: c.grade_section,
    parent_phone: c.parent_phone || '',
    lrn: '',
    guardian_name: '',
    guardian_address: '',
    guardian_qr_hash_payload: c.guardian_qr_hash_payload || null,
    // The snapshot is a minimal scan-validity cache — the guardian link is not
    // needed to process a scan, so it defaults to null here.
    guardian_id: null,
    photo_url: c.photo_url,
    is_active: c.is_active,
    created_at: '',
    updated_at: '',
  };
}

async function processScanOnline(
  trimmed: string,
  source: ScanSource,
  bus: ScanEventBus,
  forcedType: EntryType | undefined,
  session: SessionMode = 'auto',
  scanState: { onlineCommitted: boolean },
): Promise<ScanResult> {
  const settings = settingsStore.get();

  const students = await db.query<Student[]>(
    'SELECT * FROM students WHERE qr_hash_payload = ? LIMIT 1',
    [trimmed],
  );
  let student = students[0];

  // Guardian QR (GP-…)? No attendance is recorded — the guardian sees the
  // day report for EVERY child sharing this guardian identity.
  if (!student) {
    const guardians = await db.query<Student[]>(
      'SELECT * FROM students WHERE guardian_qr_hash_payload = ? ORDER BY id ASC',
      [trimmed],
    );
    if (guardians.length) return handleGuardianScan(guardians, bus);

    // Visitor QR (VP-…)? Check the visitors table.
    if (trimmed.startsWith('VP-')) {
      const visitors = await db.query<Visitor[]>(
        'SELECT * FROM visitors WHERE qr_hash_payload = ? LIMIT 1',
        [trimmed],
      );
      const visitor = visitors[0];
      if (!visitor) {
        const result: ScanResult = {
          kind: 'UNRECOGNIZED',
          message: 'Unrecognized visitor QR code. Please register at the gate.',
        };
        bus.onScanResult(result);
        return result;
      }
      if (!visitor.is_active) {
        const result: ScanResult = {
          kind: 'BLOCKED',
          message: 'Visitor access restricted. Please contact the admin office.',
          visitor,
        };
        bus.onScanResult(result);
        return result;
      }
      const { result } = await processVisitorScan(visitor, source, forcedType);
      // Keep the offline snapshot fresh in case the DB drops right after this
      // scan (mirrors the student flow below).
      upsertCachedVisitor(visitor);
      if (result.entryType) recordVisitorScan(visitor.id, result.entryType, Date.now());
      bus.onScanResult(result);
      return result;
    }

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
  const lastToday = await db.query<{ id: number; scanned_at: Date; entry_type: EntryType }[]>(
    'SELECT id, scanned_at, entry_type FROM attendance_logs WHERE student_id = ? AND scanned_at >= CURDATE() ORDER BY scanned_at DESC LIMIT 1',
    [student.id],
  );
  if (lastToday[0]) {
    const elapsedMs = Date.now() - new Date(lastToday[0].scanned_at).getTime();
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
  // 'auto': the last scan today decides (IN → next OUT, else IN). A forced
  // gate mode (kiosk toggle) overrides the toggle so gate staff can record a
  // correct check-OUT for a student who forgot their morning swipe.
  const entryType = forcedType ?? (lastToday[0]?.entry_type === 'IN' ? 'OUT' : 'IN');

  // --- Commit log + SMS (FR-1, FR-3) in ONE transaction (C1) ----------------
  // The attendance insert and its parent SMS must commit together: a crash
  // between them would record the scan with no notification (or notify
  // without a log). A deadlock / lock-wait timeout (1213/1205 — normal at
  // peak hour when two machines scan related rows) is retried by withRetry;
  // the transaction guarantees the retried attempt starts clean, so the scan
  // is never double-logged or the parent double-notified.
  const committed = await withRetry(() =>
    db.withConnection(async (conn) => {
      await conn.beginTransaction();
      try {
        // Server time (C5): stamp the scan with the DB server's clock (NOW(3))
        // instead of the kiosk's, so absence/badges are computed on the same
        // day even when a kiosk clock drifts. The offline write-behind path
        // keeps the kiosk's own time — it has no server to ask (see offline.ts).
        const tsRows = (await conn.query('SELECT NOW(3) AS ts'))[0] as Array<{ ts: string }>;
        const serverTs = String(tsRows[0]?.ts ?? '');
        let scannedAt = serverTs ? new Date(serverTs) : new Date();

        // Session mode override: when the gate staff manually selects AM or PM,
        // adjust the scan timestamp so it falls within the correct session.
        if (session === 'am' || session === 'pm') {
          const parseHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
          const amOut = settings.am_time_out ? parseHHMM(settings.am_time_out) : 720;
          const pmIn = settings.pm_time_in ? parseHHMM(settings.pm_time_in) : 780;
          if (session === 'am') {
            // Place scan in the middle of the AM session (between am_time_in and am_time_out)
            const amIn = settings.am_time_in ? parseHHMM(settings.am_time_in) : 420;
            const targetMin = Math.round((amIn + amOut) / 2);
            scannedAt = new Date(scannedAt);
            scannedAt.setHours(Math.floor(targetMin / 60), targetMin % 60, 0, 0);
          } else {
            // Place scan in the middle of the PM session (between pm_time_in and pm_time_out)
            const pmOut = settings.pm_time_out ? parseHHMM(settings.pm_time_out) : 960;
            const targetMin = Math.round((pmIn + pmOut) / 2);
            scannedAt = new Date(scannedAt);
            scannedAt.setHours(Math.floor(targetMin / 60), targetMin % 60, 0, 0);
          }
        }

        const flag = computeScanFlag(entryType, scannedAt, settings);
        // Format scannedAt as MySQL DATETIME(3) string
        const pad = (n: number) => String(n).padStart(2, '0');
        const fmtTs = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
        const scanTs = session === 'am' || session === 'pm' ? fmtTs(scannedAt) : serverTs;
        // Type the INSERT result so insertId is available (mysql2's default
        // QueryResult union doesn't expose it).
        const [insertRes] = await conn.execute<ResultSetHeader>(
          'INSERT INTO attendance_logs (student_id, entry_type, source, scanned_at) VALUES (?, ?, ?, ?)',
          [student.id, entryType, source, scanTs],
        );
        const log: AttendanceLog = {
          id: insertRes.insertId,
          student_id: student.id,
          entry_type: entryType,
          scanned_at: scannedAt.toISOString(),
          source,
          flag,
        };
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
          await conn.execute(
            "INSERT INTO sms_logs (attendance_id, parent_phone, message, status) VALUES (?, ?, ?, 'PENDING')",
            [log.id, student.parent_phone, message],
          );
          smsQueued = true;
        }
        await conn.commit();
        return { log, smsQueued };
      } catch (err) {
        await conn.rollback().catch(() => undefined);
        throw err;
      }
    }),
  );
  if (!committed) throw new Error('Database is offline');
  scanState.onlineCommitted = true;
  const { log, smsQueued } = committed;

  const result: ScanResult = {
    kind: 'SUCCESS',
    message: scanMessage(entryType, settings),
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
  void getRecentActivity(5).then((activityItems) => bus.onActivity(activityItems)).catch(() => undefined);
  return result;
}

/**
 * Guardian QR: read-only — build the day report for every child that shares
 * this guardian identity and show it to the guardian. No IN/OUT toggle, no
 * SMS, no offline write.
 */
async function handleGuardianScan(students: Student[], bus: ScanEventBus): Promise<ScanResult> {
  const settings = settingsStore.get();
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const active = students.filter((s) => s.is_active);
  if (!active.length) {
    // Every child under this guardian is deactivated — same gate as a student scan.
    const result: ScanResult = {
      kind: 'BLOCKED',
      message: 'Access restricted. Please report to the Principal / Admin Office.',
      student: students[0],
    };
    bus.onScanResult(result);
    return result;
  }
  const now = new Date();
  const children: GuardianChildReport[] = [];
  for (const s of active) {
    const rows = await db.query<{ scanned_at: Date; entry_type: 'IN' | 'OUT'; source: ScanSource }[]>(
      `SELECT scanned_at, entry_type, source FROM attendance_logs
       WHERE student_id = ? AND scanned_at >= CURDATE()
       ORDER BY scanned_at ASC`,
      [s.id],
    );
    const scans = rows.map((r) => {
      const at = new Date(r.scanned_at);
      return {
        time: hm(at),
        entryType: r.entry_type,
        flag: computeScanFlag(r.entry_type, at, settings),
        source: r.source,
      };
    });
    children.push({
      studentId: s.id,
      studentNo: s.student_no,
      fullName: s.full_name,
      gradeSection: s.grade_section,
      scans,
      present: scans.length > 0,
    });
  }
  const report: GuardianDayReport = {
    guardianName: students[0].guardian_name,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    children,
  };
  const result: ScanResult = {
    kind: 'GUARDIAN',
    message: 'Guardian verified — here is today\u2019s attendance report.',
    student: active[0],
    guardianReport: report,
  };
  bus.onScanResult(result);
  return result;
}

/** Processes a scan purely from the local snapshot and queues it for replay. */
async function processScanOffline(
  trimmed: string,
  source: ScanSource,
  bus: ScanEventBus,
  forcedType?: EntryType,
  session: SessionMode = 'auto',
): Promise<ScanResult> {
  const settings = settingsStore.get();
  // Visitor QR (VP-…) offline? Check the cached visitors.
  if (trimmed.startsWith('VP-')) {
    const cachedVisitor = getCachedVisitorByPayload(trimmed);
    if (!cachedVisitor) {
      const result: ScanResult = {
        kind: 'OFFLINE',
        message: 'Database offline and visitor data not loaded yet. Please try again in a moment.',
      };
      bus.onScanResult(result);
      return result;
    }
    if (!cachedVisitor.is_active) {
      const result: ScanResult = {
        kind: 'BLOCKED',
        message: 'Visitor access restricted. Please contact the admin office.',
        visitor: cachedVisitor,
      };
      bus.onScanResult(result);
      return result;
    }
    const lastToday = getVisitorLastScanToday(cachedVisitor.id);
    const now = Date.now();
    if (lastToday) {
      const elapsedMs = now - lastToday.time;
      if (elapsedMs < settings.debounce_seconds * 1000) {
        const wait = Math.max(1, Math.ceil((settings.debounce_seconds * 1000 - elapsedMs) / 1000));
        const result: ScanResult = {
          kind: 'DUPLICATE',
          message: `QR already scanned — please wait ${wait}s.`,
          visitor: cachedVisitor,
        };
        bus.onScanResult(result);
        return result;
      }
    }
    const entryType: EntryType = forcedType ?? (lastToday?.type === 'IN' ? 'OUT' : 'IN');
    try {
      await enqueueVisitorScanEvent({
        studentId: 0,
        visitorId: cachedVisitor.id,
        parentPhone: null,
        entryType,
        scannedAt: toLocalMysqlTime(new Date(now)),
        source,
        smsQueued: false,
        flag: '',
      });
    } catch (err) {
      const result: ScanResult = {
        kind: 'ERROR',
        message: 'Visitor scan could not be saved. Please notify the admin.',
        visitor: cachedVisitor,
      };
      bus.onScanResult(result);
      return result;
    }
    recordVisitorScan(cachedVisitor.id, entryType, now);
    const result: ScanResult = {
      kind: 'VISITOR',
      message: entryType === 'IN' ? 'Visitor checked IN (offline)' : 'Visitor checked OUT (offline)',
      visitor: cachedVisitor,
      entryType,
      log: { id: 0, student_id: 0, entry_type: entryType, scanned_at: toLocalMysqlTime(new Date(now)), source, flag: '' },
      queuedOffline: true,
    };
    bus.onScanResult(result);
    return result;
  }

  const student = getCachedStudentByPayload(trimmed);

  if (!student) {
    // A guardian QR can't produce a report offline (it needs today's scan
    // history from MySQL) — say so instead of a generic "unrecognized".
    if (getCachedStudentByGuardianPayload(trimmed)) {
      const result: ScanResult = {
        kind: 'OFFLINE',
        message:
          'Guardian reports are available when the database is online. Please try again in a moment.',
      };
      bus.onScanResult(result);
      return result;
    }
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
  // Same forced-mode override as the online path.
  const entryType = forcedType ?? (lastToday?.type === 'IN' ? 'OUT' : 'IN');
  let scannedAtDate = new Date(now);

  // Session mode override for offline path.
  if (session === 'am' || session === 'pm') {
    const parseHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const amOut = settings.am_time_out ? parseHHMM(settings.am_time_out) : 720;
    const pmIn = settings.pm_time_in ? parseHHMM(settings.pm_time_in) : 780;
    if (session === 'am') {
      const amIn = settings.am_time_in ? parseHHMM(settings.am_time_in) : 420;
      const targetMin = Math.round((amIn + amOut) / 2);
      scannedAtDate = new Date(scannedAtDate);
      scannedAtDate.setHours(Math.floor(targetMin / 60), targetMin % 60, 0, 0);
    } else {
      const pmOut = settings.pm_time_out ? parseHHMM(settings.pm_time_out) : 960;
      const targetMin = Math.round((pmIn + pmOut) / 2);
      scannedAtDate = new Date(scannedAtDate);
      scannedAtDate.setHours(Math.floor(targetMin / 60), targetMin % 60, 0, 0);
    }
  }

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
    message: scanMessage(entryType, settings),
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
