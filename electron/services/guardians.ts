// Guardian registry (the master list of parents/guardians). Students link to a
// guardian row via students.guardian_id; the legacy denormalized snapshot
// columns on students (parent_phone / guardian_name / guardian_address /
// guardian_qr_hash_payload) are kept as copies so SMS, kiosk guardian-QR
// scans, reports, and the offline cache keep working without JOINs.
//
// Registration enforces the duplicate-name flow: registering a name that
// already exists returns { outcome: 'duplicate', existing } so the UI can ask
// whether it is the same guardian. Saving anyway (allowSameName) creates a
// same-named record with a different address/mobile — a distinct QR payload,
// so the two never collide. An identical name + address produces the same QR
// payload, which the unique key rejects as a true duplicate.
import { db } from '../db/connection';
import { generateGuardianPayload } from './qr';
import { updateWithVersionCheck } from './db-retry';
import { refreshOfflineCache } from './offline';
import type { Guardian, GuardianInput, GuardianWriteResult } from '../../shared/types';

interface GuardianRow {
  id: number;
  full_name: string;
  mobile: string;
  address: string;
  qr_hash_payload: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const toGuardian = (r: GuardianRow): Guardian => ({
  id: r.id,
  full_name: r.full_name,
  mobile: r.mobile,
  address: r.address,
  qr_hash_payload: r.qr_hash_payload,
  is_active: !!r.is_active,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const norm = (v: unknown): string => String(v ?? '').trim();

export async function listGuardians(search?: string): Promise<Guardian[]> {
  if (search) {
    const like = `%${search}%`;
    const rows = await db.query<GuardianRow[]>(
      'SELECT * FROM guardians WHERE full_name LIKE ? OR mobile LIKE ? OR address LIKE ? ORDER BY full_name',
      [like, like, like],
    );
    return rows.map(toGuardian);
  }
  const rows = await db.query<GuardianRow[]>('SELECT * FROM guardians ORDER BY full_name');
  return rows.map(toGuardian);
}

/** Case-insensitive exact-name lookup — powers the duplicate-registration prompt. */
export async function findGuardiansByName(name: string): Promise<Guardian[]> {
  const rows = await db.query<GuardianRow[]>(
    'SELECT * FROM guardians WHERE LOWER(TRIM(full_name)) = LOWER(?) ORDER BY id',
    [norm(name)],
  );
  return rows.map(toGuardian);
}

export async function findGuardianById(id: number): Promise<Guardian | null> {
  const [row] = await db.query<GuardianRow[]>('SELECT * FROM guardians WHERE id = ?', [Number(id)]);
  return row ? toGuardian(row) : null;
}

export async function createGuardian(
  input: GuardianInput,
  opts?: { allowSameName?: boolean },
): Promise<GuardianWriteResult> {
  const fullName = norm(input.full_name);
  if (!fullName) throw new Error('Guardian name is required.');
  const mobile = norm(input.mobile);
  const address = norm(input.address);
  if (!opts?.allowSameName) {
    const existing = await findGuardiansByName(fullName);
    if (existing.length) return { outcome: 'duplicate', existing: existing[0] };
  }
  const payload = generateGuardianPayload(fullName, address);
  try {
    const res = await db.execute(
      'INSERT INTO guardians (full_name, mobile, address, qr_hash_payload) VALUES (?, ?, ?, ?)',
      [fullName, mobile, address, payload],
    );
    const [row] = await db.query<GuardianRow[]>('SELECT * FROM guardians WHERE id = ?', [res.insertId]);
    return { outcome: 'created', guardian: toGuardian(row) };
  } catch (err) {
    // Same name + same address → same QR payload → the unique key rejects the
    // row. Surface the existing record as a duplicate (the identical identity).
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      const [dup] = await db.query<GuardianRow[]>(
        'SELECT * FROM guardians WHERE qr_hash_payload = ?',
        [payload],
      );
      if (dup) return { outcome: 'duplicate', existing: toGuardian(dup) };
    }
    throw err;
  }
}

/** Matches by exact identity (name + address). If no row matches, registers a
 *  new guardian silently — used by CSV import where a per-row prompt is not
 *  appropriate. Same-named guardians with a different address stay separate. */
export async function findOrCreateGuardian(name: string, address: string, mobile: string): Promise<Guardian> {
  const fullName = norm(name);
  if (!fullName) throw new Error('Guardian name is required.');
  const addr = norm(address);
  const rows = await db.query<GuardianRow[]>(
    'SELECT * FROM guardians WHERE LOWER(TRIM(full_name)) = LOWER(?) AND LOWER(TRIM(address)) = LOWER(?) LIMIT 1',
    [fullName, addr],
  );
  if (rows[0]) return toGuardian(rows[0]);
  const payload = generateGuardianPayload(fullName, addr);
  try {
    const res = await db.execute(
      'INSERT INTO guardians (full_name, mobile, address, qr_hash_payload) VALUES (?, ?, ?, ?)',
      [fullName, norm(mobile), addr, payload],
    );
    const [row] = await db.query<GuardianRow[]>('SELECT * FROM guardians WHERE id = ?', [res.insertId]);
    return toGuardian(row);
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      const [dup] = await db.query<GuardianRow[]>(
        'SELECT * FROM guardians WHERE qr_hash_payload = ?',
        [payload],
      );
      if (dup) return toGuardian(dup);
    }
    throw err;
  }
}

/** Copies a guardian's current identity onto every linked student's legacy
 *  snapshot columns, so SMS routing, guardian-QR scans, reports and the
 *  offline cache all keep working without JOINs. */
export async function syncGuardianSnapshot(guardian: Guardian): Promise<void> {
  await db.execute(
    `UPDATE students
     SET parent_phone = ?, guardian_name = ?, guardian_address = ?, guardian_qr_hash_payload = ?
     WHERE guardian_id = ?`,
    [guardian.mobile, guardian.full_name, guardian.address, guardian.qr_hash_payload, guardian.id],
  );
}

export async function updateGuardian(
  id: number,
  patch: Partial<GuardianInput & { is_active?: boolean; updated_at?: string }>,
  opts?: { allowSameName?: boolean },
): Promise<GuardianWriteResult> {
  const gid = Number(id);
  const current = await findGuardianById(gid);
  if (!current) throw new Error('Guardian not found.');
  const nextName = 'full_name' in patch && patch.full_name !== undefined ? norm(patch.full_name) : current.full_name;
  const nextMobile = 'mobile' in patch && patch.mobile !== undefined ? norm(patch.mobile) : current.mobile;
  const nextAddress = 'address' in patch && patch.address !== undefined ? norm(patch.address) : current.address;
  const nextActive = 'is_active' in patch && patch.is_active !== undefined ? (patch.is_active ? 1 : 0) : current.is_active ? 1 : 0;
  if (!nextName) throw new Error('Guardian name is required.');
  // Renaming into another guardian's name is the same duplicate situation as
  // registration — the UI asks before saving anyway. Only prompt when the name
  // actually changes, so editing a same-named guardian's mobile/address alone
  // doesn't re-trigger the duplicate question.
  if (!opts?.allowSameName && nextName.trim().toLowerCase() !== current.full_name.trim().toLowerCase()) {
    const sameName = await findGuardiansByName(nextName);
    const other = sameName.find((g) => g.id !== gid);
    if (other) return { outcome: 'duplicate', existing: other };
  }
  const payload = generateGuardianPayload(nextName, nextAddress);
  // Optimistic lock (C3): the edit form sends the updated_at it loaded — only
  // overwrite when the row is still at that version.
  const expectedUpdatedAt = patch.updated_at ? String(patch.updated_at) : '';
  if (expectedUpdatedAt) {
    const { notFound } = await updateWithVersionCheck(
      'UPDATE guardians SET full_name = ?, mobile = ?, address = ?, qr_hash_payload = ?, is_active = ? WHERE id = ? AND updated_at = ?',
      [nextName, nextMobile, nextAddress, payload, nextActive, gid, expectedUpdatedAt],
      'SELECT updated_at FROM guardians WHERE id = ?',
      [gid],
      expectedUpdatedAt,
      'This guardian was changed by someone else. Reload to see the latest version.',
    );
    if (notFound) throw new Error('Guardian not found.');
  } else {
    await db.execute(
      'UPDATE guardians SET full_name = ?, mobile = ?, address = ?, qr_hash_payload = ?, is_active = ? WHERE id = ?',
      [nextName, nextMobile, nextAddress, payload, nextActive, gid],
    );
  }
  const updated = await findGuardianById(gid);
  if (!updated) throw new Error('Guardian not found.');
  // Contact/identity changes must propagate to every linked student (SMS
  // number, guardian name/address/QR), then refresh the offline snapshot.
  await syncGuardianSnapshot(updated);
  void refreshOfflineCache();
  return { outcome: 'updated', guardian: updated };
}

export async function deleteGuardian(id: number): Promise<void> {
  const gid = Number(id);
  // Unlink students — their saved snapshot stays so SMS/reports/QR keep
  // working — then remove the registry row.
  await db.execute('UPDATE students SET guardian_id = NULL WHERE guardian_id = ?', [gid]);
  await db.execute('DELETE FROM guardians WHERE id = ?', [gid]);
  void refreshOfflineCache();
}
