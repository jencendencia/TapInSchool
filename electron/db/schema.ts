// Idempotent schema bootstrap. Runs on every startup so the app self-heals
// (tables recreated if missing), and is also used by scripts/init-db.mjs.
//
// The section registry lives in the `sections` table (one row per
// grade_section, with optional adviser name + email). The `advisers` table
// below is a legacy pre-rename table: it is recreated, its rows copied into
// `sections` via INSERT IGNORE (no-op on every run after the first), and then
// dropped, so older installs keep their adviser data on upgrade.
//
// The final INSERT IGNORE auto-registers every grade_section that students are
// currently in, so the registry always covers the students' sections (e.g.
// sections introduced by CSV import). The students table is created earlier in
// SCHEMA_SQL, so this statement always has a valid source.
//
// School years + enrollments: a student's section is recorded per school year
// (enrollments), and students.grade_section is kept as the CURRENT year's
// section (the rest of the app — attendance, SMS, reports — reads it). A
// default school year is seeded so the app always has one; the current flag is
// managed by the listSchoolYears IPC handler (exactly one current).
//
// The final INSERT IGNORE backfills the current year's enrollments from the
// students' existing sections, so installs that predate the enrollments table
// keep their rosters (idempotent — UNIQUE(student_id, school_year) skips rows
// that already exist).
//
// The teacher_sections table maps any password-bearing user (dept_head,
// teacher) to the grade_sections they manage for a school year. It is also
// created by the TapIn Teacher Companion app; the kiosk needs it as well
// because the admin assigns sections to a dept_head on the Users & Roles page.
//
// IMPORTANT: SCHEMA_SQL must contain NO SQL comments and NO ';' characters
// other than statement terminators. Both ensureSchema() below and
// scripts/init-db.mjs split the string on ';' and execute each chunk, so any
// ';' inside a comment would break the statements (this bit us once with the
// photo_url migration comment). Keep explanations here, in code comments.
import { generateGuardianPayload } from '../services/qr';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS students (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_no VARCHAR(32) NOT NULL,
  qr_hash_payload VARCHAR(64) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  gender VARCHAR(10) NOT NULL DEFAULT '',
  grade_section VARCHAR(40) NOT NULL DEFAULT '',
  parent_phone VARCHAR(20) NOT NULL DEFAULT '',
  lrn VARCHAR(20) NOT NULL DEFAULT '',
  guardian_name VARCHAR(120) NOT NULL DEFAULT '',
  guardian_address VARCHAR(255) NOT NULL DEFAULT '',
  guardian_qr_hash_payload VARCHAR(64) DEFAULT NULL,
  photo_url MEDIUMTEXT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_no (student_no),
  UNIQUE KEY uq_qr_payload (qr_hash_payload),
  KEY idx_students_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  entry_type ENUM('IN','OUT') NOT NULL,
  source ENUM('SCANNER','WEBCAM','MANUAL') NOT NULL DEFAULT 'SCANNER',
  scanned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_att_student_date (student_id, scanned_at),
  KEY idx_att_scanned_at (scanned_at),
  CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sms_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attendance_id BIGINT UNSIGNED NULL DEFAULT NULL,
  parent_phone VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('PENDING','IN_PROGRESS','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  provider VARCHAR(20) DEFAULT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP NULL DEFAULT NULL,
  KEY idx_sms_status (status),
  KEY idx_sms_created (created_at),
  CONSTRAINT fk_sms_attendance FOREIGN KEY (attendance_id) REFERENCES attendance_logs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) DEFAULT NULL,
  role ENUM('admin','staff','teacher','dept_head') NOT NULL DEFAULT 'admin',
  pin_hash VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_sections (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT UNSIGNED NOT NULL,
  grade_section VARCHAR(40) NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_teacher_section (teacher_id, grade_section, school_year),
  KEY idx_ts_teacher (teacher_id),
  KEY idx_ts_section_year (grade_section, school_year),
  CONSTRAINT fk_ts_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS absence_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  day DATE NOT NULL,
  status ENUM('ABSENT','LATE') NOT NULL,
  sms_sent TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_absence_student_day (student_id, day),
  KEY idx_absence_day (day),
  CONSTRAINT fk_absence_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advisers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grade_section VARCHAR(40) NOT NULL,
  adviser_name VARCHAR(120) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_advisers_section (grade_section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sections (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grade_section VARCHAR(40) NOT NULL,
  grade VARCHAR(40) NOT NULL DEFAULT '',
  section VARCHAR(40) NOT NULL DEFAULT '',
  adviser_name VARCHAR(120) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sections_section (grade_section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO sections (grade_section, adviser_name, email) SELECT grade_section, adviser_name, email FROM advisers;

DROP TABLE IF EXISTS advisers;

INSERT IGNORE INTO sections (grade_section) SELECT DISTINCT grade_section FROM students WHERE grade_section <> '';

CREATE TABLE IF NOT EXISTS announcements (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL DEFAULT '',
  content_text TEXT NOT NULL,
  media_url VARCHAR(255) DEFAULT NULL,
  media_type ENUM('none','image','video') NOT NULL DEFAULT 'none',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ann_active (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS school_years (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_years_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enrollments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  grade_section VARCHAR(40) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_enroll_student_year (student_id, school_year),
  KEY idx_enroll_year (school_year),
  KEY idx_enroll_year_section (school_year, grade_section),
  CONSTRAINT fk_enroll_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_badges (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  badge_code VARCHAR(16) NOT NULL,
  week_start DATE NOT NULL,
  earned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_badge (student_id, school_year, badge_code, week_start),
  KEY idx_badges_year (school_year),
  CONSTRAINT fk_badge_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

INSERT IGNORE INTO school_years (name) VALUES ('2026 - 2027');

INSERT IGNORE INTO enrollments (student_id, school_year, grade_section)
SELECT s.id, COALESCE((SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1), '2026 - 2027'), s.grade_section
FROM students s WHERE s.grade_section <> '';

ALTER TABLE students MODIFY photo_url MEDIUMTEXT DEFAULT NULL;
ALTER TABLE sms_logs MODIFY attendance_id BIGINT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS visitors (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL DEFAULT '',
  purpose VARCHAR(255) NOT NULL DEFAULT '',
  host_office VARCHAR(120) NOT NULL DEFAULT '',
  id_presented VARCHAR(255) NOT NULL DEFAULT '',
  qr_hash_payload VARCHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_visitor_qr (qr_hash_payload),
  KEY idx_visitors_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guardians (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  mobile VARCHAR(20) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT '',
  qr_hash_payload VARCHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_guardian_qr (qr_hash_payload),
  KEY idx_guardians_name (full_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visitor_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visitor_id INT UNSIGNED NOT NULL,
  entry_type ENUM('IN','OUT') NOT NULL,
  source ENUM('SCANNER','WEBCAM','MANUAL') NOT NULL DEFAULT 'SCANNER',
  scanned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_vlog_visitor_date (visitor_id, scanned_at),
  KEY idx_vlog_scanned_at (scanned_at),
  CONSTRAINT fk_vlog_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subjects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_code VARCHAR(20) NOT NULL,
  subject_name VARCHAR(120) NOT NULL,
  grade_level VARCHAR(20) NOT NULL DEFAULT '',
  description TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subject_code (subject_code),
  KEY idx_subjects_active (is_active),
  KEY idx_subjects_grade (grade_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_subjects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  grade_section VARCHAR(40) NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_teacher_subject (teacher_id, subject_id, grade_section, school_year),
  KEY idx_ts2_subject (subject_id),
  KEY idx_ts2_section_year (grade_section, school_year),
  CONSTRAINT fk_ts2_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ts2_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subject_attendance (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  teacher_subject_id INT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  status ENUM('PRESENT','ABSENT','LATE','EXCUSED','TARDY') NOT NULL DEFAULT 'PRESENT',
  time_in TIME DEFAULT NULL,
  time_out TIME DEFAULT NULL,
  remarks VARCHAR(255) NOT NULL DEFAULT '',
  recorded_by INT UNSIGNED DEFAULT NULL,
  source ENUM('GATE_SCAN','MANUAL','AUTO') NOT NULL DEFAULT 'MANUAL',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subj_att (student_id, subject_id, attendance_date),
  KEY idx_sa_date (attendance_date),
  KEY idx_sa_student (student_id),
  KEY idx_sa_subject_date (subject_id, attendance_date),
  CONSTRAINT fk_sa_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  CONSTRAINT fk_sa_teacher_subject FOREIGN KEY (teacher_subject_id) REFERENCES teacher_subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grading_components (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_id INT UNSIGNED NOT NULL,
  grade_section VARCHAR(40) NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  quarter TINYINT UNSIGNED NOT NULL,
  component_type ENUM('WW','PT','QA') NOT NULL,
  component_name VARCHAR(120) NOT NULL,
  max_score DECIMAL(8,2) NOT NULL DEFAULT 100,
  weight_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  order_idx INT UNSIGNED NOT NULL DEFAULT 0,
  date_administered DATE DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_gc_subject (subject_id, grade_section, school_year, quarter),
  CONSTRAINT fk_gc_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grading_scores (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  component_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  score DECIMAL(8,2) NOT NULL DEFAULT 0,
  recorded_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gs_component_student (component_id, student_id),
  KEY idx_gs_student (student_id),
  CONSTRAINT fk_gs_component FOREIGN KEY (component_id) REFERENCES grading_components(id) ON DELETE CASCADE,
  CONSTRAINT fk_gs_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS class_records (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_id INT UNSIGNED NOT NULL,
  grade_section VARCHAR(40) NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  quarter TINYINT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  ww_score DECIMAL(8,2) DEFAULT NULL,
  ww_max DECIMAL(8,2) DEFAULT NULL,
  pt_score DECIMAL(8,2) DEFAULT NULL,
  pt_max DECIMAL(8,2) DEFAULT NULL,
  qa_score DECIMAL(8,2) DEFAULT NULL,
  qa_max DECIMAL(8,2) DEFAULT NULL,
  raw_score DECIMAL(8,2) DEFAULT NULL,
  initial_grade DECIMAL(5,2) DEFAULT NULL,
  transmuted_grade DECIMAL(5,2) DEFAULT NULL,
  letter_grade VARCHAR(5) DEFAULT NULL,
  remarks VARCHAR(255) NOT NULL DEFAULT '',
  recorded_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cr_record (subject_id, grade_section, school_year, quarter, student_id),
  KEY idx_cr_student (student_id),
  KEY idx_cr_section (grade_section, school_year, quarter),
  CONSTRAINT fk_cr_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  CONSTRAINT fk_cr_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lesson_plans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  grade_section VARCHAR(40) NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  plan_date DATE NOT NULL,
  topic VARCHAR(255) NOT NULL,
  objectives TEXT,
  grade_level VARCHAR(20) NOT NULL DEFAULT '',
  quarter TINYINT UNSIGNED DEFAULT NULL,
  week_no INT UNSIGNED DEFAULT NULL,
  ilaw_data JSON NOT NULL,
  ai_generated TINYINT(1) NOT NULL DEFAULT 0,
  ai_prompt TEXT DEFAULT NULL,
  status ENUM('draft','final','archived') NOT NULL DEFAULT 'draft',
  materials TEXT,
  references_text TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_lp_teacher (teacher_id),
  KEY idx_lp_subject_section (subject_id, grade_section, school_year),
  KEY idx_lp_date (plan_date),
  CONSTRAINT fk_lp_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_lp_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lesson_plan_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  subject_id INT UNSIGNED DEFAULT NULL,
  grade_level VARCHAR(20) NOT NULL DEFAULT '',
  ilaw_data JSON NOT NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT UNSIGNED DEFAULT NULL,
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_lpt_subject (subject_id),
  KEY idx_lpt_public (is_public),
  CONSTRAINT fk_lpt_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_lpt_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_metadata (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(64) NOT NULL,
  record_id INT UNSIGNED NOT NULL,
  operation ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  data JSON DEFAULT NULL,
  synced TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TIMESTAMP NULL DEFAULT NULL,
  KEY idx_sync_table (table_name, synced),
  KEY idx_sync_record (record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO subjects (subject_code, subject_name, grade_level) VALUES ('FIL','Filipino','Elementary'),('ENG','English','Elementary'),('MATH','Mathematics','Elementary'),('SCI','Science','Elementary'),('AP','Araling Panlipunan','Elementary'),('MAPEH','MAPEH','Elementary'),('TLE','Technology and Livelihood Education','Elementary'),('VE','Values Education','Elementary'),('MT','Mother Tongue','Elementary'),('FIL-S','Filipino','Secondary'),('ENG-S','English','Secondary'),('MATH-S','Mathematics','Secondary'),('SCI-S','Science','Secondary'),('AP-S','Araling Panlipunan','Secondary'),('MAPEH-S','MAPEH','Secondary'),('TLE-S','Technology and Livelihood Education','Secondary'),('ICT','Information and Communications Technology','Secondary'),('VELS','Values Education','Secondary'),('ELLS','Earth and Life Science','Secondary'),('PSCI','Physical Science','Secondary'),('FIL-SH','Filipino','Senior High'),('ENG-SH','English','Senior High'),('MATH-SH','Mathematics','Senior High'),('SCI-SH','Science','Senior High'),('STS','Science Technology and Society','Senior High'),('PHILO','Introduction to Philosophy of the Human Person','Senior High'),('EMPATHY','Empowerment Technologies','Senior High'),('ORDSC','Organization and Management','Senior High'),('PRRE','Practical Research 1','Senior High'),('PRRS','Practical Research 2','Senior High'),('PRECAL','Pre-Calculus','Senior High'),('BASICCAL','Basic Calculus','Senior High'),('GENMATH','General Mathematics','Senior High'),('COMPDEV','Understanding Culture Society and Politics','Senior High'),('PERSONDEV','Personal Development','Senior High'),('TLE-SH','Technology and Livelihood Education','Senior High');
`;

export async function ensureSchema(query: (sql: string, params?: unknown[]) => Promise<unknown[]>): Promise<void> {
  for (const stmt of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
    await query(stmt);
  }

  // ---- Idempotent migration: split sections.grade_section into grade + ----
  // section ("Grade 7 - Section A" → grade "Grade 7", section "Section A").
  // MySQL has no ADD COLUMN IF NOT EXISTS, so check information_schema first.
  // This runs only once per install; the backfill below is cheap + idempotent
  // and also fills any row created by a legacy path that skips the columns.
  const cols = (await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sections'`,
  )) as { COLUMN_NAME: string }[];
  if (!cols.some((c) => c.COLUMN_NAME === 'grade')) {
    await query(
      `ALTER TABLE sections
       ADD COLUMN grade VARCHAR(40) NOT NULL DEFAULT '' AFTER grade_section,
       ADD COLUMN section VARCHAR(40) NOT NULL DEFAULT '' AFTER grade`,
    );
  }
  await query(
    `UPDATE sections
     SET grade = CASE WHEN grade_section LIKE '% - %' THEN SUBSTRING_INDEX(grade_section, ' - ', 1) ELSE grade_section END,
         section = CASE WHEN grade_section LIKE '% - %' THEN SUBSTRING_INDEX(grade_section, ' - ', -1) ELSE '' END
     WHERE grade = '' AND grade_section <> ''`,
  );

  // ---- Idempotent migration: users role + kiosk PIN (users page) -----------
  // Older installs created `users` without role/pin_hash. The CREATE TABLE
  // above covers fresh installs; here we add the columns for existing ones.
  // Checking information_schema keeps the ALTER from failing on re-runs.
  const userCols = (await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`,
  )) as { COLUMN_NAME: string }[];
  const names = new Set(userCols.map((c) => c.COLUMN_NAME));
  // Teacher accounts (created in the TapIn Teacher Companion app) carry an
  // optional email that the Sections page copies onto the section for adviser
  // report delivery. Additive column for existing installs.
  if (!names.has('email')) {
    await query("ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT '' AFTER username");
  }
  if (!names.has('role')) {
    await query("ALTER TABLE users ADD COLUMN role ENUM('admin','staff','teacher','dept_head') NOT NULL DEFAULT 'admin' AFTER username");
  } else {
    // Extend the role enum in place for existing installs (older ones only had
    // 'admin','staff'; the companion app may have added 'teacher'). Idempotent.
    const roleType = (await query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    )) as { COLUMN_TYPE: string }[];
    if (!String(roleType[0]?.COLUMN_TYPE ?? '').includes('dept_head')) {
      await query(
        "ALTER TABLE users MODIFY role ENUM('admin','staff','teacher','dept_head') NOT NULL DEFAULT 'admin'",
      );
    }
  }
  if (!names.has('pin_hash')) {
    await query('ALTER TABLE users ADD COLUMN pin_hash VARCHAR(255) DEFAULT NULL AFTER role');
  }
  // Staff accounts have no password (admin-only dashboard); relax the old
  // NOT NULL constraint on existing installs so they can be created.
  await query('ALTER TABLE users MODIFY password_hash VARCHAR(255) DEFAULT NULL');

  // ---- Idempotent migration: student LRN + guardian fields (guardian QR) ---
  // Existing installs created `students` without these columns; the CREATE
  // TABLE above covers fresh installs. information_schema keeps the ALTER
  // from failing on re-runs.
  const studentCols = (await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students'`,
  )) as { COLUMN_NAME: string }[];
  const sNames = new Set(studentCols.map((c) => c.COLUMN_NAME));
  const adds: string[] = [];
  if (!sNames.has('gender')) adds.push("ADD COLUMN gender VARCHAR(10) NOT NULL DEFAULT '' AFTER full_name");
  if (!sNames.has('lrn')) adds.push("ADD COLUMN lrn VARCHAR(20) NOT NULL DEFAULT '' AFTER parent_phone");
  if (!sNames.has('guardian_name')) adds.push("ADD COLUMN guardian_name VARCHAR(120) NOT NULL DEFAULT '' AFTER lrn");
  if (!sNames.has('guardian_address')) adds.push("ADD COLUMN guardian_address VARCHAR(255) NOT NULL DEFAULT '' AFTER guardian_name");
  if (!sNames.has('guardian_qr_hash_payload')) {
    adds.push('ADD COLUMN guardian_qr_hash_payload VARCHAR(64) DEFAULT NULL AFTER guardian_address');
  }
  if (adds.length) await query(`ALTER TABLE students ${adds.join(', ')}`);
  // Guardian QR payloads are now derived from the guardian identity, so
  // multiple children can legitimately share the same payload — drop the old
  // unique key that the first guardian build added (idempotent on re-runs).
  const guardianIdx = (await query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND INDEX_NAME = 'uq_guardian_qr_payload'`,
  )) as { INDEX_NAME: string }[];
  if (guardianIdx.length) await query('ALTER TABLE students DROP INDEX uq_guardian_qr_payload');

  // ---- Idempotent migration: guardians registry + students.guardian_id -----
  // The guardians table is created in SCHEMA_SQL; here we add the nullable
  // FK column to students (fresh installs get it the same way — the CREATE
  // TABLE keeps the legacy columns and this ALTER runs right after). The
  // backfill registers every existing guardian identity from the students'
  // legacy snapshot columns and links each student to their row, so the new
  // registry + dropdown are populated on upgrade.
  const studCols2 = (await query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'students'`,
  )) as { COLUMN_NAME: string }[];
  const sNames2 = new Set(studCols2.map((c) => c.COLUMN_NAME));
  if (!sNames2.has('guardian_id')) {
    await query(
      `ALTER TABLE students
       ADD COLUMN guardian_id INT UNSIGNED DEFAULT NULL AFTER guardian_qr_hash_payload,
       ADD CONSTRAINT fk_student_guardian FOREIGN KEY (guardian_id) REFERENCES guardians(id) ON DELETE SET NULL`,
    );
  } else {
    const fk = (await query(
      `SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'students' AND CONSTRAINT_NAME = 'fk_student_guardian'`,
    )) as { CONSTRAINT_NAME: string }[];
    if (!fk.length) {
      await query(
        'ALTER TABLE students ADD CONSTRAINT fk_student_guardian FOREIGN KEY (guardian_id) REFERENCES guardians(id) ON DELETE SET NULL',
      );
    }
  }
  // Backfill: one guardian row per existing (name + address) identity, reusing
  // the ALREADY-STORED guardian QR payload so printed guardian QRs stay valid,
  // then link every student to their row. Idempotent: INSERT IGNORE skips rows
  // that already exist and the link UPDATE only touches unlinked students.
  // First, any student whose guardian identity was recorded WITHOUT a QR payload
  // (legacy rows / paths that skipped payload generation) gets the payload
  // derived from the identity now — deterministic, so siblings sharing a
  // guardian converge on ONE payload, and the kiosk guardian QR works for them.
  const missingGuardianQr = (await query(
    `SELECT id, guardian_name, guardian_address FROM students
     WHERE guardian_name <> '' AND guardian_qr_hash_payload IS NULL`,
  )) as { id: number; guardian_name: string; guardian_address: string }[];
  for (const row of missingGuardianQr) {
    await query('UPDATE students SET guardian_qr_hash_payload = ? WHERE id = ?', [
      generateGuardianPayload(row.guardian_name, row.guardian_address),
      row.id,
    ]);
  }
  await query(
    `INSERT IGNORE INTO guardians (full_name, mobile, address, qr_hash_payload)
     SELECT s.guardian_name, MAX(s.parent_phone), s.guardian_address, s.guardian_qr_hash_payload
     FROM students s
     WHERE s.guardian_name <> '' AND s.guardian_qr_hash_payload IS NOT NULL
     GROUP BY s.guardian_name, s.guardian_address, s.guardian_qr_hash_payload`,
  );
  await query(
    `UPDATE students s JOIN guardians g ON g.qr_hash_payload = s.guardian_qr_hash_payload
     SET s.guardian_id = g.id
     WHERE s.guardian_id IS NULL AND s.guardian_qr_hash_payload IS NOT NULL`,
  );

  // ---- Idempotent migration: sms_logs.status gains IN_PROGRESS (B2) --------
  // The SMS queue worker now atomically claims PENDING rows as IN_PROGRESS
  // before dispatching (electron/sms/queue-worker.ts), so two machines can't
  // both send the same message. Older installs have the 3-value enum; extend
  // it in place (the CREATE TABLE in SCHEMA_SQL already includes it for fresh
  // installs).
  const smsStatusCols = (await query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_logs' AND COLUMN_NAME = 'status'`,
  )) as { COLUMN_TYPE: string }[];
  if (!String(smsStatusCols[0]?.COLUMN_TYPE ?? '').includes('IN_PROGRESS')) {
    await query("ALTER TABLE sms_logs MODIFY status ENUM('PENDING','IN_PROGRESS','SENT','FAILED') NOT NULL DEFAULT 'PENDING'");
  }
}
