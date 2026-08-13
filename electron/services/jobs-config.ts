// Per-machine scheduled-jobs toggle (B5 — MULTI_USER_SCALING_RESEARCH.md).
//
// With several machines sharing one MySQL, the background jobs (SMS dispatch,
// backups, absence detection, adviser reports, badge recompute) only need to
// run on ONE machine — the others just scan and read. This flag marks THIS
// machine as the designated worker: `runScheduledJobs: false` turns it into a
// passive kiosk that skips the schedulers entirely (the machine(s) left ON are
// the workers; GET_LOCK still keeps peers from colliding when more than one is
// on).
//
// The flag is per machine, so it lives in userData/jobs-config.json (like
// db-config.json) — NOT in the shared `settings` table, which every machine
// would inherit. Defaults to ON so existing single-machine installs behave
// identically.
import { app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface JobsConfig {
  /** When false, this machine skips the scheduled background jobs (passive kiosk). */
  runScheduledJobs: boolean;
}

function configFilePath(): string {
  return path.join(app.getPath('userData'), 'jobs-config.json');
}

let cached: JobsConfig = { runScheduledJobs: true };

/** Reads the saved flag (if any). Call once at boot, before starting services. */
export async function loadJobsConfig(): Promise<JobsConfig> {
  try {
    const raw = await fs.readFile(configFilePath(), 'utf8');
    const data = JSON.parse(raw) as Partial<JobsConfig>;
    if (data && typeof data.runScheduledJobs === 'boolean') {
      cached = { runScheduledJobs: data.runScheduledJobs };
    }
  } catch {
    // First run or unreadable file — keep the default (ON).
  }
  return getJobsConfig();
}

/** Persists the flag and updates the in-memory cache. */
export async function saveJobsConfig(cfg: JobsConfig): Promise<JobsConfig> {
  cached = { runScheduledJobs: Boolean(cfg.runScheduledJobs) };
  await fs.writeFile(configFilePath(), JSON.stringify(cached, null, 2), 'utf8');
  return getJobsConfig();
}

/** Current value (defaults to ON until loadJobsConfig() runs). */
export function getJobsConfig(): JobsConfig {
  return { ...cached };
}
