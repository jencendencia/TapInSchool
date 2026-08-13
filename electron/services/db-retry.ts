// Transient-write retry (MULTI_USER_SCALING_RESEARCH.md, Phase 2 — C2).
//
// MySQL reports two codes for transient lock contention: 1213
// (ER_LOCK_DEADLOCK — InnoDB rolled back a transaction) and 1205
// (ER_LOCK_WAIT_TIMEOUT — a lock was held longer than lock_wait_timeout).
// Both are NORMAL under concurrency (two machines writing related rows), not
// bugs: the operation simply needs to be retried. Wrapping multi-statement
// write paths in withRetry turns a peak-hour deadlock into a silent retry
// instead of an error surfaced to the guard / admin.
//
// Retrying is only safe when the wrapped operation is idempotent or
// transactional: the scan→SMS pair is wrapped in a transaction (see
// attendance.ts), and the absence/import upserts are idempotent by unique key,
// so a retried attempt can't double-write.
import { db } from '../db/connection';

/** MySQL errno / code for a deadlock or lock-wait timeout — safe to retry. */
export function isLockRetryable(err: unknown): boolean {
  const e = err as { errno?: number; code?: string };
  return (
    e?.errno === 1213 ||
    e?.errno === 1205 ||
    e?.code === 'ER_LOCK_DEADLOCK' ||
    e?.code === 'ER_LOCK_WAIT_TIMEOUT'
  );
}

/**
 * Runs `fn`, retrying up to `attempts` times when MySQL reports a deadlock or
 * lock-wait timeout (1213 / 1205). Any other error propagates immediately.
 * A short linear backoff gives the winning transaction time to commit.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delayMs = Math.max(0, opts.delayMs ?? 30);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isLockRetryable(err)) throw err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Runs a version-guarded UPDATE for optimistic locking (C3): the WHERE clause
 * must include `updated_at = ?` (the expected version the edit form loaded).
 * MySQL's affectedRows counts CHANGED rows, not MATCHED rows (no
 * CLIENT_FOUND_ROWS), so 0 rows is ambiguous — this resolves it by re-reading
 * the row: identical values = no-op success; a different version = conflict;
 * no row = notFound.
 *
 * @returns `{ notFound: boolean }` — true when the row no longer exists.
 * @throws Error(conflictMessage) when the row exists but was changed by someone
 *   else since the form loaded.
 */
export async function updateWithVersionCheck(
  updateSql: string,
  updateParams: unknown[],
  checkSql: string,
  checkParams: unknown[],
  expectedUpdatedAt: string,
  conflictMessage: string,
): Promise<{ notFound: boolean }> {
  const res = await db.execute(updateSql, updateParams);
  if (res.affectedRows > 0) return { notFound: false };
  const [row] = await db.query<{ updated_at: string }[]>(checkSql, checkParams);
  if (!row) return { notFound: true };
  if (String(row.updated_at) !== String(expectedUpdatedAt)) {
    throw new Error(conflictMessage);
  }
  // Row matched but no values actually changed — treat as a successful no-op.
  return { notFound: false };
}
