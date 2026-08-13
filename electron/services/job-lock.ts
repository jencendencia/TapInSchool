// Cross-machine job serialization (MULTI_USER_SCALING_RESEARCH.md, Phase 1 —
// B1/B3/D1). When several TapIn machines share one MySQL database, background
// jobs (SMS queue dispatch, absence detection, adviser report emails, badge
// recompute, backups, schema bootstrap) must run on exactly ONE machine at a
// time — otherwise two workers can both send the same SMS, two machines can
// both email the same report, or two machines can both ALTER the same table.
//
// MySQL's GET_LOCK() is the distributed lock: it needs no new infrastructure,
// it is scoped to the session (so a machine that dies mid-job releases the
// lock automatically — no stale leader), and it lives on the same server the
// app already talks to. The lock is acquired on a dedicated pooled connection
// and held for the duration of `fn`; the job's own queries run on the regular
// pool.
import { db } from '../db/connection';

/**
 * Runs `fn` only while this machine holds the MySQL named lock `name`.
 *
 * `timeout` is how many seconds GET_LOCK waits for a busy lock before giving
 * up — 0 means "skip immediately if another machine is working" (right for
 * jobs that re-run on a timer), a larger value means "wait for the current
 * holder to finish" (right for schema bootstrap, which must complete).
 *
 * Returns the job's result, or null when the lock was not acquired (another
 * machine holds it, or the DB is offline). Callers treat null as "not my
 * turn this cycle" and simply skip.
 */
export async function withJobLock<T>(
  name: string,
  fn: () => Promise<T>,
  timeout = 0,
): Promise<T | null> {
  if (!db.isOnline()) return null;
  return db.withConnection(async (conn) => {
    const [rows] = await conn.query(
      'SELECT GET_LOCK(?, ?) AS got',
      [name, timeout],
    );
    const got = (rows as { got: number }[])[0]?.got;
    if (got !== 1) return null;
    try {
      return await fn();
    } finally {
      // Release even if the job threw; if the process died mid-job MySQL
      // releases the lock for us when the session ends.
      await conn.query('SELECT RELEASE_LOCK(?) AS rel', [name]).catch(() => undefined);
    }
  });
}
