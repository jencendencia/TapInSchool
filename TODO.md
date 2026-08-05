# TapIn School — Auto-Update & App Activation TODOs

## Part A — Auto-Update (GitHub Releases)
- [ ] shared/types.ts: add UpdateStatus/UpdateInfo types + TapinApi methods + onUpdateStatus
- [ ] electron/services/updater.ts: refactor to manual flow + status events + exports
- [ ] electron/ipc.ts: add checkForUpdates / downloadUpdate / installUpdate / getAppVersion handlers
- [ ] electron/preload.ts: expose update API + onUpdateStatus
- [ ] src/lib/api.ts: add mock update methods (browser dev)
- [ ] src/components/UpdatePanel.tsx: update UI (check / download / install / progress)
- [ ] src/screens/admin/Settings.tsx: add UpdatePanel

## Part B — App Activation (License)
- [ ] license-server/src/index.js: Cloudflare Worker (validate / add-key / list / revoke)
- [ ] license-server/wrangler.toml: config + KV binding
- [ ] license-server/seed.js: key seeding script
- [ ] electron/services/license.ts: machine ID + license client + IPC handlers
- [ ] electron/ipc.ts: register license handlers
- [ ] electron/preload.ts: expose license API
- [ ] shared/types.ts: LicenseStatus types + TapinApi methods
- [ ] src/lib/api.ts: mock license methods (browser bypass)
- [ ] src/components/ActivationScreen.tsx: activation UI
- [ ] src/App.tsx: gate app behind activation

## Validation
- [ ] npm run typecheck
- [ ] npm run dist + publish new release
