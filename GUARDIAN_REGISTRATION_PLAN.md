# TapIn School — Guardian Registration (Plan)

**Status:** ✅ **Implemented (Aug 2026)** — guardians registry, duplicate-name registration flow, searchable student dropdown, and inline registration are live. See `electron/services/guardians.ts`, `src/screens/admin/Guardians.tsx`, `src/components/GuardianForm.tsx`.
**Date:** August 2026
**Purpose:** Register parents/guardians FIRST (name, mobile, address), then link them to students from a searchable dropdown in the Add/Edit Student modal. Registering a name that already exists prompts the admin to confirm whether it is the same guardian before saving a duplicate.

---

## 1. Goals

- **Guardian-first workflow:** guardians are registered as standalone records; students reference them by link.
- **Duplicate protection:** registering "Samuel Jackson" when a Samuel Jackson already exists must NOT silently create a second row — the app asks whether it's the same person.
  - **Same guardian** → just notify "already registered," save nothing (optionally select the existing record for the student form).
  - **Different person, same name** → proceed to save with the new address/mobile (distinct QR payload, so the two never collide).
- **Student form redesign:** remove Parent Mobile, Guardian's Name, and Guardian's Address free-text fields; replace Guardian's Name with a **searchable guardian dropdown** (filter by name/mobile/address) + inline "Register new guardian…".
- **Zero ripple-through:** guardian data stays denormalized onto students, so SMS alerts, kiosk guardian-QR day reports, reports, and the offline cache keep working without JOINs.

## 2. Decisions (confirmed with the owner)

| Topic | Decision |
| --- | --- |
| UI placement | **Guardians tab in the admin sidebar + inline registration** inside the Add/Edit Student modal |
| CSV import | **Auto-register guardians** — CSV rows that name a guardian find-or-create a guardian record (matched by name + address) and link the student; no per-row prompt during bulk import |
| Guardian delete | **Unlink students** — students keep their saved snapshot (name/phone/address/QR) but the dropdown entry is gone |

## 3. Data model

### 3.1 New `guardians` table (mirrors `visitors`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INT UNSIGNED PK | |
| `full_name` | VARCHAR(120) | required |
| `mobile` | VARCHAR(20) | SMS contact — copied onto linked students' `parent_phone` |
| `address` | VARCHAR(255) | part of the guardian identity (name + address) |
| `qr_hash_payload` | VARCHAR(64), UNIQUE | `generateGuardianPayload(name, address)` → same identity = same QR |
| `is_active` | TINYINT(1) | informational registry flag (does not gate kiosk scans) |
| `created_at` / `updated_at` | TIMESTAMP | |

### 3.2 `students.guardian_id` (nullable FK → `ON DELETE SET NULL`)

- Added via the existing idempotent `information_schema` migration pattern (works for fresh installs and upgrades alike).
- The legacy snapshot columns (`parent_phone`, `guardian_name`, `guardian_address`, `guardian_qr_hash_payload`) are **kept as denormalized copies** of the linked guardian — every existing consumer (SMS pipeline, absence alerts, kiosk guardian-QR scan, reports, offline cache) reads those columns and needs no changes.

### 3.3 One-time backfill

- Registers one guardian row per existing distinct `(guardian_name, guardian_address)` identity, **reusing the already-stored guardian QR payload** so printed guardian QRs stay valid on upgrade.
- Links each student to their guardian row (guarded by `guardian_id IS NULL` → idempotent on re-runs).

## 4. Duplicate-name flow (registration)

```
Register Guardian (name, mobile, address)
        │
        ▼
 name exists? ──no──▶ INSERT (QR from name + address)
        │
       yes
        ▼
 Return { outcome: 'duplicate', existing }
        │
        ▼
 UI: "Samuel Jackson is already in the database"
     Mobile: 0917… · Address: …
     "Is this the same guardian you are registering?"
        │
        ├── Yes, same guardian ──▶ notify "already registered" — nothing saved
        │                           (student form: select the existing record)
        │
        └── No, different person ──▶ save anyway (allowSameName)
                                      new address/mobile → distinct QR payload
```

- **True duplicates** (same name + same address) produce the same QR payload → the unique key rejects them and the existing row is returned as the duplicate.
- **Same-named, different-address guardians** are legitimate distinct records with distinct QRs.
- **Editing:** the duplicate check only fires when the name actually changes, so editing a same-named guardian's mobile/address alone never re-prompts.
- **CSV import:** `findOrCreateGuardian` matches by exact name + address silently (no prompt during bulk import).

## 5. API surface

New IPC channels (`tapin:` prefix) — all mirrored in `shared/types.ts` (TapinApi), `electron/preload.ts`, and the browser mock `src/lib/api.ts`:

| Method | Behavior |
| --- | --- |
| `listGuardians(search?)` | All guardians, sorted by name, optionally filtered by name/mobile/address |
| `findGuardiansByName(name)` | Case-insensitive exact-name lookup (powers the duplicate prompt) |
| `createGuardian(input, opts?)` | `{ outcome: 'created', guardian }` or `{ outcome: 'duplicate', existing }`; `allowSameName: true` saves a same-named record anyway |
| `updateGuardian(id, patch, opts?)` | Updates name/mobile/address/is_active; re-issues the QR on identity change; **re-syncs the snapshot onto every linked student** + refreshes the offline cache |
| `deleteGuardian(id)` | Unlinks students (`guardian_id = NULL`, snapshot stays), then deletes the row |

`Student` / `StudentInput` gain `guardian_id`. `createStudent` / `updateStudent` derive the snapshot from `guardian_id` when present (legacy free-text fields still work for CSV import and older clients; `guardian_id: null` on edit clears the link, SMS number, and guardian QR).

## 6. UI

### 6.1 Guardians tab (new sidebar entry `👪 Guardians`)

- `src/screens/admin/Guardians.tsx` + registration in `src/screens/admin/AdminDashboard.tsx`.
- Search, table (name, mobile, address, linked-student count, QR payload), Add/Edit via the shared `GuardianForm` (duplicate-name flow), Delete with an unlink confirmation.

### 6.2 Shared `GuardianForm` component (`src/components/GuardianForm.tsx`)

- Fields: Guardian Name (required), Mobile, Address.
- Submits → if the backend returns `duplicate`, swaps the form for the confirmation panel showing the existing record's details and the question; "Yes, same guardian" hands the existing record back (`outcome: 'exists'`), "No, different person — save anyway" retries with `allowSameName`.

### 6.3 Add/Edit Student form (`src/screens/admin/Students.tsx`)

- **Removed:** Parent Mobile (SMS), Guardian's Name, Guardian's Address.
- **Added:** searchable guardian dropdown (`GuardianPicker`) — type to filter registered guardians by name/mobile/address; click to select; ✕ to clear; "＋ Register new guardian…" opens the inline `GuardianForm` (which runs the duplicate check).
- Guardian stays optional: no guardian = no SMS alerts and no guardian QR (same as today's blank state).
- Edit mode pre-selects the student's current guardian.

## 7. Files touched

- `electron/db/schema.ts` — `guardians` table + `students.guardian_id` migration + backfill
- `electron/services/guardians.ts` — **new** service (CRUD, duplicate flow, snapshot sync)
- `electron/ipc.ts` — guardian handlers; `createStudent` / `updateStudent` / `importCsv` guardian_id support
- `electron/preload.ts` — expose the 5 guardian methods
- `shared/types.ts` — `Guardian`, `GuardianInput`, `GuardianWriteResult`, `Student.guardian_id`, TapinApi additions
- `src/lib/api.ts` — browser mock mirrors everything (incl. demo guardians + CSV auto-registration)
- `src/components/GuardianForm.tsx` — **new** shared form with duplicate-name confirmation
- `src/screens/admin/Guardians.tsx` — **new** registry page
- `src/screens/admin/AdminDashboard.tsx` — sidebar entry
- `src/screens/admin/Students.tsx` — form redesign (`GuardianPicker`)
- `src/styles.css` — picker + duplicate-panel styles

## 8. Out of scope / future

- Multiple guardians per student (primary + secondary contacts — main plan 5.1).
- Parent/guardian portal login (main plan 7.2).
- Guarding kiosk scans by `guardians.is_active` (currently informational only).
- Guardian QR printing directly from the Guardians tab (available via the student QR modal today).
- Mobile-number uniqueness rules (duplicates allowed; the name prompt is the dedupe trigger).
