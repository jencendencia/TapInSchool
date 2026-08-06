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
// IMPORTANT: SCHEMA_SQL must contain NO SQL comments and NO ';' characters
// other than statement terminators. Both ensureSchema() below and
// scripts/init-db.mjs split the string on ';' and execute each chunk, so any
// ';' inside a comment would break the statements (this bit us once with the
// photo_url migration comment). Keep explanations here, in code comments.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS students (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_no VARCHAR(32) NOT NULL,
  qr_hash_payload VARCHAR(64) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  grade_section VARCHAR(40) NOT NULL DEFAULT '',
  parent_phone VARCHAR(20) NOT NULL DEFAULT '',
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
  status ENUM('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
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
  password_hash VARCHAR(255) DEFAULT NULL,
  role ENUM('admin','staff') NOT NULL DEFAULT 'admin',
  pin_hash VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username)
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

INSERT IGNORE INTO school_years (name) VALUES ('2026 - 2027');

INSERT IGNORE INTO enrollments (student_id, school_year, grade_section)
SELECT s.id, COALESCE((SELECT name FROM school_years WHERE is_current = 1 ORDER BY id LIMIT 1), '2026 - 2027'), s.grade_section
FROM students s WHERE s.grade_section <> '';

ALTER TABLE students MODIFY photo_url MEDIUMTEXT DEFAULT NULL;
ALTER TABLE sms_logs MODIFY attendance_id BIGINT UNSIGNED NULL;
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
  if (!names.has('role')) {
    await query("ALTER TABLE users ADD COLUMN role ENUM('admin','staff') NOT NULL DEFAULT 'admin' AFTER username");
  }
  if (!names.has('pin_hash')) {
    await query('ALTER TABLE users ADD COLUMN pin_hash VARCHAR(255) DEFAULT NULL AFTER role');
  }
  // Staff accounts have no password (admin-only dashboard); relax the old
  // NOT NULL constraint on existing installs so they can be created.
  await query('ALTER TABLE users MODIFY password_hash VARCHAR(255) DEFAULT NULL');
}
