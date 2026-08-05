// Idempotent schema bootstrap. Runs on every startup so the app self-heals
// (tables recreated if missing), and is also used by scripts/init-db.mjs.
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
  password_hash VARCHAR(255) NOT NULL,
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

ALTER TABLE students MODIFY photo_url MEDIUMTEXT DEFAULT NULL;
ALTER TABLE sms_logs MODIFY attendance_id BIGINT UNSIGNED NULL;
`;

export async function ensureSchema(query: (sql: string, params?: unknown[]) => Promise<unknown[]>): Promise<void> {
  for (const stmt of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
    await query(stmt);
  }
}
