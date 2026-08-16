// Resolves the current school year from the shared `school_years` table
// (exactly one row is flagged current; the kiosk owns managing that flag).
import { db } from '../electron/db/connection';

export async function currentSchoolYearName(): Promise<string> {
  if (!db.isOnline()) return String(new Date().getFullYear());
  try {
    const rows = await db.query<{ name: string }[]>(
      'SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1',
    );
    return rows[0]?.name ?? String(new Date().getFullYear());
  } catch {
    return String(new Date().getFullYear());
  }
}
