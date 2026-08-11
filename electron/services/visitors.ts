// Visitor CRUD + scan processing. Walk-in visitors get registered at the gate
// by staff, a VP (Visitor Payload) QR is generated, and the visitor scans IN/OUT
// through the same kiosk scanner pipeline as students — debounce, toggle, online
// / offline queue, and source tracking are all reused.
import { db } from '../db/connection';
import { settingsStore } from '../db/settings';
import { generateVisitorPayload } from './qr';
import type {
  EntryType,
  ScanResult,
  ScanSource,
  Visitor,
  VisitorInput,
  VisitorLogRow,
} from '../../shared/types';

const toVisitor = (r: VisitorRow): Visitor => ({
  id: r.id,
  full_name: r.full_name,
  contact_phone: r.contact_phone,
  purpose: r.purpose,
  host_office: r.host_office,
  id_presented: r.id_presented,
  qr_hash_payload: r.qr_hash_payload,
  is_active: !!r.is_active,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

type VisitorRow = {
  id: number;
  full_name: string;
  contact_phone: string;
  purpose: string;
  host_office: string;
  id_presented: string;
  qr_hash_payload: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export async function listVisitors(search?: string): Promise<Visitor[]> {
  if (search) {
    const like = `%${search}%`;
    const rows = await db.query<VisitorRow[]>(
      'SELECT * FROM visitors WHERE full_name LIKE ? OR contact_phone LIKE ? ORDER BY created_at DESC',
      [like, like],
    );
    return rows.map(toVisitor);
  }
  const rows = await db.query<VisitorRow[]>('SELECT * FROM visitors ORDER BY created_at DESC');
  return rows.map(toVisitor);
}

export async function createVisitor(input: VisitorInput): Promise<Visitor> {
  const fullName = String(input.full_name ?? '').trim();
  if (!fullName) throw new Error('Visitor name is required.');
  const res = await db.execute(
    `INSERT INTO visitors (full_name, contact_phone, purpose, host_office, id_presented, qr_hash_payload)
     VALUES (?, ?, ?, ?, ?, '')`,
    [
      fullName,
      String(input.contact_phone ?? '').trim(),
      String(input.purpose ?? '').trim(),
      String(input.host_office ?? '').trim(),
      String(input.id_presented ?? '').trim(),
    ],
  );
  // Generate the QR payload FROM the DB id so it's stable across visits.
  const payload = generateVisitorPayload(res.insertId);
  await db.execute('UPDATE visitors SET qr_hash_payload = ? WHERE id = ?', [payload, res.insertId]);
  const [row] = await db.query<VisitorRow[]>('SELECT * FROM visitors WHERE id = ?', [res.insertId]);
  return toVisitor(row);
}

export async function updateVisitor(
  id: number,
  patch: Partial<VisitorInput & { is_active?: boolean }>,
): Promise<Visitor> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if ('full_name' in patch && patch.full_name !== undefined) {
    sets.push('full_name = ?');
    params.push(String(patch.full_name).trim());
  }
  if ('contact_phone' in patch && patch.contact_phone !== undefined) {
    sets.push('contact_phone = ?');
    params.push(String(patch.contact_phone).trim());
  }
  if ('purpose' in patch && patch.purpose !== undefined) {
    sets.push('purpose = ?');
    params.push(String(patch.purpose).trim());
  }
  if ('host_office' in patch && patch.host_office !== undefined) {
    sets.push('host_office = ?');
    params.push(String(patch.host_office).trim());
  }
  if ('id_presented' in patch && patch.id_presented !== undefined) {
    sets.push('id_presented = ?');
    params.push(String(patch.id_presented).trim());
  }
  if ('is_active' in patch && patch.is_active !== undefined) {
    sets.push('is_active = ?');
    params.push(patch.is_active ? 1 : 0);
  }
  if (!sets.length) throw new Error('Nothing to update.');
  params.push(id);
  await db.execute(`UPDATE visitors SET ${sets.join(', ')} WHERE id = ?`, params);
  const [row] = await db.query<VisitorRow[]>('SELECT * FROM visitors WHERE id = ?', [id]);
  return toVisitor(row);
}

export async function deleteVisitor(id: number): Promise<void> {
  await db.execute('DELETE FROM visitor_logs WHERE visitor_id = ?', [id]);
  await db.execute('DELETE FROM visitors WHERE id = ?', [id]);
}

export async function listVisitorLogs(visitorId: number): Promise<VisitorLogRow[]> {
  return db.query<VisitorLogRow[]>(
    `SELECT vl.id, vl.visitor_id, v.full_name, v.contact_phone, v.purpose, v.host_office,
            vl.entry_type, vl.source, vl.scanned_at
     FROM visitor_logs vl
     JOIN visitors v ON v.id = vl.visitor_id
     WHERE vl.visitor_id = ?
     ORDER BY vl.id DESC`,
    [visitorId],
  );
}

export async function listAllVisitorLogs(filter?: { from?: string; to?: string }): Promise<VisitorLogRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter?.from) {
    where.push('vl.scanned_at >= ?');
    params.push(filter.from);
  }
  if (filter?.to) {
    where.push('vl.scanned_at <= ?');
    params.push(filter.to);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.query<VisitorLogRow[]>(
    `SELECT vl.id, vl.visitor_id, v.full_name, v.contact_phone, v.purpose, v.host_office,
            vl.entry_type, vl.source, vl.scanned_at
     FROM visitor_logs vl
     JOIN visitors v ON v.id = vl.visitor_id
     ${whereSql}
     ORDER BY vl.id DESC`,
    params,
  );
}

/** Processes a visitor VP QR scan. Returns a ScanResult with kind 'VISITOR'. */
export async function processVisitorScan(
  visitor: Visitor,
  source: ScanSource,
  forcedType?: EntryType,
): Promise<{ result: ScanResult; entryType: EntryType | undefined }> {
  const settings = settingsStore.get();

  // Debounce against visitor_logs (same debounce_seconds setting as students).
  const recent = await db.query<{ id: number; scanned_at: Date }[]>(
    'SELECT id, scanned_at FROM visitor_logs WHERE visitor_id = ? AND scanned_at >= CURDATE() ORDER BY scanned_at DESC LIMIT 1',
    [visitor.id],
  );
  if (recent[0]) {
    const elapsedMs = Date.now() - new Date(recent[0].scanned_at).getTime();
    if (elapsedMs < (settings.debounce_seconds ?? 5) * 1000) {
      const wait = Math.max(1, Math.ceil(((settings.debounce_seconds ?? 5) * 1000 - elapsedMs) / 1000));
      return {
        result: {
          kind: 'DUPLICATE',
          message: `QR already scanned — please wait ${wait}s.`,
          visitor,
        },
        entryType: undefined,
      };
    }
  }

  // Toggle: latest visitor log today decides (IN → OUT, else IN).
  const lastToday = await db.query<{ entry_type: 'IN' | 'OUT' }[]>(
    'SELECT entry_type FROM visitor_logs WHERE visitor_id = ? AND scanned_at >= CURDATE() ORDER BY scanned_at DESC LIMIT 1',
    [visitor.id],
  );
  const entryType: EntryType = forcedType ?? (lastToday[0]?.entry_type === 'IN' ? 'OUT' : 'IN');

  // Insert the log.
  const insert = await db.execute(
    'INSERT INTO visitor_logs (visitor_id, entry_type, source) VALUES (?, ?, ?)',
    [visitor.id, entryType, source],
  );
  const scannedAt = new Date().toISOString();

  const result: ScanResult = {
    kind: 'VISITOR',
    message: entryType === 'IN' ? 'Visitor checked IN' : 'Visitor checked OUT',
    visitor,
    entryType,
    log: {
      id: insert.insertId,
      student_id: 0, // not a student
      entry_type: entryType,
      scanned_at: scannedAt,
      source,
      flag: '',
    },
  };
  return { result, entryType };
}
