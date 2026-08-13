# TapIn School — Research-Based Improvement Plan

**Status:** Research & proposal (no code changed)
**Date:** August 2026
**Method:** Internet research on (A) DepEd/PH school-attendance compliance, (B) parent-notification channels in the Philippines, (C) Electron kiosk reliability & security best practices, and (D) attendance analytics / early-warning features. Each recommendation lists *what*, *why*, *effort*, *where it touches*, and how it relates to the existing plans (`FEATURE_IMPROVEMENT_PLAN.md`, `REPORTS_PLAN.md`, `BADGE_RANKING_PLAN.md`).

> **Legend:** ✅ already implemented · 📋 already planned in an existing plan · 🆕 new idea from this research · 🔶 recommended follow-up.

---

## 1. Research summary (what the internet says)

### 1.1 Philippine school attendance systems & DepEd compliance
- **SF2 (School Form 2) automation** — systems map gate scans directly into the official class-record format (daily present/absent/late tallies + monthly totals) to save teachers from manual tallying.
- **LIS & LRN** — learner profiles tie back to the 12-digit **Learner Reference Number** so enrollment matching, learner tracking, and DepEd reporting align with the **Learner Information System**.
- **Child protection & security** — gate systems are built around **DepEd Order No. 40, s. 2012** (Child Protection Policy): only authorized persons enter, and there is a tamper-proof digital log of campus entries/exits.
- **RFID vs QR vs biometrics** — RFID tap-cards are fastest/most durable (popular in *Wela School System*); QR is the cheapest (any tablet + camera, used by *SmartClass PH* and capstone builds); biometrics remove lost-card risk but bottleneck peak-hour queues.
- **All-in-one platforms** — local platforms (Wela, e-School ERP) bundle gate attendance with grading, enrollment, cashiering, class scheduling, and LMS so data flows into SF9 report cards without duplicate entry.

### 1.2 Parent notification channels in the Philippines (2024–2026)
- **SMS via local gateways is the backbone** — Semaphore and PhilSMS (PhilGEPS-accredited, ~₱0.35/text) reach every parent without a smartphone/data plan; legacy Chikka is defunct; Globe/Smart are usually routed through aggregators.
- **SMS alone is not enough — omnichannel wins.** Messenger ~95% penetration, **Viber ~71%**, WhatsApp ~40%. Schools use **Viber Business Messages**, Messenger chatbots, and **Telegram bots** (free Bot API, reliable push) for structured notifications. Best practice: SMS for mission-critical safety alerts + a data channel (Viber/Messenger) for routine updates.
- **Parent portals & digests** — daily/weekly email or portal summaries of attendance % and grades are standard in SIS products.

### 1.3 Electron kiosk reliability, security & updates
- **Auto-update** — `electron-updater` (not the built-in `autoUpdater`): supports staged rollouts via `stagingPercentage` and **`autoInstallEvent = "onNextLaunch"`** to avoid corrupt installs when the OS shuts down mid-update.
- **Offline-first** — local relational store (SQLite via `better-sqlite3`) with WAL mode; sync engine (PowerSync/RxDB) against the central MySQL; aggressive query caching (e.g. TanStack Query `staleTime`).
- **Security** — `contextIsolation: true`, `sandbox: true`, narrow `contextBridge` API, block `will-navigate`/webview navigation, strict CSP headers. Kiosks in public spaces are prime jailbreak targets.
- **MySQL reliability** — binary-log (PITR) on the server, `mysqldump --single-transaction`, offsite encrypted backups following the 3-2-1 rule.
- **Performance** — never block the main-process event loop; code-split renderer views; modern image formats.

### 1.4 Attendance analytics & early-warning systems (EWS)
- **Chronic absenteeism is the key metric** — a school can show 95% **ADA** (Average Daily Attendance) while 25% of students are chronically absent (≥10% of school days). Modern dashboards show **both** metrics side by side.
- **Tiered risk stratification** — Low (<5–6 days / <5%), Moderate (6–9 days / 5–9%), High/Chronic (≥10 days / ≥15%). "**Recently absent**" alerts (≥3 missed days in the last 10 instructional days) drive immediate intervention instead of waiting for monthly totals.
- **Pattern analysis** — attendance by day-of-week (high Monday/Friday absence flags transport or systemic barriers) and month-over-month trends.
- **Per-subject / per-period attendance** — middle/high-schools need period-level tracking (e.g. always misses 4th-period math) that daily rolls miss.
- **Guardian engagement metrics** — log automated/manual outreach per student and surface "intervention gaps" (high-risk student with zero recorded outreach).

---

## 2. Current state (what TapIn already has)

| Area | Already built ✅ |
| --- | --- |
| Gate scanning | USB QR gun + webcam fallback, signed payloads (`CP-…`), exact-payload match |
| Offline-first | Local write-behind JSONL queue replayed on reconnect (`offline.ts`) |
| Reliability | Auto backups (JSON, 12 h, keeps 14), watchdog + relaunch, kiosk lockdown, power-save block, auto-launch, clock-drift detection, silent auto-update (needs real `publish.url`) |
| Attendance intelligence | LATE/EARLY flags from bell times, automated absence detection + SMS, excuses, badges (ATT/PUNCT × week→year), manual check-in, scan mode |
| SMS | Queue worker (1 s, 5 retries), providers: Simulator / GSM serial / Cloud (Semaphore, PhilSMS, MessageBird, generic) |
| Admin | Overview, Students (photos, QR print, CSV import), Guardians registry, Visitors + gate passes, Logs, SMS Outbox, Sections, School years, Reports (PDF/Excel/email + adviser delivery), Users & roles, Settings |
| DB | MySQL 8.0, network connect dialog (saved config), school-year enrollments, LRN field on students |

**Biggest gaps this research highlights:** no DepEd-compliant SF2/LIS export path beyond CSV, SMS-only notifications (no Viber/Messenger/Telegram), no chronic-absence early-warning view, updates not yet configured for real-world rollout, and no remote health dashboard.

---

## 3. Theme A — DepEd compliance & official reporting (🆕 mainly)

| # | Feature | What / Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| A1 | **SF2-ready register export (official format)** | Research 1.1: teachers submit SF2, not ad-hoc spreadsheets. We already have an SF2-style register matrix (REPORTS_PLAN Tier 1) — add an **official SF2 export** (per-section, monthly, teacher + school headers) as PDF/Excel, and a "mark for submission" workflow. | M | `report.ts`, `report-export.ts`, `report-pdf.ts`, Reports screen |
| A2 | **LRN / LIS alignment** | Students already carry an optional **LRN**. Add LIS column headers to CSV/Excel exports, validate 12-digit LRN format, and add a **bulk LIS import** mapping (LRN, name, grade/section) so a school can onboard straight from LIS exports. | M | Students import/export, `shared/types.ts`, `ipc.ts` |
| A3 | **Child-protection entry log (DO 40)** | Research 1.1: schools must keep a tamper-proof record of who entered campus. We have the digital log — add a **formal "Gate logbook" export** (date, name, student no., IN/OUT, source, flag) with a printed-header format suitable for the guard's file, and make logs append-only (manual corrections already planned 4.6 with an audit trail). | S–M | `report.ts`, Logs screen |
| A4 | **RFID tap option** (🔶 strategic) | Research 1.1: RFID is the most common alternative to QR in PH schools and survives bag/pocket use. An **RFID reader adapter** (like the GSM serial pattern — same queue, debounce, toggle logic; payload = tag ID mapped to student) would let schools keep their existing RFID cards. Hardware-dependent; keep as an optional provider. | L | new `services/rfid.ts` (mirrors `scanner.ts`), Settings, schema `students.rfid_tag` |
| A5 | **Report-card (SF9) summary hook** | Gate data feeds report cards (SF9). Provide a **per-student attendance summary sheet** (days present/absent/late per month, % rate) formatted for teachers to paste into SF9. | S–M | `report.ts` per-student, Reports screen |

---

## 4. Theme B — Parent engagement & omnichannel notifications (🆕)

| # | Feature | What / Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| B1 | **Viber Business Messages channel** | Research 1.2: Viber ~71% PH penetration and is the go-to formal B2C channel. Add a **Viber provider** (same `sms/providers` interface → `message-builder.ts` → queue) with per-parent channel preference (SMS / Viber / both). Keeps SMS as fallback. | M–L | `sms/providers/viber.ts`, schema (channel pref), Settings, Outbox |
| B2 | **Telegram bot channel** | Research 1.2: Telegram Bot API is free, reliable push with rich formatting. Cheapest omnichannel add — ideal for tech-comfortable schools/teachers. | M | `sms/providers/telegram.ts`, Settings (bot token + chat IDs per student) |
| B3 | **Messenger/Chatbot (later)** | Messenger ~95% penetration, but Meta's 24-hour messaging-window rules make transactional alerts awkward; better as a school-announcement broadcast channel. Document as a follow-up, not v1 of the omnichannel work. | L | future `providers/messenger.ts` |
| B4 | **Per-parent channel preference + opt-out** | Combine with existing plan 5.4/5.5 (preferences, opt-out, DPA consent record). Channel pref per guardian: `sms` / `viber` / `telegram` / `email` / `none`. Queue worker routes per message. | M | schema, Students/Guardians UI, `queue-worker.ts`, `message-builder.ts` |
| B5 | **Parent daily/weekly digest (email or portal)** | Research 1.2: digests are standard. Reuse the **adviser-report scheduler** (now daily/weekly/monthly — see Settings) to also email a **parent digest**: one email per guardian summarizing their children's IN/OUT/late/absent for the period. | M | new `services/parent-digest.ts` (mirrors `adviser-report.ts`), `report-email.ts` |
| B6 | **Guardian portal (web)** | 📋 Already planned (7.2). Research confirms parent portals are table stakes in PH SIS products. API-first design; the Electron app already has the DB + auth. | XL | new surface (see plan 7.2) |

---

## 5. Theme C — Reliability, security & ops hardening (✅ mostly / 🆕 additions)

| # | Feature | What / Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| C1 | **Update: onNextLaunch + staged rollout** | ✅ auto-update exists; research 1.3 says configure **`autoInstallEvent = "onNextLaunch"`** (avoid corrupt installs on forced shutdown) and use **`stagingPercentage`** for safe fleet rollout. Set the real `publish.url` in `electron-builder.yml`. | S | `services/updater.ts`, `electron-builder.yml` |
| C2 | **Upgrade offline store JSONL → SQLite (WAL)** | ✅ offline queue works; research 1.3 recommends a real local relational store with WAL journaling (`better-sqlite3`) so a power cut mid-queue can't corrupt the JSONL tail and lookups stay fast. Keeps the same replay contract. | L | `services/offline.ts`, new `services/local-store.ts`, packaging |
| C3 | **Kiosk navigation/URL lockdown + CSP** | ✅ menu/context-menu/devTools locked; research 1.3 adds **`will-navigate` blocking** and a strict **CSP** (`script-src 'self'`) so a malicious payload can't navigate the kiosk or load remote scripts. Verify `contextIsolation`/`sandbox` are on for packaged builds. | S–M | `electron/main.ts`, `index.html` |
| C4 | **MySQL server-side backups (PITR + 3-2-1)** | ✅ app-level JSON backups exist; research 1.3: enable server **binlog** for point-in-time recovery, schedule `mysqldump --single-transaction`, push encrypted copies offsite. Document as a deployment checklist (the app can't do this from inside). | S (docs) | `NETWORK_DATABASE_CONNECTION.md`, README ops section |
| C5 | **Remote health dashboard / heartbeat** | 📋 Planned (7.9). Research 1.3: kiosks are unattended — a lightweight heartbeat (version, DB/sms status, queue depth, disk) to an admin page lets a school ops team monitor every gate. | L | telemetry service, new admin surface |
| C6 | **Renderer performance** | Research 1.3: code-split heavy admin views (`React.lazy`), avoid main-process blocking, modern image formats. The build already warns about a >500 kB chunk — split Reports/Badges views. | S–M | `src/App.tsx` lazy routes, `vite.config.ts` |

---

## 6. Theme D — Analytics, early warning & reporting depth (🆕 mostly)

| # | Feature | What / Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| D1 | **Chronic-absence early warning (EWS)** | Research 1.4: flag students **≥10% school days missed** (and tier: low <5%, moderate 5–9%, high ≥10%+). We already compute `atRiskCount` (<80% in report summary) — surface an **EWS view** listing chronically absent students with days missed, rate, and trend. | M | new `services/ews.ts` queries, Overview/Reports screen |
| D2 | **"Recently absent" alerts** | Research 1.4: **≥3 missed days in the last 10 instructional days** triggers an advisory-level alert (not an SMS to parents — an admin/adviser view + optional digest) for immediate intervention. | M | `services/ews.ts`, Reports screen |
| D3 | **ADA vs chronic-absence dual metric** | Research 1.4: show **Average Daily Attendance** *and* **% chronically absent** side by side on Overview so a high ADA can't hide a chronic-absence problem. | S–M | `ipc.ts` getOverview, `Overview.tsx` |
| D4 | **Day-of-week & month patterns** | Research 1.4: attendance by weekday (Monday/Friday dips → transport issues) and month-over-month. We already have `trends` report types (`weekly`, `dayOfWeek`) — surface them on Overview as small charts. | S | `Overview.tsx`, reuse `report.ts` trends |
| D5 | **Guardian outreach log & intervention gaps** | Research 1.4: log every automated/manual guardian contact per student (SMS/Viber/email + date) and highlight **high-risk students with zero outreach**. Extends the SMS audit we already have. | M | schema (`outreach_logs`), Reports/Overview, `sms_logs` link |
| D6 | **Per-period attendance (senior high)** | Research 1.4: period-level tracking catches "always misses 4th-period math". Gate-based systems capture IN/OUT only, so this needs **class-schedule records** per student + a period-attendance report. Bigger; park as a P2 follow-up. | XL | schema (schedules/periods), reports, Students |

---

## 7. Quick-win shortlist (small effort, high impact)

1. **C1** — configure `autoInstallEvent = "onNextLaunch"` + `stagingPercentage` + real `publish.url` (deployment-critical).
2. **A3** — formal Gate logbook export (guard's file) from existing logs.
3. **D3** — ADA + chronic-absence % on Overview (one query + two cards).
4. **D4** — weekday pattern chart on Overview (reuse `trends`).
5. **B2** — Telegram bot channel (free, fast to wire into the existing provider interface).
6. **A2** — LRN validation + LIS-friendly export headers.
7. **C3** — `will-navigate` block + CSP meta tag (cheap security wins).
8. **C6** — lazy-load the admin Reports/Badges routes (cuts the >500 kB chunk warning).

---

## 8. Suggested roadmap

**Phase 1 — Ship it properly (week 1):**
C1 update rollout config → C3 navigation/CSP lockdown → A3 gate logbook export → C4 MySQL ops checklist (docs).

**Phase 2 — Analytics & early warning (weeks 2–4):**
D3 ADA + chronic % → D1 EWS view → D2 recently-absent → D4 weekday patterns → D5 outreach log.

**Phase 3 — Omnichannel notifications (weeks 4–8):**
B2 Telegram → B1 Viber → B4 channel preferences/opt-out (with plan 5.4/5.5 DPA) → B5 parent digest (reuse the adviser-report scheduler).

**Phase 4 — DepEd depth (weeks 8–12):**
A1 official SF2 export → A5 SF9 summary sheet → A2 LIS import/export → A4 RFID option (strategic).

**Phase 5 — Bigger bets (later):**
C2 SQLite offline store → C5 remote health dashboard → B3 Messenger broadcast → B6 guardian portal → D6 per-period attendance.

---

## 9. Research sources

- DepEd — *School Form 2 (SF2)* automation & Learner Information System (LIS) / Learner Reference Number (LRN) integration notes; DepEd Order No. 40, s. 2012 (*Child Protection Policy*): https://www.deped.gov.ph
- Wela School System, SmartClass PH, e-School ERP — PH school-management product feature overviews (RFID tap attendance, parent apps, integrated modules)
- National Privacy Commission — *Republic Act No. 10173 (Data Privacy Act of 2012)*: https://privacy.gov.ph/data-privacy-act/
- Semaphore (PH SMS API): https://semaphore.co · PhilSMS (PH SMS API): https://www.philsms.com
- Infobip / regional mobile-messaging market research (2024–2026) — Messenger ~95%, Viber ~71%, WhatsApp ~40% penetration in the Philippines
- Viber Business Messages / Telegram Bot API documentation
- Electron docs — `contextIsolation`, `sandbox`, `will-navigate`, `powerSaveBlocker`, `app.setLoginItemSettings`; electron-builder / electron-updater — `autoInstallEvent = "onNextLaunch"`, `stagingPercentage`: https://www.electron.build/auto-update
- PowerSync / RxDB — offline-first sync architectures for Electron (SQLite + WAL); Doyensec — *Electron Security* research
- MySQL — point-in-time recovery via binary logs, `mysqldump --single-transaction`, 3-2-1 backup rule
- Panorama Student Success, PowerSchool, WISEdash, Attendance Works — chronic-absenteeism thresholds (≥10%), tiered risk stratification, "recently absent" (3 of last 10 days), ADA vs chronic metrics: https://www.attendanceworks.org

---

## 10. How to use this plan

1. Each item follows the repo convention: shared `TapinApi` contract (`shared/types.ts`) → `electron/ipc.ts` handler → `electron/preload.ts` → renderer screen → mock parity in `src/lib/api.ts` (browser demo mode must keep working).
2. Data changes update `electron/db/schema.ts` + `scripts/init-db.mjs` (idempotent migrations) and the mock.
3. Validate with `npm run typecheck` (renderer + electron) after each feature.
4. Cross-reference: 📋 items tie into `FEATURE_IMPROVEMENT_PLAN.md` (4.4 calendar, 4.5 excuses, 5.4/5.5 preferences & consent, 6.6 audit log, 7.2 portal, 7.9 telemetry) and `REPORTS_PLAN.md` (report tiers).
