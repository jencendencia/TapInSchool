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
    for (const iface of interfaces[name]) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
        hash.update(iface.mac);
        break;
      }
    }
    break;
  }
  return hash.digest('hex').substring(0, 16);
}

function getStoredLicense(): LicenseStatus & { activatedAt?: string } | null {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf-8'));
    }
  } catch {
    /* Corrupt/unreadable license file — treat as not activated. */
  }
  return null;
}

function saveLicense(data: LicenseStatus & { activatedAt: string }): void {
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2));
}

export function checkLicense(): LicenseStatus {
  const stored = getStoredLicense();
  if (!stored || !stored.licenseKey || !stored.activatedAt) return { activated: false };
  return { activated: true, licenseKey: stored.licenseKey, machineId: getMachineId() };
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
        licenseKey: licenseKey.trim().toUpperCase(),
        machineId,
        activatedAt: new Date().toISOString(),
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
