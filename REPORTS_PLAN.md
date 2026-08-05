# TapIn School — Reports: What to Include (Plan)

**Status:** ✅ **Tier 1 implemented (Aug 2026)** — sections 4.1–4.8 live in the Reports tab as selectable report types, each exportable to PDF / Excel / email; see `electron/services/report.ts`, `src/screens/admin/Reports.tsx`.
**Date:** August 2026
**Purpose:** Define what the attendance report (Reports tab, plan-doc item 6.1) should contain, grounded in how comparable QR gate-attendance systems (SmartGate / SmartClass PH) and Philippine DepEd school forms structure their reports. Decides *what* before any code.

---

## 1. Research summary

- **SmartGate / SmartClass PH** (the QR gate-attendance system used by Philippine schools; `smartgate.app` itself is a parked domain — the real product is **SmartClass PH QR Gate Attendance**, smartclassph.com). It advertises: real-time gate monitoring (every learner's entry/exit timestamped), **daily attendance + late tracking** with excused/unexcused statuses, **per-student and monthly reports**, **DepEd-aligned reporting (SF1–SF10)**, parent portal + **SMS notifications**, and **data export/analytics**.
- **Best-practice attendance reports** (PowerSchool, SchoolPass, Edusuite, CampusNexus) add: **attendance rate %**, **tardiness detail** (minutes late + frequency), **absent lists with guardian contacts**, **per-section/per-grade rollups**, monthly and day-of-week **trends**, **chronic-absentee flags** (DepEd uses a 20% threshold — DO No. 8, s. 2015), and a full **SMS audit trail** (timestamp, recipient, trigger, delivery status).
- **DepEd school-form alignment** (why the structure matters to a PH school):
  - **SF2 (Daily Attendance Report of Learners)** — per-student day-by-day register; adviser marks P / A / T. A QR system can *generate the raw matrix* so advisers only review.
  - **SF4 (Monthly Learner's Movement and Attendance)** — monthly cumulative attendance + average daily attendance (ADA).
  - **SF9 (Report Card) / Form 137 (SF10)** — quarterly/yearly present/absent/tardy counts per learner.

### What this means for us
The current report (summary cards + daily totals) is a good *headline* view but stops short of what advisers and the DepEd expect: **per-student detail, section rollups, absentee lists with phone numbers, and trend/audit sections**. Everything below is organized so the highest-value pieces need **no schema changes**.

---

## 2. Definitions (decided)

- **Present day:** the student has **≥ 1 scan** (IN or OUT) that day.
- **Absent day:** an **active** student (`is_active = 1`) with **zero scans** on a school day. *(Decision: computed automatically from gate scans in the report — not dependent on the absence detector having run.)*
- **School day:** a day in the range with **≥ 1 gate scan** anywhere (same "gate used" heuristic as absence detection 4.2), so holidays/quiet weekends don't penalize students.
- **Attendance rate (a day):** distinct present ÷ active students.
- **Attendance rate (a range) / ADA:** Σ(daily present) ÷ (active students × school days).
- **On-time:** IN scan at/before `bell_time_in + bell_grace_minutes`.
- **Late:** IN after the cutoff (existing flag logic, `electron/services/bell-times.ts`).
- **Early departure:** OUT before `bell_time_out` (existing flag logic).
- **Minutes late:** `TIMESTAMPDIFF(MINUTE, cutoff, scanned_at)` on flagged INs.
- **Chronic absentee (at-risk):** attendance rate < **80%** over the range (DepEd 20% guideline; make the threshold configurable later).

---

## 3. Baseline — what the report already has (6.1, implemented)

- Header: school name, date range, generated timestamp.
- Summary cards: total scans, IN, OUT, late, early, absent, students present, SMS sent.
- Daily breakdown table: day / scans / IN / OUT / late / early / absent.
- Exports: PDF (hidden-window print), styled `.xlsx` (exceljs), email (SMTP, PDF attachment).

---

## 4. Tier 1 — high-value additions, **no schema changes** (all computable from existing tables)

### 4.1 Summary page enhancements — ✅ *implemented*
- **Attendance rate %** for the range (definition above) + **average daily attendance (ADA)**.
- **On-time %** (on-time INs ÷ total INs) and **late %** — both shown as cards (Late IN: count + %).
- **School days in range** (gate-used days) and **active student count** — the denominators, shown so the % is auditable.
- **At-risk (chronic) students count** (attendance < 80%).

### 4.2 Per-student summary — ✅ *implemented* (feeds SF9/Form 137)
One row per **active** student:
- Student no, full name, grade/section, parent phone (masked toggle for exports).
- Days present / days late / days absent / attendance %.
- Total IN / total OUT scans, total minutes late.
- SMS alerts sent to that parent (count) + **last status** (SENT / PENDING / FAILED / — column) — ✅ *Aug 2026*.
- Sortable/filterable by section.

### 4.3 Per-section rollup — ✅ *implemented* (adviser overview; feeds SF2/SF4)
One row per `grade_section`:
- Enrolled (active), present, absent, late, early, attendance % per section.
- Highlight sections below the attendance-rate threshold.

### 4.4 Daily register — SF2-style matrix — ✅ *implemented* (≤35 days, landscape PDF)
- Rows = students (optionally filtered to one section), columns = days in range.
- Cell content: IN time / OUT time, or **LATE** / **ABSENT** marker (color-coded).
- Cap width (max ~35 days per matrix) — beyond that, split into monthly pages or switch to per-student rows.
- This is the single most useful output for class advisers.

### 4.5 Absentee list — ✅ *implemented* (actionable — "who to call")
- One row per (student, absent day): student no, name, section, parent phone, date, SMS sent (Y/N).
- Default-sorted by section then date; **totals per student** (student / section / days absent / phone table) — ✅ *Aug 2026*.

### 4.6 Tardiness detail — ✅ *implemented*
- Every flagged IN scan: student, section, date, scan time, cutoff, **minutes late**.
- Per-student **late-frequency** table (students late ≥ N times, filterable 1–5) — ✅ *Aug 2026*.

### 4.7 SMS audit section — ✅ *implemented*
- Per day: sent / pending / failed counts.
- Failure detail: recipient, attempts, provider, error message (top failure reasons).
- Surfaces SMS reliability (ties to plan-doc 5.2/5.3 without schema work).

### 4.8 Trends — ✅ *implemented*
- **Weekly/monthly attendance %** for the range (roll up daily present).
- **Day-of-week pattern** (e.g., Mondays/Fridays dip — common rainy-season pattern).
- **Peak gate hours** (scans by hour — gate congestion, already computed for Overview).

---

## 5. Tier 2 — needs new data (future work; tracked in the main plan)

| Addition | Depends on | Notes |
| --- | --- | --- |
| Excused vs unexcused absences | plan-doc 4.5 (excuse records) | Report shows reason + "excused" flag; suppresses false absentee alerts |
| Correct school-day denominator (calendar) | plan-doc 4.4 (holidays/calendar) | Replaces the gate-used heuristic with the official class-day list |
| Guardian name + email, multiple contacts | plan-doc 5.1 | Richer contact block on absentee list + email recipients |
| Scheduled / auto-emailed reports | plan-doc 6.5 | Weekly summary to principal via the existing SMTP path |
| Per-grade enrollment rosters | optional sections table | Accurate denominators if a school roster exists outside `students` |
| Report history / audit of exports | plan-doc 6.6 | Who exported/sent what, when |

---

## 6. Structure — report types & presentation (Tier 3)

**Report-type selector** in the Reports tab (existing export buttons stay on all types):

1. **Summary** — enhanced headline page (4.1 + current daily table).
2. **Daily register** — SF2 matrix (4.4).
3. **Per-student** — 4.2 table.
4. **Per-section** — 4.3 rollup.
5. **Absentee list** — 4.5.
6. **Tardiness** — 4.6.
7. **SMS audit** — 4.7.
8. **Trends** — 4.8.

**Common controls:** date range (existing), optional **section filter**, optional "mask parent phones" toggle.

**Every type exports to:** PDF (existing `report-html.ts` hidden-window print), styled Excel (existing `report-export.ts` exceljs path), and **email** (existing SMTP `report-email.ts`).

**Print layout notes:** school logo + name banner, report-type title, date range + generated timestamp, page numbering, footer ("Generated by TapIn School").

---

## 7. Implementation notes (when approved)

- **Data:** extend `electron/services/report.ts` — new queries per section (all against existing tables; the only new code is SQL aggregation). Absence/attendance % computed in-report from scans per the definitions above (absence_logs stays as the record of *automated alerts sent*).
- **Contract:** extend `ReportData` in `shared/types.ts` with optional per-type payloads (`perStudent`, `perSection`, `register`, `absentee`, `tardiness`, `smsAudit`, `trends`), or add a `reportType` + typed response. Renderer mock (`src/lib/api.ts`) mirrors it.
- **UI:** `src/screens/admin/Reports.tsx` gains the type selector + section filter; report cards/table components per type.
- **Exports:** `shared/report-html.ts` + `electron/services/report-export.ts` gain builders per type (shared table-rendering helpers to avoid duplication).
- **Validation:** `npm run typecheck` after each step; keep browser mock mode working.
- **Data volume guard:** register matrix and per-student sections are capped (e.g., 400-day range cap already exists; matrix split by month; per-student detail paginated in-app).

---

## 8. Suggested build order

1. **4.1 summary enhancements** (attendance %, ADA, on-time %, at-risk count) — smallest, immediate value.
2. **4.2 per-student + 4.3 per-section** tables + PDF/Excel/email.
3. **4.4 daily register (SF2 matrix)** — the adviser payoff.
4. **4.5 absentee list + 4.6 tardiness detail.**
5. **4.7 SMS audit + 4.8 trends.**
6. Report-type selector + section filter to tie it together (or earlier if preferred).
