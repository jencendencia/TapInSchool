// Bundles the TapIn Teacher Companion's web UI into the kiosk package.
//
// The kiosk's embedded portal server (server/portal.ts) serves the COMPANION
// app's renderer — not the kiosk's own UI. This script builds that renderer in
// the companion repo and copies the output into <kiosk>/portal-dist/, which
// electron-builder ships as extraResources (resources/portal-dist in the
// installed app).
//
// Companion folder resolution: PORTAL_COMPANION_DIR env var, else the sibling
// folder named "TapIn Teacher Companion app". Fails soft (warns + skips) so a
// kiosk-only build still completes — the portal then shows a "not bundled"
// notice until the kiosk is rebuilt with the companion folder available.
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const kioskRoot = path.resolve(scriptDir, '..');
const outDir = path.join(kioskRoot, 'portal-dist');

const companionDir =
  process.env.PORTAL_COMPANION_DIR ||
  path.resolve(kioskRoot, '..', 'TapIn Teacher Companion app');

function fail(message) {
  console.warn('\n⚠️  [build-portal] ' + message);
  console.warn('   The kiosk will still build, but the teacher portal UI will NOT be bundled.');
  console.warn(`   Fix: set PORTAL_COMPANION_DIR to the companion folder, then run npm run build again.\n`);
}

if (!fs.existsSync(path.join(companionDir, 'package.json'))) {
  fail(`Companion app not found at:\n   ${companionDir}\n   (set PORTAL_COMPANION_DIR to point at it)`);
  process.exit(0);
}

console.log(`[build-portal] Building companion renderer in: ${companionDir}`);
try {
  execSync('npm run build:renderer', { cwd: companionDir, stdio: 'inherit' });
} catch (err) {
  fail(`Companion renderer build failed: ${err.message}`);
  process.exit(0);
}

const companionDist = path.join(companionDir, 'dist');
if (!fs.existsSync(path.join(companionDist, 'index.html'))) {
  fail(`Companion build produced no index.html (expected ${companionDist}/index.html).`);
  process.exit(0);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(companionDist, outDir, { recursive: true });
console.log(`[build-portal] Copied companion UI → ${outDir}`);
console.log('[build-portal] Done. The kiosk installer will now include the teacher portal.');
