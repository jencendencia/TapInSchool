// Guardian registry for the kiosk-embedded teacher portal (companion app).
//
// Mirrors electron/services/guardians.ts (the kiosk's own admin registry) so
// portal enrollment behaves exactly like the kiosk's Add Student form: the
// teacher picks a registered guardian (searchable dropdown) or registers one
// inline with the duplicate-name flow, and the student row snapshots the
// guardian identity (name/address/mobile/QR) via students.guardian_id.
//
// This module is portal-safe (no Electron imports) — it only needs the DB pool
// and QR helpers, so it runs in the standalone `npm run portal` node process
// too. The offline-cache refresh is skipped here (portal writes go straight to
// MySQL; the kiosk's next scan/refresh picks the rows up).
import { db } from '../electron/db/connection';
import { generateGuardianPayload } from '../electron/services/qr';
import type { Guardian, GuardianInput, GuardianWriteResult } from '../shared/types';

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

/** All registered guardians, sorted by name, optionally narrowed by search. */
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

/** Registers a guardian with the same duplicate-name flow as the kiosk:
 *  returning { outcome: 'duplicate' } instead of saving when the name already
 *  exists (the UI asks whether it is the same person before allowSameName). */
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
