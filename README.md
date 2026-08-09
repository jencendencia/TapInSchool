# 🎓 TapIn School

Automated school gate QR-code attendance kiosk with **SMS alerts to parents**.
Electron + React (Vite) desktop app · MySQL 8.0 · USB QR scanner + webcam fallback ·
GSM serial (SIM800L/SIM900A) and cloud SMS gateways.

> Built from `TapInSchool_PRD_and_Design_System.txt` (v2.0).

---

## Quick start

```bash
npm install

# 1. Database — pick one:
docker compose up -d                      # easiest: local MySQL 8.0 in Docker
#   or install MySQL 8.0 yourself (Windows: MySQL Community Server installer)

# 2. Configure credentials
cp .env.example .env                      # then edit DB_USER / DB_PASSWORD

# 3. Create database + tables (+ demo students)
npm run db:init -- --seed

# 4. Run
npm run dev                               # dev mode (Vite + Electron)
npm start                                 # or: build + run packaged-style
npm run dist                              # or: build a Windows installer (NSIS)
```

**No MySQL yet?** The app still opens — the kiosk shows a Database OFFLINE state
and the whole UI (including the admin dashboard) can be explored in a plain
browser with mock data:

```bash
npx vite                                  # open http://127.0.0.1:5173
```

---

## Hardware & SMS providers

| Provider | How it works | Config |
| --- | --- | --- |
| **Simulator** (default) | Logs delivery, no hardware | `Admin → Settings` |
| **GSM module** | SIM800L/SIM900A over serial, AT+CMGF / AT+CMGS | COM port + baud; run `npm run rebuild:serial` once for Electron |
| **Cloud API** | Semaphore (PH) / PhilSMS (PH) / MessageBird / generic HTTP endpoint | API key in Settings |

The queue worker polls `sms_logs` PENDING rows every 1 s (non-blocking), retries
up to 5 times, then marks FAILED (retryable from the SMS Outbox).

**PhilSMS walkthrough** (account sign-up → API token → sender ID → credits →
app config → test send → troubleshooting): see [`PHILSMS_SETUP_GUIDE.md`](PHILSMS_SETUP_GUIDE.md).

---

## QR codes

- Payload format: `CP-<YEAR>-<studentNo><check>` (e.g. `CP-2026-2024-0112KQX`),
  3-character check derived from student number + `QR_SECRET`.
- Admin → Students → ▦ generates/prints the QR; the gate matches the payload
  **exactly** against `students.qr_hash_payload` (no URL parsing, no forgery).
- ⚠️ Do **not** change `QR_SECRET` after enrolling students — it invalidates codes.
- USB scanners in HID keyboard mode work out of the box (keystroke burst +
  Enter). A webcam fallback is available from the kiosk's Camera Scanner button.

## Gate logic (per PRD)

- **Debounce (FR-5):** same student re-scanned within 120 s (configurable) is rejected.
- **Toggle (FR-4):** latest scan today IN → logs OUT, otherwise IN.
- **Offline-first (FR-6):** logs + queued SMS persist in the local MySQL DB; SMS
  sends whenever the configured gateway is available.
- **Photo privacy (FR-7):** `show_photos` toggle swaps photos for avatars.

## Keyboard shortcuts

- `F11` — fullscreen kiosk
- `Ctrl+Shift+A` — toggle Admin Dashboard

## Kiosk operations & hardening (P0)

- **Automatic backups** — every table is dumped to `userData/backups/backup-*.json` on
  app start and every 12 h (keeps the 14 most recent).
- **Watchdog** — uncaught main-process errors and renderer crashes/hangs are logged to
  `userData/logs/app.log`; the packaged app relaunches itself on a fatal error. For
  OS-level restart-on-failure, wrap the exe in a Windows service (NSSM or node-windows)
  with restart recovery enabled.
- **Kiosk lockdown** — frameless fullscreen window, no application menu, no right-click
  context menu, no DevTools in packaged builds. For maximum lockdown deploy with
  Windows *Assigned Access* (single-app kiosk mode) on a standard non-admin user.
- **Power** — the app blocks display sleep (`powerSaveBlocker`); also set the OS
  power plan so the machine never sleeps (`powercfg -x -standby-timeout-ac 0`).
- **Auto-launch** — packaged installs register to start at Windows login.
- **Clock sync** — attendance timestamps use the MySQL server clock while online; a
  >2 min drift between the kiosk clock and the DB server is flagged on the kiosk's
  Database status dot. Keep Windows time sync (w32time / NTP) enabled.
- **Auto-update** — packaged builds check `publish.url` (see `electron-builder.yml`)
  every 4 h and install updates on quit; set the real update-server/GitHub URL before
  shipping. Sign your binaries for production.

## Project layout

```
electron/            Electron main process (Node)
  main.ts            window, env, boot, shortcuts
  ipc.ts             all ipcMain handlers
  preload.ts         contextBridge → window.tapin
  db/                MySQL pool, schema, settings store
  services/          scan processor (debounce/toggle), USB scanner, QR payloads
  sms/               queue worker + providers (simulator, gsm, cloud)
shared/types.ts      the TapinApi contract (main ↔ renderer)
src/                 React renderer
  screens/KioskScreen.tsx      PRD Screen A
  screens/admin/*              PRD Screen B
  lib/api.ts                   bridge client + in-browser mock
scripts/init-db.mjs  database bootstrap + demo seed
```

## Troubleshooting

- **MySQL unreachable** — check `.env`, `docker compose ps`, firewall port 3306.
- **SMS shows "MessageBird rejected the API key (401)"** — the app live-verifies
  the key on boot (Admin → Settings → SMS). New `bk_…` keys must be **active**
  and the account's SMS onboarding **complete** before the API accepts them;
  otherwise use the legacy `live_…`/`test_…` access key format, or switch the
  provider to Semaphore / Simulator in Settings.
- **GSM shows "serialport not rebuilt"** — run `npm run rebuild:serial` (needs
  Visual Studio build tools on Windows or the matching prebuild).
- **Scans not registering from the USB gun** — the app only captures the
  keystroke burst in kiosk mode; ensure the scanner is set to HID Keyboard mode
  with a trailing Enter, and that the kiosk screen (not the admin) is active.
