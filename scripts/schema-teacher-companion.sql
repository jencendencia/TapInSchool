-- TapIn School — Teacher Companion Schema Migration
-- Adds tables for: Subjects, Subject Attendance, Grading, Class Records, Lesson Plans
-- Run: mysql -u root -p tapin < scripts/schema-teacher-companion.sql

-- ============================================================================
-- 1. SUBJECTS — Master list of subjects taught in the school
-- ============================================================================
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

-- ============================================================================
-- 2. TEACHER_SUBJECTS — Which teacher handles which subject per section/year
-- ============================================================================
CREATE TABLE IF NOT EXISTS teacher_subjects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  grade_section VARCHAR(40) NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_teacher_subject (teacher_id, subject_id, grade_section, school_year),
  KEY idx_ts_subject (subject_id),
  KEY idx_ts_section_year (grade_section, school_year),
  CONSTRAINT fk_ts2_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ts2_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. SUBJECT_ATTENDANCE — Per-subject attendance (teacher marks manually or auto from gate)
-- ============================================================================
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

-- ============================================================================
-- 4. GRADING_COMPONENTS — Individual graded items (written works, PTs, QAs)
-- ============================================================================
CREATE TABLE IF NOT EXISTS grading_components (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_id INT UNSIGNED NOT NULL,
  grade_section VARCHAR(40) NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  quarter TINYINT UNSIGNED NOT NULL COMMENT '1-4',
  component_type ENUM('WW','PT','QA') NOT NULL COMMENT 'Written Work / Performance Task / Quarterly Assessment',
  component_name VARCHAR(120) NOT NULL COMMENT 'e.g. "Written Work 1", "PT Project", "Quarterly Exam"',
  max_score DECIMAL(8,2) NOT NULL DEFAULT 100,
  weight_pct DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'Weight percentage within its component_type',
  order_idx INT UNSIGNED NOT NULL DEFAULT 0,
  date_administered DATE DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_gc_subject (subject_id, grade_section, school_year, quarter),
  CONSTRAINT fk_gc_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 5. GRADING_SCORES — Individual student scores per component
-- ============================================================================
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

-- ============================================================================
-- 6. CLASS_RECORDS — Computed quarterly grades per student per subject
-- ============================================================================
CREATE TABLE IF NOT EXISTS class_records (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_id INT UNSIGNED NOT NULL,
  grade_section VARCHAR(40) NOT NULL,
  school_year VARCHAR(32) NOT NULL,
  quarter TINYINT UNSIGNED NOT NULL COMMENT '1-4',
  student_id INT UNSIGNED NOT NULL,
  ww_score DECIMAL(8,2) DEFAULT NULL COMMENT 'Weighted Written Work score',
  ww_max DECIMAL(8,2) DEFAULT NULL,
  pt_score DECIMAL(8,2) DEFAULT NULL COMMENT 'Weighted Performance Task score',
  pt_max DECIMAL(8,2) DEFAULT NULL,
  qa_score DECIMAL(8,2) DEFAULT NULL COMMENT 'Weighted Quarterly Assessment score',
  qa_max DECIMAL(8,2) DEFAULT NULL,
  raw_score DECIMAL(8,2) DEFAULT NULL COMMENT 'Sum of weighted scores (out of 100)',
  initial_grade DECIMAL(5,2) DEFAULT NULL COMMENT 'Computed from raw score',
  transmuted_grade DECIMAL(5,2) DEFAULT NULL COMMENT 'After applying transmutation table',
  letter_grade VARCHAR(5) DEFAULT NULL COMMENT 'A+, A, A-, B+, ...',
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

-- ============================================================================
-- 7. LESSON_PLANS — ILAW-formatted lesson plans with AI generation support
-- ============================================================================
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
  ilaw_data JSON NOT NULL COMMENT '{"initiating":{"motivation":"","review":"","preparation":""},"leading":{"presentation":"","discussion":"","explanation":""},"assisting":{"activity":"","application":"","practice":""},"widening":{"evaluation":"","generalization":"","assignment":"","reflection":""}}',
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

-- ============================================================================
-- 8. LESSON_PLAN_TEMPLATES — Reusable ILAW templates
-- ============================================================================
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

-- ============================================================================
-- 9. SYNC_METADATA — Tracks local↔server sync state for SQLite offline support
-- ============================================================================
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

-- ============================================================================
-- 10. SEED DATA — Default DepEd subjects for Philippine basic education
-- ============================================================================

-- Elementary (Grades 1-6) — MATATAG Curriculum
INSERT IGNORE INTO subjects (subject_code, subject_name, grade_level) VALUES
  ('FIL', 'Filipino', 'Elementary'),
  ('ENG', 'English', 'Elementary'),
  ('MATH', 'Mathematics', 'Elementary'),
  ('SCI', 'Science', 'Elementary'),
  ('AP', 'Araling Panlipunan', 'Elementary'),
  ('MAPEH', 'MAPEH', 'Elementary'),
  ('TLE', 'Technology and Livelihood Education', 'Elementary'),
  ('VE', 'Values Education', 'Elementary'),
  ('MT', 'Mother Tongue', 'Elementary');

-- Secondary (Grades 7-10) — MATATAG Curriculum
INSERT IGNORE INTO subjects (subject_code, subject_name, grade_level) VALUES
  ('FIL-S', 'Filipino', 'Secondary'),
  ('ENG-S', 'English', 'Secondary'),
  ('MATH-S', 'Mathematics', 'Secondary'),
  ('SCI-S', 'Science', 'Secondary'),
  ('AP-S', 'Araling Panlipunan', 'Secondary'),
  ('MAPEH-S', 'MAPEH', 'Secondary'),
  ('TLE-S', 'Technology and Livelihood Education', 'Secondary'),
  ('ICT', 'Information and Communications Technology', 'Secondary'),
  ('VELS', 'Values Education', 'Secondary'),
  ('ELLS', 'Earth and Life Science', 'Secondary'),
  ('PSCI', 'Physical Science', 'Secondary'),
  ('FIL-SH', 'Filipino', 'Senior High'),
  ('ENG-SH', 'English', 'Senior High'),
  ('MATH-SH', 'Mathematics', 'Senior High'),
  ('SCI-SH', 'Science', 'Senior High'),
  ('STS', 'Science, Technology, and Society', 'Senior High'),
  ('PHILO', 'Introduction to Philosophy of the Human Person', 'Senior High'),
  ('EMPATHY', 'Empowerment Technologies', 'Senior High'),
  ('ORDSC', 'Organization and Management', 'Senior High'),
  ('PRRE', 'Practical Research 1', 'Senior High'),
  ('PRRS', 'Practical Research 2', 'Senior High'),
  ('PRECAL', 'Pre-Calculus', 'Senior High'),
  ('BASICCAL', 'Basic Calculus', 'Senior High'),
  ('GENMATH', 'General Mathematics', 'Senior High'),
  ('COMPDEV', 'Understanding Culture, Society, and Politics', 'Senior High'),
  ('PERSONDEV', 'Personal Development', 'Senior High'),
  ('TLE-SH', 'Technology and Livelihood Education', 'Senior High');

-- ============================================================================
-- DONE
-- ============================================================================
