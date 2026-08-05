# TapIn School — Feature Improvement Plan

**Status:** Research & proposal (no code changed)
**Date:** August 2026
**Scope:** Features that can improve the existing TapIn School gate-attendance kiosk (Electron + React + MySQL + SMS). Each item lists *what*, *why*, *effort*, and *where it touches* the codebase so the team can pick and implement incrementally.

---

## 1. Current capabilities (baseline)

Already in the app today:

- **Scanning:** USB QR gun (HID keyboard) + webcam fallback (`html5-qrcode`); signed payloads (`CP-YYYY-<no><check>`).
- **Gate logic:** auto IN/OUT toggle, configurable debounce (120 s default), photo privacy toggle.
- **SMS:** async queue worker (1 s poll, 5 retries, FAILED → manual retry), providers: Simulator / GSM serial (SIM800L/SIM900A) / Cloud (Semaphore, PhilSMS, MessageBird, generic HTTP). Custom template with placeholders.
- **Admin dashboard:** Overview (today stats, hourly chart, 7-day totals), Students (CRUD, photos, QR print, CSV import), Attendance Logs (filters + CSV export), SMS Outbox (audit + retry + test), Settings (school name/logo, debounce, SMS provider, template).
- **UI/UX:** dark design system, live activity feed, audio feedback, auto-reset results, frameless fullscreen window with custom controls, online/offline status dots.

Known gaps this plan addresses:

- **FR-6 "Offline first" is partial** — if MySQL is down, scans cannot be logged at all (kiosk shows OFFLINE). There is no local write-behind queue.
- **Single parent phone per student** (no secondary/emergency contacts).
- **No late / absent / early-departure logic**, no bell schedules, holidays, or academic calendar.
- **No SMS credit/balance monitoring** (relevant for PhilSMS/Semaphore prepaid credit).
- **No backups, no watchdog/auto-restart, no kiosk locking, no auto-update.**
- **No roles** — one admin account only.
- **Reports are CSV-only**; no Excel/PDF, no scheduled reports.

---

## 2. Priority framework

| Priority | Meaning |
| --- | --- |
| **P0** | Data integrity + kiosk reliability. Ship first; everything else depends on a dependable kiosk. |
| **P1** | High-value features for day-to-day school use (attendance intelligence, SMS reliability, reporting). |
| **P2** | Differentiators / larger projects (portals, RBAC, multi-campus, analytics depth). |

---

## 3. P0 — Kiosk reliability & data integrity

| # | Feature | Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| 3.1 | **Local write-behind queue (real offline-first)** — ✅ *implemented (Aug 2026)*: scans are processed from a cached student/today-state snapshot and written to a JSONL queue (`userData/queue/`) when MySQL is down, then replayed into `attendance_logs` + `sms_logs` on reconnect (status event + 30 s interval). See `electron/services/offline.ts`. | L | `electron/db/`, `electron/services/attendance.ts`, `electron/main.ts`, `db/schema.ts` |
| 3.2 | **Automatic DB backups** — ✅ *implemented (Aug 2026)*: JSON snapshot of all tables to `userData/backups/` on boot + every 12 h, keeps 14. See `electron/services/backup.ts`. | S–M | new `electron/services/backup.ts`, `main.ts` boot |
| 3.3 | **Watchdog / auto-restart** — ✅ *implemented (Aug 2026)*: uncaught-exception log + relaunch (packaged), renderer crash/hang reload with loop cap, `userData/logs/app.log`. OS-level restart still needs NSSM/node-windows (README). See `electron/services/watchdog.ts`. | M | packaging / `main.ts`, docs in `README.md` |
| 3.4 | **Kiosk hardening** — ✅ *implemented (Aug 2026)*: `Menu.setApplicationMenu(null)`, global `context-menu` block, `devTools:false` in packaged builds. Assigned Access still a deployment step. | S | `electron/main.ts` |
| 3.5 | **Prevent display sleep / power loss** — ✅ *implemented (Aug 2026)*: `powerSaveBlocker.start('prevent-display-sleep')`. OS `powercfg`/GPO still worth setting. | S | `electron/main.ts` |
| 3.6 | **Auto-launch on boot** — ✅ *implemented (Aug 2026)*: `app.setLoginItemSettings({ openAtLogin: true })` for packaged installs. | S–M | `electron/main.ts` (app.setLoginItemSettings), docs |
| 3.7 | **Clock/time sync awareness** — ✅ *implemented (Aug 2026)*: drift vs `SELECT NOW()` measured on boot/reconnect/15 min, shown in the DB status dot title + logs. See `electron/services/clock.ts`. | S | `db/connection.ts`, docs |
| 3.8 | **Silent auto-update** — ✅ *implemented (Aug 2026, needs update server URL)*: `electron-updater` wired (packaged only, 4 h checks); set the real `publish.url` in `electron-builder.yml`. See `electron/services/updater.ts`. | M | `electron-builder.yml`, new `electron/services/updater.ts` |

---

## 4. P1 — Attendance intelligence

| # | Feature | Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| 4.1 | **Late & early-departure flags** — ✅ *implemented (Aug 2026)*: configurable `bell_time_in`/`bell_time_out`/`bell_grace_minutes` in Settings; IN after start+grace = LATE, OUT before dismissal = EARLY. Flags are computed on the fly (no migration) and shown on the kiosk card, activity feed, Logs (+CSV) and Overview; optional `{{flag}}` SMS placeholder. See `electron/services/bell-times.ts`. | M | `shared/types.ts`, `electron/services/attendance.ts`, `db/schema.ts`, Logs + Overview screens |
| 4.2 | **Automated absence detection** — ✅ *implemented (Aug 2026)*: after dismissal (+60 min) a scheduler records ABSENT (no scan that day) and LATE (first IN after cutoff) students in a new `absence_logs` table, optionally SMS-ing parents (`absence_sms`); the "gate used that day" heuristic skips holidays/weekends and missed days are backfilled (max 3). See `electron/services/absence.ts`. | M | new `electron/services/absence.ts` (scheduler), `attendance.ts`, schema |
| 4.3 | **Bell schedules & shifts** | Per-section start/end times (morning/afternoon shifts, half days, exam weeks) instead of hardcoded cutoff. | M | `db/schema.ts` (schedules table), Settings screen |
| 4.4 | **Holidays / academic calendar** | Weekend/holiday handling — skip absence alerts, show a "No classes today" idle state. Manual + (later) automated suspension pauses. | M | `db/schema.ts` (calendar table), `attendance.ts`, KioskScreen idle state |
| 4.5 | **Excuse / leave records** | Pre-filed excuses (medical, school events) suppress false absence/late alerts; visible in logs with a reason. | M | schema, Students or Logs screens |
| 4.6 | **Manual log corrections** | Admin can edit/insert/delete a log entry with an audit trail (needed for "the scanner missed me" cases). | M | Logs screen, `ipc.ts`, new audit table |
| 4.7 | **Multi-gate identity** | Tag scans with which gate (Gate 1 / Gate 2). Small schema + settings change; valuable later for campus flow analysis. | S | schema, `ScanSource`/settings, kiosk config |

---

## 5. P1 — Parent engagement & SMS reliability

| # | Feature | Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| 5.1 | **Multiple guardian contacts** | Primary + secondary numbers (mother/father/guardian/emergency). Route: try primary; on SMS failure fall back to secondary, or broadcast to all for critical alerts. | M | `shared/types.ts`, Students CRUD + CSV import, `sms/queue-worker.ts`, `message-builder.ts` |
| 5.2 | **SMS credit / balance monitoring** | Show remaining credits in SMS Outbox; low-credit warning (threshold in Settings). PhilSMS/Semaphore expose balances; generic providers can be skipped. | M | `sms/providers/*`, `electron/ipc.ts`, SmsOutbox screen |
| 5.3 | **Delivery receipts (DLR)** where supported | Surface provider-level delivery status (delivered/failed) alongside SENT/FAILED. | M | providers + `sms_logs` schema + Outbox |
| 5.4 | **Per-parent notification preferences & opt-out** | Parent chooses IN-only / OUT-only / late-absent / none (Data Privacy Act 2012 requires a clear opt-out). | M | schema, Students/settings, `message-builder.ts`, `queue-worker.ts` |
| 5.5 | **Consent record (DPA)** | Store a consent checkbox + date per student; exportable report. Schools are *Personal Information Controllers* — this is a compliance requirement, not optional polish. | S | schema, Students screen, reports |
| 5.6 | **GSM-7 vs Unicode warning** | Warn in Settings when a template character forces 16-bit (70-char) segments, doubling cost. Cheap, prevents billing surprises. | S | `sms/message-builder.ts`, Settings |
| 5.7 | **Fallback channels (email / push / Viber / Messenger)** | When SMS fails or parent prefers data channels. Bigger project; design the notification interface now so providers can be added later. | L | new `sms/providers` interface extensions |

---

## 6. P1 — Reporting & dashboard depth

| # | Feature | Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| 6.1 | **Excel (.xlsx) & PDF exports + email** — ✅ *implemented (Aug 2026)*: new Reports tab with date-range summary + per-day breakdown; styled `.xlsx` via `exceljs` (`electron/services/report-export.ts`), PDF via a dedicated hidden-window `printToPDF` (`electron/services/report-pdf.ts`), and **email delivery** of the report (PDF attachment) through the school's own SMTP server via `nodemailer` (`electron/services/report-email.ts`, SMTP settings + recipient in Settings). See `electron/services/report.ts`, `src/screens/admin/Reports.tsx`. **What the report should include next:** see `REPORTS_PLAN.md` (researched against SmartGate/SmartClass PH + DepEd SF2/SF4/SF9/Form 137 — per-student summaries, SF2 register matrix, section rollups, absentee list, SMS audit, trends; Tier 1 needs no schema changes). | M | `electron/` export + email services, new Reports screen |
| 6.2 | **On-campus now (occupancy)** | Live "students currently inside" count derived from today's IN/OUT logs. Simple and very visible on Overview. | S | `electron/ipc.ts` getOverview, Overview screen |
| 6.3 | **Absent & late daily lists** | One-click lists per section/grade for advisers. | M | reports service + Logs/Overview |
| 6.4 | **Chronic absentee/tardy view** | Weekly/monthly patterns per student or section to spot at-risk students. | M | new analytics queries + Overview |
| 6.5 | **Scheduled email reports** | Weekly/monthly summaries emailed to principal/advisers (uses SMTP or a service). | L | scheduler + mailer |
| 6.6 | **Audit log of admin actions** | Who changed what (student edits, log corrections, settings). Prerequisite for RBAC. | M | new audit table + `ipc.ts` wrappers |

---

## 7. P2 — Larger projects / differentiators

| # | Feature | Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| 7.1 | **Role-based access (RBAC)** | Super admin / principal / adviser / teacher with scoped views (section-only logs). The `users` table already exists — extend it with roles. | L | `services/auth.ts`, `ipc.ts`, admin screens |
| 7.2 | **Parent/guardian portal** | Web or mobile view where parents see their child's logs. Significantly expands scope (needs a server or the app acting as one). | XL | new surface; API-first design |
| 7.3 | **Bulk student photo import** | Upload a folder/zips keyed by student_no; today photos are one-by-one. | M | Students screen + `ipc.ts` |
| 7.4 | **Multi-campus / multi-tenant** | Central dashboard for several campuses. Big architectural change (tenant columns or separate DBs). | XL | schema + queries + admin |
| 7.5 | **Kiosk voice announcements** | TTS ("Good morning, Juan") — accessibility + delight. Cheap to prototype (`speechSynthesis`). | S | KioskScreen |
| 7.6 | **Multilingual UI (EN / Filipino)** | Public-school friendly. | M | i18n pass over `src/` |
| 7.7 | **Ambient idle modes** | Show school announcements / schedule on idle screen instead of a static QR prompt (carousel). | M | KioskScreen idle state + settings |
| 7.8 | **Attendance streaks / gamification** | "3-week perfect attendance" badges for students. Nice for adoption. | S | Overview/kiosk |
| 7.9 | **Remote health dashboard** | Heartbeat pings (CPU, disk, queue depth, version) from each kiosk to a lightweight admin page; crash reports (Sentry). | L | telemetry service |

---

## 8. Suggested roadmap

**Phase 1 — Reliability first (weeks 1–3, P0):**
3.1 local write-behind queue → 3.2 backups → 3.4 kiosk hardening → 3.5 power save → 3.6 autolaunch → 3.7 time sync → 3.8 auto-update.

**Phase 2 — Attendance intelligence (weeks 4–8, P1):**
4.1 late/early ✅ → 4.2 absence detection ✅ → 4.3 schedules → 4.4 calendar → 6.2 occupancy → 6.3 lists → 6.1 xlsx/pdf.

**Phase 3 — Parents & compliance (weeks 8–12, P1):**
5.1 multi-guardian → 5.5 consent → 5.4 preferences/opt-out → 5.2 credits → 5.3 DLR → 5.6 encoding warnings → 6.6 audit log → 6.4 chronic view.

**Phase 4 — Larger bets (later, P2):**
7.1 RBAC → 7.2 parent portal → 7.4 multi-campus → 7.9 telemetry.

*Suggested quick wins to start (small, high impact):* 6.2 occupancy, 3.4 kiosk hardening, 3.5 power save, 5.6 encoding warning, 4.1 late flags.

---

## 9. Research sources

- National Privacy Commission — *Republic Act No. 10173 (Data Privacy Act of 2012)* — https://privacy.gov.ph/data-privacy-act/
- IPROG SMS (PH) — SMS API guides, sender-name registration (Globe/Smart/DITO) — https://www.iprogsms.com/blog
- ExpertTexting — school parent SMS best practices — https://www.experttexting.com/blog/how-can-i-get-best-value-using-text-message-notifications-to-parents-for-school/
- Electron docs — `powerSaveBlocker`, `app.setLoginItemSettings`, `protocol`, kiosk mode, context-menu handling
- electron-builder / electron-updater — NSIS auto-update docs
- Microsoft — Windows Assigned Access (single-app kiosk mode) documentation
- SQLite backup API (`sqlite3_backup_init`) for hot backups of local stores

---

## 10. How to use this plan

1. Pick a feature from Phase 1–2, open a task, and implement it with the same conventions as the rest of the codebase (shared `TapinApi` contract → `ipc.ts` handler → preload → renderer screen).
2. Every feature that touches data must update `db/schema.ts` + `scripts/init-db.mjs` (idempotent migrations) and the mock API in `src/lib/api.ts` so browser demo mode keeps working.
3. Re-run `npm run typecheck` (renderer + electron) after each feature.
