// Reads the bell-time keys the teacher app needs from the shared `settings`
// table (the kiosk owns writing these; we only read). Falls back to defaults
// when the table is missing rows.
import { db } from '../electron/db/connection';
import type { BellSettings } from './bell-times';

export async function readBellSettings(): Promise<BellSettings> {
  if (!db.isOnline()) {
    return { am_time_in: '', am_time_out: '', pm_time_in: '', pm_time_out: '', bell_grace_minutes: 0 };
  }
  try {
    const rows = await db.query<{ setting_key: string; setting_value: string }[]>(
      `SELECT setting_key, setting_value FROM settings
       WHERE setting_key IN ('am_time_in', 'am_time_out', 'pm_time_in', 'pm_time_out', 'bell_grace_minutes')`,
    );
    const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      am_time_in: map.get('am_time_in') ?? '',
      am_time_out: map.get('am_time_out') ?? '',
      pm_time_in: map.get('pm_time_in') ?? '',
      pm_time_out: map.get('pm_time_out') ?? '',
      bell_grace_minutes: Number(map.get('bell_grace_minutes')) || 0,
    };
  } catch {
    return { am_time_in: '', am_time_out: '', pm_time_in: '', pm_time_out: '', bell_grace_minutes: 0 };
  }
}

/** School name + uploaded logo URL — the portal's login/sidebar branding.
 *  logoUrl is the raw stored value (tapin-logo://…), which the portal rewrites
 *  to its own /api/logo route before handing it to the browser. */
export async function readSchoolBranding(): Promise<{ schoolName: string; logoUrl: string | null }> {
  try {
    const rows = await db.query<{ setting_key: string; setting_value: string }[]>(
      `SELECT setting_key, setting_value FROM settings
       WHERE setting_key IN ('school_name', 'logo_url')`,
    );
    const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    const logoUrl = String(map.get('logo_url') ?? '').trim();
    return {
      schoolName: map.get('school_name')?.trim() || 'TapIn School',
      logoUrl: logoUrl.startsWith('tapin-logo://') ? logoUrl : null,
    };
  } catch {
    return { schoolName: 'TapIn School', logoUrl: null };
  }
}

/** School name + current school year — used for the DepEd report letterheads. */
export async function readSchoolInfo(): Promise<{ schoolName: string; schoolYear: string }> {
  try {
    const [nameRows, yearRows] = await Promise.all([
      db.query<{ setting_value: string }[]>(
        "SELECT setting_value FROM settings WHERE setting_key = 'school_name' LIMIT 1",
      ),
      db.query<{ name: string }[]>(
        'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
      ),
    ]);
    return {
      schoolName: nameRows[0]?.setting_value?.trim() || 'TapIn School',
      schoolYear: yearRows[0]?.name ?? String(new Date().getFullYear()),
    };
  } catch {
    return { schoolName: 'TapIn School', schoolYear: String(new Date().getFullYear()) };
  }
}
