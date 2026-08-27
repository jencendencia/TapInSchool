# TapIn Teacher Companion — DepEd-Aligned Features Design

## Overview
This document outlines the complete feature set for the TapIn Teacher Companion app,
extending the existing TapInSchool kiosk system with DepEd-aligned school forms,
subject-based attendance, grading system, and ILAW lesson plans with AI assistance.

---

## 1. DepEd School Forms

### SF1 — School Register
- **Already implemented** in Reports tab (school-wide master list)
- Per section: LRN, name, sex, address, guardian, contact

### SF2 — Daily Attendance Report of Learners
- **Already implemented** in Reports tab (gate-attendance matrix)
- **NEW: Subject-based SF2** — per-subject attendance tracking
- Columns: Date | Days of Attendance (M T W TH F) | Marks (P/A/L/E/X)
- AI-powered: auto-mark from gate scans, manual override by teacher

### SF3 — Monthly Learners' Movement and Attendance
- Monthly summary: enrolled, added, dropped, transferred
- Average Daily Attendance (ADA)
- Male/Female breakdown

### SF4 — Consolidated Monthly Report on Learners' Movement and Attendance
- Summarizes SF3 across sections
- School-wide view for principal

### SF5 — Summary of Promoted/Not Promoted Learners
- End-of-year promotion summary
- Per grade level: promoted, retained, transferred out

### SF6 — Register of Learners who Completed/Not Completed
- Completion status per learner
- Reason for non-completion (if applicable)

### SF7 — Summary of Learners' Quarterly Grades
- Per section: grade distribution per quarter
- Pass/fail rates, honor roll candidates

### SF8 — Consolidated Learners' Quarterly Grades (by section)
- Aggregated view for all sections in a grade level

### SF9 — Report Card (Form 138)
- Individual student report card
- Quarterly grades, attendance, conduct
- Parent/guardian signature line
- AI-generated remarks based on performance

### SF10 — Permanent Record (Form 137)
- Complete student academic history
- All grades from enrollment to current
- Transfer credentials

### SF11 — Daily Time Record (for teachers)
- Teacher attendance log
- In/Out times, undertime, overtime

### SF12 — Stock and Inventory Record
- School supplies tracking
- Not core to teacher workflow (low priority)

---

## 2. Subject-Based Attendance (with SF2)

### Database Schema
```
subjects table:
  id, subject_name, subject_code, grade_level, is_active

teacher_subjects table:
  id, teacher_id, subject_id, grade_section, school_year

subject_attendance table:
  id, student_id, subject_id, teacher_subject_id, date,
  status (PRESENT/ABSENT/LATE/EXCUSED/TARDY),
  time_in, time_out, remarks, recorded_by, created_at
```

### Features
- Teachers mark attendance per subject per day
- Gate scans auto-populate (when student is in the system)
- SF2-style matrix view per subject
- Exportable to Excel/PDF
- Monthly summary (SF3) auto-generated

---

## 3. DepEd Grading System

### Grading Components (DepEd Order No. 8, s. 2015)
- **Written Work (WW)**: 30%
- **Performance Tasks (PT)**: 50%
- **Quarterly Assessment (QA)**: 20%

### Transmutation Table
| Raw Score Range | Transmuted Grade |
|-----------------|------------------|
| 98-100          | A+               |
| 95-97           | A                |
| 92-94           | A-               |
| 89-91           | B+               |
| 86-88           | B                |
| 83-85           | B-               |
| 80-82           | C+               |
| 77-79           | C                |
| 74-76           | C-               |
| 71-73           | D+               |
| 68-70           | D                |
| 65-67           | D-               |
| 62-64           | E+               |
| 59-61           | E                |
| Below 59        | E- (Failed)      |

### Database Schema
```
grading_components table:
  id, subject_id, grade_section, school_year, quarter,
  component_type (WW/PT/QA), component_name, max_score, weight_pct, order_idx

grading_scores table:
  id, component_id, student_id, score, recorded_at

class_records table:
  id, subject_id, grade_section, school_year, quarter,
  student_id, ww_score, ww_max, pt_score, pt_max,
  qa_score, qa_max, initial_grade, transmuted_grade,
  final_grade, remarks, created_at, updated_at
```

### Features
- Create grading sheets per subject per quarter
- Add written works, performance tasks, quarterly assessments
- Auto-compute initial grade and transmuted grade
- Generate class records (DepEd format)
- Generate SF7 (grade summary), SF9 (report card)
- AI-generated remarks based on performance

---

## 4. ILAW Lesson Plan (with AI)

### ILAW Format
- **I — Initiating**: Motivation, Review of previous lesson, Preparation
- **L — Leading**: Presentation, Discussion, Explanation of new concepts
- **A — Assisting**: Activity, Application, Group/Individual work, Practice
- **W — Widening**: Evaluation, Generalization, Assignment, Reflection

### Database Schema
```
lesson_plans table:
  id, teacher_id, subject_id, grade_section, school_year,
  date, topic, objectives, ilaw_data (JSON), 
  ai_generated (boolean), status (draft/final),
  created_at, updated_at

lesson_plan_templates table:
  id, name, subject, grade_level, ilaw_data (JSON),
  is_public, created_by
```

### AI Features
- Generate lesson plan from topic + grade level
- Suggest activities based on DepEd MATATAG curriculum
- Auto-fill ILAW sections based on learning objectives
- Generate assessment questions
- Suggest teaching materials and resources

### Manual Features
- Template-based creation
- Copy from previous lesson plans
- Share with colleagues
- Export to PDF/Word format

---

## 5. SQLite Local Database + Sync

### Architecture
- **Primary DB**: MySQL (server/production)
- **Local DB**: SQLite (teacher's device, offline capability)
- **Sync Strategy**: 
  - Pull: Student data, section data, attendance logs
  - Push: Subject attendance, grades, lesson plans
  - Conflict resolution: Latest timestamp wins

### Sync Tables
```
sync_metadata table:
  id, table_name, last_synced_at, sync_direction (PUSH/PULL/BOTH)

local_changes table:
  id, table_name, record_id, operation (INSERT/UPDATE/DELETE),
  data (JSON), created_at, synced (boolean)
```

---

## 6. Modern GUI Design

### Design System
- **Canvas**: Deep Slate (#0F172A) — same as kiosk
- **Surface**: Slate-900 (#1E293B)
- **Accent**: Emerald (#10B981) — primary actions
- **Info**: Blue (#3B82F6) — informational
- **Typography**: System UI (Segoe UI / SF Pro)
- **Components**: Cards, Tables, Forms, Modals, Tabs

### Screen Layouts
1. **Dashboard** — Today's subjects, attendance summary, upcoming lesson plans
2. **My Subjects** — List of assigned subjects with quick actions
3. **Attendance** — Per-subject attendance marking with SF2 view
4. **Gradebook** — Grading sheets, class records, grade computation
5. **Lesson Plans** — ILAW template, AI assistant, plan library
6. **Reports** — DepEd forms (SF1-SF10), export to PDF/Excel
7. **Settings** — Profile, sync status, preferences

### Navigation
- Left sidebar with icons + labels
- Top bar with school name, sync status, user avatar
- Responsive (works on tablet for classroom use)

---

## 7. Implementation Priority

### Phase 1 — Core (Weeks 1-4)
1. ✅ Database schema for subjects, grades, attendance
2. ✅ Subject-based attendance (per-subject SF2)
3. ✅ Basic grading system (WW/PT/QA)
4. ✅ SQLite sync infrastructure

### Phase 2 — Forms (Weeks 5-8)
1. SF2 (subject-based) generation
2. SF7 (grade summary) generation
3. SF9 (report card) generation
4. PDF/Excel export

### Phase 3 — AI (Weeks 9-12)
1. ILAW lesson plan AI generator
2. AI-generated remarks
3. Activity suggestions
4. Assessment question generator

### Phase 4 — Polish (Weeks 13-16)
1. Offline sync
2. Multi-device support
3. Performance optimization
4. User training materials

---

## 8. DepEd Curriculum Alignment

### MATATAG Curriculum (2024+)
- Aligned with Most Essential Learning Competencies (MELCs)
- Spiral progression approach
- Quarter-based grading

### Key Subjects (Elementary)
- Filipino, English, Mathematics, Science
- Araling Panlipunan, MAPEH, TLE, Values Education
- Mother Tongue (Grades 1-3)

### Key Subjects (Secondary)
- Filipino, English, Mathematics, Science
- Araling Panlipunan, MAPEH, TLE, ICT
- Earth and Life Science, Physical Science
- Introduction to Philosophy of the Human Person

---

## 9. Export Formats

### PDF
- DepEd official forms (SF1-SF10)
- Lesson plans (ILAW format)
- Report cards
- Class records

### Excel (.xlsx)
- Grading sheets
- Attendance matrices
- Grade computation worksheets
- SF forms

### Print
- Direct printer support
- QR code on report cards
- Barcode on forms

---

## 10. Integration Points

### Existing TapInSchool
- Student data sync (students table)
- Attendance logs (attendance_logs table)
- Section management (sections table)
- School year (school_years table)
- User accounts (users table, teacher role)

### External Systems
- DepEd LIS (Learner Information System) — future
- DepEd BE-LMS (Basic Education Learning Management System) — future
- School portal — already exists (port 4000)

---

## 11. Security & Privacy

### Data Privacy Act of 2012 (RA 10173)
- Student data encryption at rest
- Access control (teacher → their sections only)
- Audit trail for grade changes
- Parent consent management
- Data retention policies

### Authentication
- PBKDF2 password hashing (existing)
- Session management (existing)
- Role-based access control (existing)
- Teacher scope: only their assigned sections

---

## 12. Testing Strategy

### Unit Tests
- Grade computation (transmutation table)
- Attendance flag logic
- Sync conflict resolution

### Integration Tests
- SF form generation
- Export to PDF/Excel
- SQLite ↔ MySQL sync

### User Acceptance
- Teacher workflow testing
- Principal review of reports
- DepEd form compliance verification

---

## 13. Success Metrics

### Teacher Adoption
- 80% of teachers using weekly within 3 months
- 90% attendance marking accuracy
- 50% reduction in manual form preparation time

### Student Outcomes
- Real-time attendance visibility
- Early intervention for at-risk students
- Improved parent communication

### System Reliability
- 99.9% uptime during school hours
- < 2 second page load
- Successful sync on intermittent connectivity

---

*Document Version: 1.0*
*Date: August 20, 2026*
*Author: TapIn School Development Team*
