// Local write-behind queue: attendance scans survive MySQL outages.
//
// While the DB is unreachable, scans are still validated and processed from a
// cached snapshot of students + today's scan state, appended to a JSONL file
// under userData/queue/, and replayed into MySQL (attendance_logs + sms_logs)
// once the connection returns. A plain JSONL file is used deliberately — no
// native dependencies, and gate volume is tiny (better-sqlite3 can replace it
// later if the queue ever grows large).
import { app } from 'electron';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { buildSmsMessage, resolveTemplate } from '../sms/message-builder';
import type { AttendanceFlag, EntryType, ScanSource } from '../../shared/types';

// ---- Types ------------------------------------------------------------------

/** Minimal student snapshot used to validate scans while the DB is offline. */
export interface CachedStudent {
  id: number;
  student_no: string;
  qr_hash_payload: string;
  full_name: string;
  grade_section: string;
  parent_phone: string | null;
  guardian_qr_hash_payload: string | null;
  photo_url: string | null;
  is_active: boolean;
}

/** Minimal visitor snapshot used while the DB is offline. Compatible with the
 *  Visitor interface (created_at/updated_at are empty when from cache). */
export interface CachedVisitor {
  id: number;
  full_name: string;
  contact_phone: string;
  purpose: string;
  host_office: string;
  id_presented: string;
  qr_hash_payload: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A scan accepted while offline, persisted for replay into MySQL. */
export interface OfflineScanEvent {
  id: string;
  kind: 'scan' | 'visitor_scan';
  queuedAt: string;
  studentId: number;
  studentNo?: string;
  fullName?: string;
  gradeSection?: string;
  parentPhone: string | null;
  /** Visitor id (for visitor_scan events). */
  visitorId?: number;
  entryType: EntryType;
  scannedAt: string;
  source: ScanSource;
  smsQueued: boolean;
  /** LATE/EARLY flag computed when the scan was taken (bell times at that moment). */
  flag: AttendanceFlag;
}

interface ScanStateEntry {
  type: EntryType;
  time: number; // epoch ms
}

interface PersistedState {
  students: CachedStudent[];
  visitors: CachedVisitor[];
  /** Keyed by student id — mirrors the DB "latest scan today" used by toggle/debounce. */
  lastScan: Record<string, ScanStateEntry>;
  /** Keyed by visitor id — mirrors visitor_logs toggle/debounce state. */
  visitorLastScan: Record<string, ScanStateEntry>;
  savedAt: string;
}

// ---- Paths ------------------------------------------------------------------

function queueDir(): string {
  return path.join(app.getPath('userData'), 'queue');
}

function eventsFile(): string {
  return path.join(queueDir(), 'offline-events.jsonl');
}

function stateFile(): string {
  return path.join(queueDir(), 'state.json');
}

// ---- In-memory state + queue lock -------------------------------------------

let state: PersistedState = { students: [], visitors: [], lastScan: {}, visitorLastScan: {}, savedAt: '' };

/** Serializes file operations so appends never interleave with drain rewrites. */
let queueLock: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn, fn);
  queueLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Formats a Date as a MySQL-friendly LOCAL datetime (matches NOW() semantics). */
export function toLocalMysqlTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
  );
}

// ---- Cache (students + today's scan state) -----------------------------------

/** Rebuilds the offline snapshot from MySQL. Safe to call when offline (no-op). */
export async function refreshOfflineCache(): Promise<void> {
  if (!db.isOnline()) return;
  try {
    const students = await db.query<CachedStudent[]>(
      `SELECT id, student_no, qr_hash_payload, full_name, grade_section,
              parent_phone, guardian_qr_hash_payload, photo_url, is_active
       FROM students`,
    );
    // Latest scan per student. Row-constructor IN is used instead of a plain
    // GROUP BY over non-aggregated columns, which fails under MySQL's
    // only_full_group_by sql_mode.
    const rows = await db.query<{ student_id: number; entry_type: EntryType; scanned_at: string }[]>(
      `SELECT student_id, entry_type, scanned_at
       FROM attendance_logs
       WHERE scanned_at >= CURDATE()
         AND (student_id, scanned_at) IN (
           SELECT student_id, MAX(scanned_at)
           FROM attendance_logs WHERE scanned_at >= CURDATE()
           GROUP BY student_id
         )`,
    );
    const lastScan: Record<string, ScanStateEntry> = {};
    for (const r of rows) {
      lastScan[String(r.student_id)] = { type: r.entry_type, time: new Date(r.scanned_at).getTime() };
    }
    // Also cache visitors + today's visitor_logs for offline VP scans. The
    // visitors tables may not exist yet while the boot-time schema migration
    // is still applying on an upgraded install — skip them (soft warning)
    // instead of aborting the whole cache, and let the next refresh (the
    // periodic sync below) pick them up once the tables are created.
    let visitors: CachedVisitor[] = [];
    let visitorLastScan: Record<string, ScanStateEntry> = {};
    try {
      const vRows = await db.query<CachedVisitor[]>(
        'SELECT id, full_name, contact_phone, purpose, host_office, id_presented, qr_hash_payload, is_active, created_at, updated_at FROM visitors',
      );
      const vScans = await db.query<{ visitor_id: number; entry_type: EntryType; scanned_at: string }[]>(
        `SELECT visitor_id, entry_type, scanned_at
         FROM visitor_logs
         WHERE scanned_at >= CURDATE()
           AND (visitor_id, scanned_at) IN (
             SELECT visitor_id, MAX(scanned_at)
             FROM visitor_logs WHERE scanned_at >= CURDATE()
             GROUP BY visitor_id
           )`,
      );
      const vLastScan: Record<string, ScanStateEntry> = {};
      for (const r of vScans) {
        vLastScan[String(r.visitor_id)] = { type: r.entry_type, time: new Date(r.scanned_at).getTime() };
      }
      visitors = vRows.map((v) => ({
        ...v,
        contact_phone: v.contact_phone || '',
        purpose: v.purpose || '',
        host_office: v.host_office || '',
        id_presented: v.id_presented || '',
        created_at: v.created_at || '',
        updated_at: v.updated_at || '',
      }));
      visitorLastScan = vLastScan;
    } catch (err) {
      console.warn('[tapin] visitor cache skipped (visitors tables not ready yet?):', (err as Error).message);
    }
    state = {
      students: students.map(normalizeStudent),
      visitors,
      lastScan,
      visitorLastScan,
      savedAt: new Date().toISOString(),
    };
    await persistState();
  } catch (err) {
    console.error('[tapin] failed to refresh offline cache:', err);
  }
}

function normalizeStudent(s: CachedStudent): CachedStudent {
  return {
    ...s,
    parent_phone: s.parent_phone || null,
    guardian_qr_hash_payload: s.guardian_qr_hash_payload || null,
    photo_url: s.photo_url || null,
  };
}

export function getCachedStudentByPayload(payload: string): CachedStudent | undefined {
  return state.students.find((s) => s.qr_hash_payload === payload);
}

/** Matches a GUARDIAN payload (GP-…) against the cached snapshot. */
export function getCachedStudentByGuardianPayload(payload: string): CachedStudent | undefined {
  return state.students.find((s) => s.guardian_qr_hash_payload === payload);
}

/** Matches a visitor VP payload against the cached snapshot. */
export function getCachedVisitorByPayload(payload: string): CachedVisitor | undefined {
  return state.visitors.find((v) => v.qr_hash_payload === payload);
}

/** Upserts a freshly seen student so the snapshot stays current for offline scans. */
export function upsertCachedStudent(student: CachedStudent): void {
  const s = normalizeStudent(student);
  const i = state.students.findIndex((x) => x.id === s.id);
  if (i >= 0) state.students[i] = s;
  else state.students.push(s);
}

/** Upserts a freshly seen visitor so the snapshot covers offline VP scans. */
export function upsertCachedVisitor(visitor: CachedVisitor): void {
  const i = state.visitors.findIndex((v) => v.id === visitor.id);
  if (i >= 0) state.visitors[i] = visitor;
  else state.visitors.push(visitor);
}

/** Last scan for a student on TODAY only (mirrors the DB `scanned_at >= CURDATE()`). */
export function getLastScanToday(studentId: number): ScanStateEntry | undefined {
  const entry = state.lastScan[String(studentId)];
  if (!entry) return undefined;
  return new Date(entry.time).toDateString() === new Date().toDateString() ? entry : undefined;
}

/** Last visitor scan today (mirrors visitor_logs toggle/debounce). */
export function getVisitorLastScanToday(visitorId: number): ScanStateEntry | undefined {
  const entry = state.visitorLastScan[String(visitorId)];
  if (!entry) return undefined;
  return new Date(entry.time).toDateString() === new Date().toDateString() ? entry : undefined;
}

export function recordScan(studentId: number, entryType: EntryType, timeMs: number): void {
  state.lastScan[String(studentId)] = { type: entryType, time: timeMs };
  scheduleStatePersist();
}

export function recordVisitorScan(visitorId: number, entryType: EntryType, timeMs: number): void {
  state.visitorLastScan[String(visitorId)] = { type: entryType, time: timeMs };
  scheduleStatePersist();
}

// ---- State persistence (throttled) -------------------------------------------

let persistTimer: NodeJS.Timeout | null = null;

function scheduleStatePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistState();
  }, 1000);
}

async function persistState(): Promise<void> {
  try {
    await fs.mkdir(queueDir(), { recursive: true });
    await fs.writeFile(stateFile(), JSON.stringify({ ...state, savedAt: new Date().toISOString() }));
  } catch (err) {
    console.error('[tapin] failed to persist offline state:', err);
  }
}

async function loadState(): Promise<void> {
  try {
    const raw = await fs.readFile(stateFile(), 'utf8');
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed && Array.isArray(parsed.students) && parsed.lastScan) {
      state = {
        students: parsed.students.map(normalizeStudent),
        // Older state files predate visitors — default to empty.
        visitors: parsed.visitors ?? [],
        lastScan: parsed.lastScan,
        visitorLastScan: parsed.visitorLastScan ?? {},
        savedAt: parsed.savedAt,
      };
    }
  } catch {
    // No state file yet — start empty (offline scans are unrecognized until the
    // cache is built from MySQL on the first successful connection).
  }
}

// ---- Write-behind queue -------------------------------------------------------

export function enqueueScanEvent(
  event: Omit<OfflineScanEvent, 'id' | 'kind' | 'queuedAt'>,
): Promise<void> {
  return withLock(async () => {
    const full: OfflineScanEvent = {
      ...event,
      id: randomUUID(),
      kind: 'scan',
      queuedAt: new Date().toISOString(),
    };
    await fs.mkdir(queueDir(), { recursive: true });
    await fs.appendFile(eventsFile(), JSON.stringify(full) + '\n', 'utf8');
  });
}

export function enqueueVisitorScanEvent(
  event: Omit<OfflineScanEvent, 'id' | 'kind' | 'queuedAt'>,
): Promise<void> {
  return withLock(async () => {
    const full: OfflineScanEvent = {
      ...event,
      id: randomUUID(),
      kind: 'visitor_scan',
      queuedAt: new Date().toISOString(),
    };
    await fs.mkdir(queueDir(), { recursive: true });
    await fs.appendFile(eventsFile(), JSON.stringify(full) + '\n', 'utf8');
  });
}

export function pendingQueueCount(): Promise<number> {
  return withLock(async () => {
    try {
      const raw = await fs.readFile(eventsFile(), 'utf8');
      return raw.split('\n').filter((l) => l.trim().length > 0).length;
    } catch {
      return 0;
    }
  });
}

async function readScanEvents(): Promise<OfflineScanEvent[]> {
  try {
    const raw = await fs.readFile(eventsFile(), 'utf8');
    const events: OfflineScanEvent[] = [];
    for (const line of raw.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try {
        const ev = JSON.parse(l) as OfflineScanEvent;
        if (ev && (ev.kind === 'scan' || ev.kind === 'visitor_scan')) events.push(ev);
      } catch {
        // Skip corrupt lines rather than blocking the whole queue.
      }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * Replays queued offline scans into MySQL. Returns the number of events
 * replayed. Events are removed only after their inserts commit; failures keep
 * the event for the next attempt.
 */
export function drainOfflineQueue(): Promise<number> {
  return withLock(async () => {
    if (!db.isOnline()) return 0;
    const events = await readScanEvents();
    if (events.length === 0) return 0;

    const settings = settingsStore.get();
    const done = new Set<string>();
    let replayed = 0;

    for (const ev of events) {
      try {
        if (ev.kind === 'visitor_scan') {
          const [visitor] = await db.query<{ id: number }[]>(
            'SELECT id FROM visitors WHERE id = ?',
            [ev.visitorId],
          );
          if (!visitor) {
            done.add(ev.id);
            console.warn('[tapin] dropped offline visitor scan for missing visitor', ev.visitorId);
            continue;
          }
          await db.execute(
            'INSERT INTO visitor_logs (visitor_id, entry_type, source, scanned_at) VALUES (?, ?, ?, ?)',
            [ev.visitorId, ev.entryType, ev.source, ev.scannedAt],
          );
          done.add(ev.id);
          replayed++;
          recordVisitorScan(ev.visitorId!, ev.entryType, new Date(ev.scannedAt).getTime());
        } else {
          const [exists] = await db.query<{ id: number }[]>(
            'SELECT id FROM students WHERE id = ?',
            [ev.studentId],
          );
          if (!exists) {
            // Student was deleted while the DB was down — drop the event.
            done.add(ev.id);
            console.warn('[tapin] dropped offline scan for missing student', ev.studentId);
            continue;
          }
          const insert = await db.execute(
            'INSERT INTO attendance_logs (student_id, entry_type, source, scanned_at) VALUES (?, ?, ?, ?)',
            [ev.studentId, ev.entryType, ev.source, ev.scannedAt],
          );
          if (ev.smsQueued && ev.parentPhone) {
            const message = buildSmsMessage(resolveTemplate(settings), {
              fullName: ev.fullName ?? '',
              gradeSection: ev.gradeSection ?? '',
              entryType: ev.entryType,
              flag: ev.flag,
              scannedAt: new Date(ev.scannedAt),
              school: settings.school_name,
            });
            await db.execute(
              "INSERT INTO sms_logs (attendance_id, parent_phone, message, status) VALUES (?, ?, ?, 'PENDING')",
              [insert.insertId, ev.parentPhone, message],
            );
          }
          done.add(ev.id);
          replayed++;
          // Reflect the replayed scan in the offline snapshot: the pre-drain
          // cache refresh rebuilt lastScan from MySQL *before* these queued
          // events existed, so without this a subsequent DB drop would toggle
          // these students incorrectly.
          recordScan(ev.studentId, ev.entryType, new Date(ev.scannedAt).getTime());
        }
      } catch (err) {
        // Transient failure — keep this event (and the rest) for next drain.
        console.error('[tapin] offline replay failed, will retry:', err);
        break;
      }
    }

    if (done.size > 0) {
      const remaining = events.filter((e) => !done.has(e.id));
      try {
        await fs.mkdir(queueDir(), { recursive: true });
        await fs.writeFile(eventsFile(), remaining.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      } catch (err) {
        console.error('[tapin] failed to rewrite offline queue:', err);
      }
    }
    return replayed;
  });
}

// ---- Service lifecycle --------------------------------------------------------

const onDbStatus = (s: { online: boolean }) => {
  if (s.online) {
    void refreshOfflineCache()
      .then(() => drainOfflineQueue())
      .then(() => hooks.onSynced());
  }
};

// Hooks are referenced by the status listener; kept in a module-level holder so
// start/stop can be called safely.
let hooks: { onSynced: () => void } = { onSynced: () => undefined };
let syncTimer: NodeJS.Timeout | null = null;

export function startOfflineService(h: { onSynced: () => void }): void {
  hooks = h;
  // Boot: restore the persisted snapshot first, then (if the DB is already
  // up) refresh it and flush anything queued from a previous offline session.
  void loadState()
    .then(() => refreshOfflineCache())
    .then(() => drainOfflineQueue())
    .then(() => hooks.onSynced());
  db.on('status', onDbStatus);
  // Periodic safety net: keeps the offline snapshot fresh (so a cache refresh
  // that raced the boot schema migration self-heals, e.g. visitors tables) and
  // replays any queue item that was missed (e.g. failed mid-drain).
  syncTimer = setInterval(() => {
    if (db.isOnline()) {
      void refreshOfflineCache().then(() => drainOfflineQueue()).then(() => hooks.onSynced());
    }
  }, 30000);
}

export function stopOfflineService(): void {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  db.removeListener('status', onDbStatus);
}
