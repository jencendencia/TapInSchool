// Minimal .env loader for the Electron main process (no external dependency).
// Node 22 ships process.loadEnvFile, with a manual fallback.
import * as fs from 'fs';
import * as path from 'path';

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(rootDir: string): void {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    if (typeof (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile === 'function') {
      (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(envPath);
      return;
    }
  } catch {
    // fall through to manual parse
  }
  const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
