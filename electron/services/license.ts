// App activation (license key) client. Validates a license key against the
// deployed Cloudflare Worker license server and caches a successful activation
// in the userData directory so subsequent launches skip the activation screen.
import { app } from 'electron';
import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import type { ActivationResult, LicenseStatus } from '../../shared/types';

// TODO: replace with your deployed Worker URL if it changes.
// This is the live license server that validates keys and tracks machines.
const LICENSE_SERVER = 'https://dtr-license-server.jencendencia.workers.dev';
const LICENSE_FILE = path.join(app.getPath('userData'), 'license.json');
// How long an activated app may run without reaching the license server.
const OFFLINE_GRACE_DAYS = 3;
const OFFLINE_GRACE_MS = OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** Generates a stable, unique machine ID derived from hardware + user info. */
function getMachineId(): string {
  const hash = crypto.createHash('sha256');
  hash.update(os.hostname());
  try {
    hash.update(os.userInfo().username);
  } catch {
    /* os.userInfo() can throw in some service contexts — fall back gracefully. */
  }
  hash.update(os.platform());
  hash.update(os.arch());
const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
        hash.update(iface.mac);
        break;
      }
    }
    break;
  }
  return hash.digest('hex').substring(0, 16);
}

interface StoredLicense extends LicenseStatus {
  activatedAt?: string;
  lastValidatedAt?: string;
}

function getStoredLicense(): StoredLicense | null {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf-8'));
    }
  } catch {
    /* Corrupt/unreadable license file — treat as not activated. */
  }
  return null;
}

function saveLicense(data: StoredLicense): void {
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2));
}

export async function checkLicense(): Promise<LicenseStatus> {
  const stored = getStoredLicense();
  if (!stored || !stored.licenseKey || !stored.activatedAt) return { activated: false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let result: ActivationResult;
  try {
    // Re-validate the key on every launch so revoked keys lock the app out.
    // The stored machineId is the one the server registered at activation, so
    // a hardware change is never mistaken for a brand-new device.
    const response = await fetch(`${LICENSE_SERVER}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: stored.licenseKey, machineId: stored.machineId ?? getMachineId() }),
      signal: controller.signal,
    });
    result = (await response.json()) as ActivationResult;
  } catch {
    // No server response (offline / timed out): allow within the grace period.
    // Stamp the reference once only when missing (first launch after the
    // update) — otherwise the window would slide forever for clients who open
    // the app offline regularly, and they'd never be locked out.
    const lastValidated = stored.lastValidatedAt
      ? new Date(stored.lastValidatedAt).getTime()
      : Date.now();
    if (Date.now() - lastValidated < OFFLINE_GRACE_MS) {
      if (!stored.lastValidatedAt) {
        stored.lastValidatedAt = new Date().toISOString();
        saveLicense(stored);
      }
      return { activated: true, licenseKey: stored.licenseKey, machineId: stored.machineId };
    }
    return {
      activated: false,
      message: 'Cannot reach the activation server and the offline grace period has expired. Please check your internet connection.',
    };
  } finally {
    clearTimeout(timeout);
  }

  if (result.valid) {
    // Refresh the offline-grace timestamp so paying clients stay unlocked.
    stored.lastValidatedAt = new Date().toISOString();
    saveLicense(stored);
    return { activated: true, licenseKey: stored.licenseKey, machineId: stored.machineId };
  }

  // Server reached and rejected this key (revoked / expired / over device limit)
  return { activated: false, message: result.message || 'This license key is no longer valid.' };
}

export async function activateLicense(licenseKey: string): Promise<ActivationResult> {
  try {
    const machineId = getMachineId();
    const response = await fetch(`${LICENSE_SERVER}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: licenseKey.trim().toUpperCase(), machineId }),
    });
    const result = (await response.json()) as ActivationResult;

if (result.valid) {
      saveLicense({
        activated: true,
        licenseKey: licenseKey.trim().toUpperCase(),
        machineId,
        activatedAt: new Date().toISOString(),
        lastValidatedAt: new Date().toISOString(),
      });
    }
    return result;
  } catch (err) {
    console.error('[tapin] license activation failed:', (err as Error).message);
    return { valid: false, message: 'Cannot reach activation server. Check your internet connection.' };
  }
}

export function getMachineIdValue(): string {
  return getMachineId();
}
