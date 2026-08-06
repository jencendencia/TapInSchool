# TapIn School — Student Badge & Attendance Ranking (Plan)

**Status:** Research & proposal — **rev. 2** (user decision: positive/lenient — excused days exempt) (no code changed)
**Date:** August 2026
**Purpose:** Define a badge + ranking system that recognizes students with perfect attendance and perfect punctuality, grounded in the education-gamification research and in how TapIn actually records attendance (scans, bell-time flags, absence scheduler). Decides *what* before any code. Implements main plan item **7.8 (attendance streaks / gamification)** — see `FEATURE_IMPROVEMENT_PLAN.md`.

---

## 1. Research summary (what the web says)

### 1.1 How schools define "perfect attendance"
- **No absences vs. no tardies** — most districts keep these separate. Strict "perfect attendance" = zero absences *and* zero tardies, but many (e.g., Northside ISD) tolerate ≤1 tardy / partial-day absence per grading period, or allow documented medical-appointment exceptions.
- **Excused vs. unexcused** — excused absences (illness, religious observance, bereavement, court) usually need parent/medical documentation; strict awards disqualify on *any* absence, which is the source of most equity criticism.
- **Cumulative vs. streaks** — traditional awards are cumulative over a grading period/semester/year. Experts now recommend short, rolling windows (monthly/quarterly) so late-starting students can still be recognized.

### 1.2 Tiers and progression
- Common structure: **Bronze → Silver → Gold → Platinum** (e.g., Khan Academy's badge tiers; Unity ERP's weekly leagues that reset so no one feels hopelessly behind).
- Streak/milestone badges: 5/10/30-day chains, "50/100 days present" milestones (Attender).

### 1.3 The "awards backfire" research (must-read before building)
- Harvard/AERA field experiment (Robinson, Gallus, Lee, Rogers; ~15,000 middle/high-school students in CA): students who received a retrospective **perfect-attendance award missed 8.3% more school days the next month** than the control group — the "licensed to miss" effect (the award signals they attend *more* than expected, so they can skip).
- The effect was **worse for academically struggling students** (one-third more missed days).
- Corollary: awards may mildly help lower-elementary students; they consistently backfire in upper grades if used as *rewards*.

### 1.4 Equity & health concerns
- **Attendance Works** and *Education Week*: strict awards inherently exclude students with chronic illness, housing instability, transportation gaps, or caregiving duties; perfect-attendance awards can drive **presenteeism** (coming to school sick, worsening outbreaks).
- Recognition should be **positive and never punitive**; pair with root-cause support, never replace it.

### 1.5 Product examples
- **Attender** (MS partner): 8 attendance badge types, streak tracking, coins per minute present.
- **Unity ERP**: student wallets + Bronze→Platinum leagues, weekly resets.
- **ClassDojo**: teachers adapt points/rewards to attendance; parent-facing summaries.
- **Khan Academy**: proved the motivational power of visual badge tiers (Meteorite→Earth) and energy points.

### What this means for us
- Keep **two distinct badges** (attendance vs. punctuality) — they measure different behaviors.
- Use **duration tiers** (week → month → quarter → year) so recognition is frequent but meaningful.
- **Positive, not punitive:** badges are *recognition* — no consequences, no shame; public leaderboards only show top performers.
- **Exemptions built in:** sick days, religious observances, and school-recognized activities are recorded as **excused days** and **never break a badge** — the system rewards consistency *around* real life, not punishment for it.
- Respect the Data Privacy Act (school-internal data, configurable leaderboard).

---

## 2. What the app already has (baseline — no new infra needed)

| Asset | Where | How badges reuse it |
| --- | --- | --- |
| **IN/OUT scans** | `attendance_logs` (student_id, entry_type, source, scanned_at TIMESTAMP(3)) | Present-day = ≥1 scan (already the REPORTS_PLAN definition) |
| **LATE / EARLY flags** | `electron/services/bell-times.ts` — computed on the fly from `bell_time_in` / `bell_time_out` / `bell_grace_minutes` (IN after cutoff = LATE, OUT before dismissal = EARLY); SQL via `flagSelectSql` | Punctuality badge = zero flags on **non-excused** days; reuse the same flag logic so badges can never disagree with the Logs screen |
| **Absence detection scheduler** | `electron/services/absence.ts` — daily after dismissal +60 min, "gate used that day" school-day heuristic, backfill ≤3 days | Template for the badge recompute scheduler |
| **School year context** | `school_years` + `enrollments` (per-student per-year section) | Badges are per school year; ranking is per `grade_section` |
| **Active roster** | `students.is_active`, `grade_section` | Only active students are evaluated |
| **Present/school-day definitions** | `REPORTS_PLAN.md` §2: present = ≥1 scan; school day = day with ≥1 gate scan anywhere | Reuse unchanged so badges, absence alerts, and reports never contradict each other |
| **Kiosk scan-result card** | `src/screens/KioskScreen.tsx` | Badge row + "new badge" celebration after a scan |
| **Admin Students page** | `src/screens/admin/Students.tsx` | Badge column + filter |
| **Kiosk idle carousel** | announcements carousel (full-bleed) | Optional "Attendance Stars" leaderboard panel |

*Nothing exists yet for excuse records — this plan adds them as a first-class input to badges (and later to absence-alert suppression, plan 4.5).*

---

## 3. Definitions (decided)

- **School day:** a day with ≥1 gate scan anywhere (existing heuristic, shared with absence 4.2 and REPORTS_PLAN). *Future:* replace with the official calendar when plan 4.4 ships.
- **Present day (student):** ≥1 scan (IN or OUT) on a school day. *(Decision: matches REPORTS_PLAN so badges agree with reports.)*
- **Excused day:** a school day the school has officially excused for that student — **sick, religious observance, or school-recognized activity** (representation, field trips, school events), plus any other approved reason. Excused days are **neutral**: removed from badge evaluation entirely (see §5 `excuses`).
- **Attendance Champion (window):** present every **non-excused** school day in the window. *(Decision — positive, not strict: a sick day or religious activity never breaks the badge.)*
- **Punctuality Champion (window):** Attendance Champion criteria **plus zero LATE and zero EARLY flags on non-excused days** (using the exact `bell-times.ts` logic). Flags on an excused day are ignored.
- **Windows (fixed calendar):** current **week** (Mon–Sun), **month**, **quarter**, and **school year**. *(Decision: duration tiers the user chose; fixed windows are explainable to parents and staff.)*
- **Fairness to new enrollees:** a student's window starts at their **first scan of the school year**, not the calendar start — a mid-year enrollee isn't immediately disqualified. (Derived from `enrollments.created_at` / first scan.)
- **Minimum school-day guard (recommended):** a window only awards a badge if it contains at least a threshold of **non-excused** school days (week ≥3, month ≥8, quarter ≥15, year ≥40) so holiday-heavy weeks don't hand out empty badges. Configurable in Settings.

---

## 4. Badge catalog & ranking (decided)

Two badge families × 4 duration tiers. Codes are stable identifiers (never rename — used in DB + mock):

| Family | Code prefix | Icon | Criteria | Tier → code | Points |
| --- | --- | --- | --- | --- | --- |
| **Attendance Champion** | `ATT` | 🎖 | Present every **non-excused** school day in the window | Week → `ATT_W` 🥉 · Month → `ATT_M` 🥈 · Quarter → `ATT_Q` 🥇 · Year → `ATT_Y` 💎 | 1 / 3 / 6 / 10 |
| **Punctuality Champion** | `PUNCT` | ⏱ | Attendance Champion criteria **+ zero LATE/EARLY flags on non-excused days** | Week → `PUNCT_W` 🥉 · Month → `PUNCT_M` 🥈 · Quarter → `PUNCT_Q` 🥇 · Year → `PUNCT_Y` 💎 | 1 / 3 / 6 / 10 |
| **Most Improved** *(recommended follow-up)* | `IMPR` | 📈 | Attendance rate **improved ≥ 10 points** vs the previous grading period (with a minimum present-day count) — rewards growth over perfection | Quarter → `IMPR_Q` · Year → `IMPR_Y` | 5 / 8 |

- Display names: *"Attendance Champion — Weekly/Monthly/Quarterly/Yearly"*, *"Punctuality Champion — …"*, *"Most Improved — Quarterly/Yearly"*.
- **Excused days count for nothing and against nothing** — a student with 3 excused sick days can still earn the Champion badge; the badge celebrates the days they *were* there.
- **Badge score** = Σ points of earned badges (current school year). Ties broken by higher tier count, then name.
- **Ranking scope:** per **section** (`grade_section`) — the user's choice. (Ranking is derived data; a student's score can be shown anywhere without a leaderboard table.)
- **Leaderboard presentation:** only the **top N (default 5)** per section, framed positively as **"Attendance Stars"**. Never show bottom lists or absence counts publicly (research §1.3–1.4).

---

## 5. Data model

New table `student_badges` (idempotent migration in `db/schema.ts` + `scripts/init-db.mjs`):

```sql
CREATE TABLE IF NOT EXISTS student_badges (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  badge_code VARCHAR(16) NOT NULL,           -- ATT_W / PUNCT_Q / ...
  tier TINYINT UNSIGNED NOT NULL,            -- 1..4 (week..year)
  earned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_badge (student_id, school_year, badge_code),
  KEY idx_badges_year (school_year, badge_code),
  CONSTRAINT fk_badge_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**Excuses** — the exemption source (new, idempotent migration):

```sql
CREATE TABLE IF NOT EXISTS excuses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  excuse_date DATE NOT NULL,
  category ENUM('SICK','RELIGIOUS','SCHOOL_ACTIVITY','OTHER') NOT NULL DEFAULT 'OTHER',
  note VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_excuse_student_date (student_id, excuse_date),
  KEY idx_excuses_date (excuse_date),
  CONSTRAINT fk_excuse_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- One row per (student, date); adding the same date again updates the category + note.
- Recorded by **admin** (Students screen, §7.5); `created_at` is the audit trail (who/when can be extended later via plan 6.6).
- The `excuses` table is *also* the natural future input for suppressing false absence/late SMS alerts (plan 4.5) — no extra schema needed then.

**Authoritative recompute (decided):** stored rows always equal the *currently earned* set, recomputed from the source data — not a one-way award log. This is important because LATE/EARLY are derived on the fly:
- A manual log correction (plan 4.6) or a bell-time setting change should **self-heal** badges (recompute adds restored badges, drops no-longer-earned ones).
- `earned_at` = the first recompute that saw the badge (kept stable across recomputes).
- No separate award-log table in v1 — recompute runs are logged to `userData/logs/app.log`. (Optional later: a `badge_audit` table for "who changed what" ties to plan 6.6.)

---

## 6. Computation & refresh strategy

**Where badges are computed** — one shared evaluator service `electron/services/badges.ts`:

1. **Present/school days per student** — reuse the same aggregation shape as `report.ts` + the "gate used" heuristic from `absence.ts`.
2. **Excused days** — load the student's `excuses` for the window and **remove them from both the requirement and the student's record**: a Champion must be present on every *non-excused* school day; a LATE/EARLY flag on an excused day is ignored.
3. **Flags per scan** — reuse `flagSelectSql` / `flagCutoffs` from `bell-times.ts` so LATE/EARLY match the Logs screen exactly.
4. **Window evaluation** — for each (student, window): present on every non-excused school day (≥ guard) ⇒ **Attendance Champion**; plus no flags on non-excused days ⇒ **Punctuality Champion**.
5. **Most Improved (if enabled)** — attendance rate this grading period vs the previous (both on a non-excused basis); improvement ≥ 10 pts with a minimum present-day count ⇒ badge.

**Refresh triggers:**
| Trigger | Scope | Notes |
| --- | --- | --- |
| **Daily scheduler** | all active students, current year | Run in/after the `absence.ts` cycle (dismissal +60 min); recompute inserts/removes rows |
| **Kiosk scan** | the scanned student only | Cheap indexed query; feeds the scan-result badge row + "NEW BADGE!" moment (compare before/after) |
| **Settings save** | all, current year | When `bell_time_in/out/grace` change, flags change ⇒ recompute |
| **Excuse added / removed (admin)** | affected student | Self-heal via recompute — restoring a mistakenly removed excuse restores the badge automatically |
| **Manual log correction** (4.6, later) | affected student | Self-heal via recompute |

**Offline:** kiosk badge display uses the cached student snapshot (like the offline scan path); award writes during outage are deferred — stored badges are recomputed authoritatively on reconnect anyway, so nothing is lost.

**Mock parity:** browser demo mode (`src/lib/api.ts`) mirrors the evaluator with a `badges` list + demo students pre-seeded with a few badges (so the kiosk/admin UI is testable without MySQL).

---

## 7. UI plan (visibility per user decisions)

### 7.1 Kiosk scan result — ✅ decided
- Under the student name/section on the result card: a **badge row** — icons for currently earned badges (highest tier per family), e.g. `🎖🥈 ⏱🥉`.
- **"🏆 NEW BADGE!"** one-time celebratory card (with the tier icon + name + small confetti) when a scan completes a window; auto-resets with the normal result.
- Guardian day report (when a guardian scans): badges are **out of scope** (user chose not to surface badges in reports).

### 7.2 Admin Students page — ✅ decided
- New **Badges** column: family icons with tier color (bronze/silver/gold/platinum dot or ring), tooltip = badge names + `earned_at` dates.
- **Filter by badge** (e.g., "has Gold attendance"), and a per-student badge detail in the edit modal (earned list + current window progress).

### 7.3 Section leaderboard — ✅ decided
- **Admin:** a "Badges & Ranking" view (new tab, or a card on Overview) — full per-section ranking table: rank, student, section, badge icons, score; filters for section + school year.
- **Kiosk idle carousel (optional, Settings toggle):** an **"Attendance Stars"** panel as one of the carousel slides — top 5 per section by score, positive framing only. Off by default; enabled by the school.

### 7.4 Settings (new keys)
- `leaderboard_kiosk` (bool, default off) — show the Attendance Stars panel on the idle carousel.
- `leaderboard_top_n` (number, default 5).
- Window guard thresholds (week/month/quarter/year school-day minimums, defaults §3).

### 7.5 Excuses management (new — the exemption input)
- In the **Students** screen (edit modal or a per-student "Excused days" panel): add/remove an excused day with a **date picker + category** (Sick / Religious / School Activity / Other) + optional note.
- A small **list of the student's excused days** with remove buttons; dates can be past or upcoming (a planned religious holiday can be pre-recorded).
- Staff-only (never shown on the kiosk or to students).

---

## 8. Privacy & ethics guardrails (research-driven, baked in)

1. **Positive-only recognition** — top-N leaderboards, never bottom lists, never public absence counts (§1.4).
2. **Private by default** — the kiosk shows a student *their own* badges; the leaderboard only appears if the school enables it; badge data is school-internal (PH Data Privacy Act: no third-party disclosure).
3. **No consequences** — badges are recognition, not currency; admin copy should never suggest punishment for not earning one.
4. **"Licensed to miss" mitigation** (§1.3) — because badges are frequent (weekly) and *passive* (no prize), the backfire effect is muted; explicitly avoid "prize for perfect month" framing. The **Most Improved** badge rewards growth, not perfection.
5. **Presenteeism** — exemptions are the answer: a student with a legitimate excuse (sick, religious, school activity) is **never penalized**, so there is no pressure to attend while sick. Excused days are visible to staff only, never public.
6. **Self-healing** — recompute from source data means badge truth always matches Logs, Reports, and absence alerts.

---

## 9. Effort & code touches

| # | Item | Effort | Touches |
| --- | --- | --- | --- |
| 1 | Definitions + SQL aggregation helpers (school days, present days, flag-free days) | M | new `electron/services/badges.ts` (reuses `report.ts` / `bell-times.ts` shapes) |
| 2 | `student_badges` + `excuses` schema + idempotent migrations | S | `electron/db/schema.ts`, `scripts/init-db.mjs` |
| 3 | Badge types + API contract (list, evaluate-on-scan, leaderboard) | M | `shared/types.ts`, `electron/ipc.ts`, `electron/preload.ts`, mock in `src/lib/api.ts` |
| 4 | Daily recompute scheduler hook | S | `electron/main.ts` (or extend `absence.ts` cycle) |
| 5 | Excused-days admin UI (add/remove per student) | M | `src/screens/admin/Students.tsx`, `electron/ipc.ts`, mock in `src/lib/api.ts` |
| 6 | Kiosk scan-result badges + NEW BADGE celebration | M | `src/screens/KioskScreen.tsx`, `src/styles.css` |
| 7 | Admin Students Badges column + filter + detail | M | `src/screens/admin/Students.tsx` |
| 8 | Admin Badges & Ranking view | M | new admin view / `Overview.tsx` |
| 9 | Kiosk Attendance Stars panel + Settings toggles | M | `KioskScreen.tsx`, `Settings.tsx`, `settings.ts`, `shared/types.ts` |
| 10 | Most Improved badge (if approved) | S–M | `badges.ts` + kiosk/admin UI |
| 11 | Validation: typecheck + browser mock + code review | S | `npm run typecheck` |

*Total: roughly a 3–4 day feature for one developer, following the same conventions as the rest of the app (contract → ipc → preload → renderer → mock).*

---

## 10. Implementation phases (build order)

1. **Phase A — Core computation:** §3 definitions, `badges.ts` evaluator (incl. excused-day handling), `student_badges` + `excuses` schema + migrations, contract + mock parity. (Nothing visible yet.)
2. **Phase B — Excuses management (admin):** record/remove excused days per student — the data the lenient rule depends on.
3. **Phase C — Kiosk:** badge row on scan result + NEW BADGE celebration.
4. **Phase D — Admin:** Students badge column/filter + Badges & Ranking view.
5. **Phase E — Leaderboard + Settings:** kiosk Attendance Stars panel + toggles (+ Most Improved badge if approved).
6. **Phase F — Hardening:** recompute on bell-time/settings and excuse changes; offline path; `npm run typecheck` after each step; keep browser mock mode working.

**Out of scope (noted for later):** badges in reports/guardian report (user declined), "Most Improved" badge unless approved, badge revocation audit UI (plan 6.6). **Cross-link with plan 4.5:** the `excuses` table is also the natural input for suppressing false absence/late SMS alerts — adopt that when 4.5 ships (no schema change needed).

---

## 11. Research sources

- Robinson, Gallus, Lee & Rogers (Harvard GSE / AERA) — *How Attendance Awards Backfire*: https://www.gse.harvard.edu/ideas/usable-knowledge/19/03/how-attendance-awards-backfire
- Attendance Works — *Attendance Recognition Guidelines & Policy Recommendations*: https://www.attendanceworks.org
- Education Week — *Should Schools Reward Attendance? What the Experts Say* (2023)
- District policies: Chicago Public Schools (attendance policy 703.1), Northside ISD (elementary awards criteria)
- Attender (attendance gamification, MS partner): badge types, coins, streaks
- Unity ERP gamification: student wallets, Bronze→Platinum leagues
- ClassDojo: points/rewards adapted to attendance; Khan Academy: badge tiers + energy points
- National Privacy Commission — *Republic Act No. 10173 (Data Privacy Act of 2012)*: https://privacy.gov.ph/data-privacy-act/
