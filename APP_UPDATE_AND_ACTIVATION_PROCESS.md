# App Update & Activation Process

This document describes the two key operational processes for the **Biometric DTR System**:

1. **App Update Process** — how new versions are built, released, and installed via automatic updates.
2. **App Activation Process** — how the app is licensed and activated per machine.

---

## 1. App Update Process

The app uses **`electron-updater`** with **GitHub Releases** as the update provider. The updater is configured in `src/main/main.js` and `package.json`.

### 1.1 How It Works (High-Level)

| Phase | What Happens |
|-------|--------------|
| **Build** | Developer bumps the version and runs `npm run dist` to produce the installer. |
| **Release** | Developer uploads the installer + metadata to a GitHub Release. |
| **Check** | The running app (user clicks "Check for Updates") calls GitHub to compare versions. |
| **Download** | If a newer version exists, the app downloads the new installer. |
| **Install** | The app quits and runs the NSIS installer to complete the update. |

### 1.2 Update Configuration

Defined in `package.json`:

```json
"publish": {
  "provider": "github",
  "owner": "jencendencia",
  "repo": "dtr-app",
  "releaseType": "release"
}
```

Key updater settings in `src/main/main.js`:

```js
autoUpdater.autoDownload = false;          // User must click "Download"
autoUpdater.autoInstallOnAppQuit = true;   // Install when app quits
```

### 1.3 Step-by-Step: Publishing a New Version

> This is the **developer/admin** process. It is fully documented in `GITHUB_RELEASE_UPLOAD_GUIDE.md`.

1. **Bump the version** in `package.json` (e.g. `1.2.4` → `1.2.5`).
2. **Build the installer**:
   ```bash
   npm run dist
   ```
   This creates in `dist/`:
   - `Biometric DTR System Setup X.X.X.exe`
   - `Biometric DTR System Setup X.X.X.exe.blockmap`
   - `latest.yml`
3. **Fix `latest.yml` (CRITICAL)** — replace **hyphens with dots** in the filename so it matches the GitHub asset name:
   ```yaml
   # Before (wrong):
   path: Biometric-DTR-System-Setup-1.2.5.exe
   # After (correct):
   path: Biometric.DTR.System.Setup.1.2.5.exe
   ```
4. **Delete the old release** (if one exists for the same version):
   ```bash
   gh release delete vX.X.X --repo jencendencia/dtr-app --yes
   ```
5. **Create a new release and upload** all 3 files:
   ```bash
   gh release create vX.X.X ^
     "dist\Biometric DTR System Setup X.X.X.exe" ^
     "dist\Biometric DTR System Setup X.X.X.exe.blockmap" ^
     "dist\latest.yml" ^
     --repo jencendencia/dtr-app ^
     --title "vX.X.X" ^
     --notes "Release notes here"
   ```
6. **Verify the upload**:
   ```bash
   gh release view vX.X.X --repo jencendencia/dtr-app
   ```
   Confirm asset names use **dots** and that `latest.yml` matches.

### 1.4 Step-by-Step: User-Side Update Flow

The user triggers this from the **About** tab (`btn-about-check-updates`) or the **Settings → Updates** section. The flow is handled by IPC handlers in `src/main/main.js` and listeners in `src/renderer/renderer.js`.

1. **User clicks "Check for Updates"**
   - Renderer calls `ipcRenderer.invoke('check-for-updates')`
   - Main calls `autoUpdater.checkForUpdates()`
   - Status events stream back via `update-status`:
     - `checking` → "Checking for updates..."
     - `not-available` → "You're on the latest version"
     - `available` → "Update vX.X.X is available"
2. **User clicks "Download Update"**
   - Renderer calls `ipcRenderer.invoke('download-update')`
   - Main calls `autoUpdater.downloadUpdate()`
   - Progress reported via `download-progress` (percent shown in the progress bar)
   - On completion → `downloaded` → "Update ready. Restart to install."
3. **User clicks "Restart & Install"**
   - Renderer calls `ipcRenderer.invoke('install-update')`
   - Main calls `autoUpdater.quitAndInstall()`
   - The app quits, runs the NSIS installer, and reopens on the new version.

### 1.5 GitHub Token (Private Repos Only)

- **Public repo:** No token needed. The updater clears any stale `GH_TOKEN` to avoid 401 errors.
- **Private repo:** Set a token either:
  - At build time via `$env:GH_TOKEN = "ghp_..."`, or
  - At runtime via the config file `app.getPath('userData')/github_token.json` containing `{ "token": "..." }`.
- The app exposes IPC handlers to read/set/clear this token: `get-github-token`, `set-github-token`, `clear-github-token`.

### 1.6 Common Update Errors

| Error | Cause | Fix |
|-------|-------|-----|
| 404 when downloading | `latest.yml` filename doesn't match the GitHub asset | Fix `latest.yml` to use dots |
| "Release not found" | Old release not deleted before re-upload | Delete old release first |
| Secret scanning blocks push | Token committed to source | Use env variable / config file only |

---

## 2. App Activation Process

The app uses a **Cloudflare Worker** license server with a **per-machine activation** model. The server code lives in `license-server/` and the client logic in `src/main/main.js`.

### 2.1 Components

| Component | Location | Role |
|-----------|----------|------|
| License server (Cloudflare Worker) | `license-server/src/index.js` | Validates keys, tracks activations per machine |
| KV store | `LICENSE_KV` (Cloudflare KV) | Stores all license keys and their activation records |
| App client | `src/main/main.js` | Generates a machine ID, calls the server, stores the license locally |
| Local license file | `app.getPath('userData')/license.json` | Caches the activation result on the machine |
| Seed script | `license-server/seed.js` | Generates initial license keys |

### 2.2 License Server Setup (One-Time, Developer)

Fully documented in `license-server/DEPLOY.md`:

1. Authenticate Wrangler: `npx wrangler login`
2. Create KV namespace: `npx wrangler kv:namespace create LICENSE_KV`
3. Paste the returned ID into `wrangler.toml` (already configured in this repo).
4. Set the `ADMIN_SECRET` at the top of `license-server/src/index.js`.
5. Deploy: `npx wrangler deploy`
6. Seed initial keys:
   ```bash
   node seed.js YOUR_ADMIN_SECRET https://dtr-license-server.xxxx.workers.dev
   ```
   This creates 3 keys (one per customer).

The server endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/validate` | POST | Validate a key + register a machine |
| `/admin/add-key` | POST | Create a new license key |
| `/admin/list-keys` | GET | List all keys (requires `X-Admin-Secret` header) |
| `/admin/revoke` | POST | Revoke a key |

### 2.3 Activation Flow (User-Side)

This happens automatically on first launch, before the login screen.

1. **App starts** → renderer calls `ipcRenderer.invoke('check-license')`.
2. **Main checks the local license file** (`license.json`) in `userData`:
   - If a valid key + `activatedAt` exists → `{ activated: true }` → renderer shows the **login screen**.
   - If not → `{ activated: false }` → renderer shows the **activation screen**.
3. **User enters a license key** and submits.
4. **Renderer calls** `ipcRenderer.invoke('activate-license', key)`.
5. **Main generates a machine ID** using `getMachineId()`:
   ```js
   sha256(hostname + username + platform + arch + MAC address)` → first 16 hex chars
   ```
6. **Main POSTs** `{ key, machineId }` to `${LICENSE_SERVER}/validate` (default: `https://dtr-license-server.jencendencia.workers.dev`).
7. **Server validates the key:**
   - Key exists? If not → "Invalid license key."
   - Revoked? → "This license key has been revoked."
   - Expired? → "This license key has expired."
   - Already at max activations & this machine isn't registered? → blocked.
   - Otherwise → registers the machine ID and returns `{ valid: true }`.
8. **On success**, main saves the license locally:
   ```js
   saveLicense({ licenseKey, machineId, activatedAt });
   ```
9. **Renderer shows the login screen**; the app is now activated on this machine.

### 2.4 Activation Rules

- Each license key has a **`maxActivations`** count (default `1`).
- The server tracks an **`activations` array** of machine IDs.
- The same machine can **re-activate** without consuming an extra slot (already-registered machines are recognized).
- A key can only be used on **`maxActivations` distinct machines**.

### 2.5 Managing License Keys (Admin)

```bash
# Add a key (one per customer)
curl -X POST https://dtr-license-server.xxxx.workers.dev/admin/add-key \
  -H "Content-Type: application/json" \
  -d '{"adminSecret":"YOUR_SECRET","maxActivations":1}'

# Revoke a key
curl -X POST https://dtr-license-server.xxxx.workers.dev/admin/revoke \
  -H "Content-Type: application/json" \
  -d '{"adminSecret":"YOUR_SECRET","key":"DTR-XXXX-XXXX-XXXX"}'

# List all keys
curl -H "X-Admin-Secret: YOUR_SECRET" \
  https://dtr-license-server.xxxx.workers.dev/admin/list-keys
```

### 2.6 Key Format

Keys are generated with the format **`DTR-XXXX-XXXX-XXXX`** (4 groups of 4, using unambiguous characters `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).

---

## 3. Quick Reference

### Update Process (Developer)
- [ ] Bump version in `package.json`
- [ ] `npm run dist`
- [ ] Fix `dist/latest.yml` (hyphens → dots)
- [ ] Delete old release
- [ ] `gh release create` with `.exe`, `.exe.blockmap`, `latest.yml`
- [ ] Verify asset names use dots

### Update Process (User)
1. About / Settings → **Check for Updates**
2. **Download Update** (progress bar shown)
3. **Restart & Install** (app quits, installer runs)

### Activation Process (Developer/Admin)
- [ ] Deploy the Cloudflare Worker (see `DEPLOY.md`)
- [ ] Seed initial keys with `node seed.js`
- [ ] Give one key per customer (max 1 activation each)

### Activation Process (User)
1. First launch → activation screen appears
2. Enter license key → **Activate**
3. Server validates + registers machine → login screen appears
4. (Subsequent launches skip activation if `license.json` exists)

---

## 4. Key Files

| File | Purpose |
|------|---------|
| `package.json` | Version, `electron-updater`, publish config |
| `src/main/main.js` | Auto-updater logic + license client logic |
| `src/renderer/renderer.js` | Update & activation UI |
| `GITHUB_RELEASE_UPLOAD_GUIDE.md` | Detailed release upload steps |
| `license-server/src/index.js` | License validation server |
| `license-server/DEPLOY.md` | Server deployment steps |
| `license-server/seed.js` | Initial key seeding |
| `license-server/wrangler.toml` | Cloudflare Worker config + KV binding |
