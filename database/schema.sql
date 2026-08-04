CREATE DATABASE IF NOT EXISTS zhixiang
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE zhixiang;

CREATE TABLE IF NOT EXISTS provinces (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE,
  exam_mode VARCHAR(32) NULL,
  max_score SMALLINT UNSIGNED NOT NULL DEFAULT 750
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schools (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  province_id INT UNSIGNED NOT NULL,
  city VARCHAR(64) NOT NULL,
  level ENUM('985', '211', '双一流', '一本', '二本', '本科', '专科') NOT NULL,
  school_type VARCHAR(32) NULL,
  latitude DECIMAL(9, 6) NULL,
  longitude DECIMAL(9, 6) NULL,
  official_url VARCHAR(500) NULL,
  admissions_url VARCHAR(500) NULL,
  links_verified_at DATETIME NULL,
  links_source_url VARCHAR(1000) NULL,
  features JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_school_name_province (name, province_id),
  KEY idx_school_location (province_id, city),
  CONSTRAINT fk_school_province FOREIGN KEY (province_id) REFERENCES provinces(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS majors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(16) NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  holland_types JSON NOT NULL,
  career_tags JSON NOT NULL,
  KEY idx_major_category (category)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_majors (
  school_id BIGINT UNSIGNED NOT NULL,
  major_id BIGINT UNSIGNED NOT NULL,
  discipline_rating VARCHAR(8) NULL,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, major_id),
  CONSTRAINT fk_sm_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_major FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admission_scores (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  province_id INT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  subject_group VARCHAR(64) NOT NULL,
  batch VARCHAR(32) NULL,
  min_score SMALLINT UNSIGNED NULL,
  min_rank INT UNSIGNED NULL,
  enrollment_count INT UNSIGNED NULL,
  UNIQUE KEY uk_admission_record (school_id, province_id, year, subject_group, batch),
  KEY idx_admission_lookup (province_id, year, subject_group, min_rank),
  CONSTRAINT fk_admission_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_admission_province FOREIGN KEY (province_id) REFERENCES provinces(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admission_programs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  record_key CHAR(64) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  province_id INT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  subject_group VARCHAR(64) NOT NULL,
  education_level ENUM('本科', '专科') NOT NULL,
  admission_category VARCHAR(64) NOT NULL DEFAULT '普通类',
  batch VARCHAR(64) NOT NULL,
  plan_type VARCHAR(64) NOT NULL DEFAULT '普通计划',
  eligibility_requirement VARCHAR(500) NULL,
  recommendation_eligible TINYINT(1) NOT NULL DEFAULT 0,
  recommendation_exclusion_reason VARCHAR(255) NULL,
  unit_type ENUM('exact_major', 'major_group', 'school_line') NOT NULL DEFAULT 'exact_major',
  major_name VARCHAR(255) NOT NULL,
  raw_school_name VARCHAR(255) NOT NULL,
  raw_unit_name VARCHAR(500) NOT NULL,
  unit_code VARCHAR(32) NULL,
  subject_requirement VARCHAR(128) NULL,
  school_code VARCHAR(16) NULL,
  major_code VARCHAR(16) NULL,
  min_score SMALLINT UNSIGNED NULL,
  min_rank INT UNSIGNED NULL,
  enrollment_count INT UNSIGNED NULL,
  source_id BIGINT UNSIGNED NULL,
  UNIQUE KEY uk_admission_record_key (record_key),
  KEY idx_program_school_fk (school_id),
  KEY idx_program_lookup (province_id, year, subject_group, education_level, recommendation_eligible, min_rank),
  CONSTRAINT fk_program_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_program_province FOREIGN KEY (province_id) REFERENCES provinces(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_profiles (
  id CHAR(36) PRIMARY KEY,
  student_name VARCHAR(32) NOT NULL,
  province_id INT UNSIGNED NULL,
  subject_group VARCHAR(64) NULL,
  selected_subjects JSON NOT NULL,
  score SMALLINT UNSIGNED NULL,
  province_rank INT UNSIGNED NULL,
  holland_result JSON NULL,
  city_preferences JSON NULL,
  current_stage ENUM('basic_info', 'assessment_entry', 'assessment', 'recommendation') NOT NULL DEFAULT 'basic_info',
  planning_mode ENUM('exploration', 'application') NOT NULL DEFAULT 'application',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profile_province FOREIGN KEY (province_id) REFERENCES provinces(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS profile_score_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  exam_name VARCHAR(64) NOT NULL,
  exam_date DATE NOT NULL,
  score SMALLINT UNSIGNED NULL,
  province_rank INT UNSIGNED NULL,
  note VARCHAR(200) NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  origin_key VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_score_snapshot_origin (origin_key),
  KEY idx_score_snapshot_timeline (profile_id, exam_date, id),
  KEY idx_score_snapshot_current (profile_id, is_current),
  CONSTRAINT fk_score_snapshot_profile FOREIGN KEY (profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS profile_assessments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  perspective ENUM('student', 'parent') NOT NULL,
  answers JSON NOT NULL,
  scores JSON NOT NULL,
  status ENUM('draft', 'completed') NOT NULL DEFAULT 'draft',
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_profile_assessment (profile_id, perspective),
  CONSTRAINT fk_assessment_profile FOREIGN KEY (profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS profile_preferences (
  profile_id CHAR(36) PRIMARY KEY,
  postgraduate_tendency ENUM('employment', 'open', 'planned', 'uncertain') NOT NULL,
  family_conditions JSON NOT NULL,
  student_ranking JSON NOT NULL,
  parent_ranking JSON NOT NULL,
  final_weights JSON NOT NULL,
  status ENUM('draft', 'completed') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_preferences_profile FOREIGN KEY (profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recommendation_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  major_id BIGINT UNSIGNED NULL,
  recommendation_level ENUM('冲', '稳', '保') NOT NULL,
  match_score DECIMAL(5, 2) NOT NULL,
  reason JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_recommendation_profile (profile_id, recommendation_level),
  CONSTRAINT fk_result_profile FOREIGN KEY (profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_result_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_result_major FOREIGN KEY (major_id) REFERENCES majors(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recommendation_snapshots (
  profile_id CHAR(36) PRIMARY KEY,
  result JSON NOT NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_snapshot_profile FOREIGN KEY (profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS advisor_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_advisor_profile (profile_id, created_at),
  CONSTRAINT fk_advisor_profile FOREIGN KEY (profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS advisor_conversations (
  id CHAR(36) PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  focus_type ENUM('general', 'major', 'school') NOT NULL DEFAULT 'general',
  focus_id BIGINT UNSIGNED NULL,
  focus_name VARCHAR(128) NULL,
  title VARCHAR(160) NOT NULL,
  memory_summary TEXT NULL,
  summarized_through_message_id BIGINT UNSIGNED NULL,
  legacy_key VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_advisor_conversation_profile (profile_id, updated_at),
  UNIQUE KEY uk_advisor_conversation_legacy (profile_id, legacy_key),
  CONSTRAINT fk_advisor_conversation_profile FOREIGN KEY (profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS advisor_conversation_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content TEXT NOT NULL,
  client_message_id CHAR(36) NULL,
  reply_to_message_id BIGINT UNSIGNED NULL,
  generation_status ENUM('pending', 'complete', 'failed') NULL,
  legacy_message_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_advisor_conversation_message (conversation_id, id),
  UNIQUE KEY uk_advisor_client_message (conversation_id, client_message_id),
  UNIQUE KEY uk_advisor_legacy_message (legacy_message_id),
  CONSTRAINT fk_advisor_conversation_message FOREIGN KEY (conversation_id) REFERENCES advisor_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS data_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_type ENUM('school_list', 'admission', 'major', 'manual') NOT NULL,
  title VARCHAR(255) NOT NULL,
  source_url VARCHAR(1000) NOT NULL,
  source_year SMALLINT UNSIGNED NOT NULL,
  publisher VARCHAR(128) NOT NULL,
  published_at DATE NULL,
  collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_source_url_year (source_url(500), source_year)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS source_artifacts (
  id CHAR(36) PRIMARY KEY,
  source_id BIGINT UNSIGNED NOT NULL,
  official_page_url VARCHAR(1000) NOT NULL,
  download_url VARCHAR(1000) NULL,
  mirror_url VARCHAR(1000) NULL,
  mirror_disclosure VARCHAR(1000) NULL,
  published_at DATE NULL,
  collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sha256 CHAR(64) NOT NULL,
  local_path VARCHAR(1000) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uk_source_artifact_checksum (source_id, sha256),
  CONSTRAINT fk_source_artifact_source FOREIGN KEY (source_id) REFERENCES data_sources(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_aliases (
  alias VARCHAR(255) PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  verification_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
  verified_at DATETIME NULL,
  note VARCHAR(500) NULL,
  KEY idx_school_alias_target (school_id, verification_status),
  CONSTRAINT fk_school_alias_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_school_alias_source FOREIGN KEY (source_id) REFERENCES data_sources(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_fact_audits (
  school_id BIGINT UNSIGNED NOT NULL,
  fact_type ENUM('official_website', 'admissions_website', 'featured_major', 'admission_coverage') NOT NULL,
  status ENUM('verified', 'unavailable', 'not_applicable', 'pending') NOT NULL DEFAULT 'pending',
  reason VARCHAR(1000) NULL,
  source_url VARCHAR(1000) NULL,
  checked_at DATETIME NULL,
  PRIMARY KEY (school_id, fact_type),
  KEY idx_school_fact_status (fact_type, status),
  CONSTRAINT fk_school_fact_audit_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admission_scope_audits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  province_id INT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  education_level ENUM('本科', '专科') NOT NULL,
  admission_category VARCHAR(64) NOT NULL DEFAULT '*',
  batch VARCHAR(64) NOT NULL DEFAULT '*',
  subject_group VARCHAR(32) NOT NULL DEFAULT '*',
  status ENUM('verified', 'unavailable', 'not_applicable', 'pending') NOT NULL DEFAULT 'pending',
  reason VARCHAR(1000) NULL,
  source_id BIGINT UNSIGNED NULL,
  checked_at DATETIME NULL,
  UNIQUE KEY uk_admission_scope_audit (province_id, year, education_level, admission_category, batch, subject_group),
  KEY idx_admission_scope_status (province_id, year, status),
  CONSTRAINT fk_admission_scope_province FOREIGN KEY (province_id) REFERENCES provinces(id),
  CONSTRAINT fk_admission_scope_source FOREIGN KEY (source_id) REFERENCES data_sources(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_featured_major_evidence (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  major_id BIGINT UNSIGNED NULL,
  major_name VARCHAR(128) NOT NULL,
  major_code VARCHAR(16) NULL,
  education_level ENUM('本科', '高职') NOT NULL DEFAULT '本科',
  recognition_type VARCHAR(128) NOT NULL,
  recognition_year SMALLINT UNSIGNED NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  verified_at DATETIME NOT NULL,
  UNIQUE KEY uk_featured_major_evidence (school_id, major_name, recognition_type, recognition_year),
  KEY idx_featured_major_school (school_id, verified_at),
  CONSTRAINT fk_fme_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  CONSTRAINT fk_fme_major FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE CASCADE,
  CONSTRAINT fk_fme_source FOREIGN KEY (source_id) REFERENCES data_sources(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admission_unit_majors (
  admission_program_id BIGINT UNSIGNED NOT NULL,
  raw_major_name VARCHAR(255) NOT NULL,
  major_id BIGINT UNSIGNED NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  verification_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
  verified_at DATETIME NULL,
  PRIMARY KEY (admission_program_id, raw_major_name),
  KEY idx_aum_major (major_id, verification_status),
  CONSTRAINT fk_aum_program FOREIGN KEY (admission_program_id) REFERENCES admission_programs(id) ON DELETE CASCADE,
  CONSTRAINT fk_aum_major FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE SET NULL,
  CONSTRAINT fk_aum_source FOREIGN KEY (source_id) REFERENCES data_sources(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS import_batches (
  id CHAR(36) PRIMARY KEY,
  source_id BIGINT UNSIGNED NOT NULL,
  artifact_id CHAR(36) NULL,
  status ENUM('preflight', 'running', 'completed', 'failed', 'rolled_back') NOT NULL,
  report JSON NULL,
  inserted_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  CONSTRAINT fk_batch_source FOREIGN KEY (source_id) REFERENCES data_sources(id),
  CONSTRAINT fk_batch_artifact FOREIGN KEY (artifact_id) REFERENCES source_artifacts(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admission_import_rows (
  batch_id CHAR(36) NOT NULL,
  source_row_number INT UNSIGNED NOT NULL,
  record_key CHAR(64) NULL,
  normalized_record JSON NULL,
  status ENUM('valid', 'duplicate', 'unmatched', 'rejected') NOT NULL,
  reason VARCHAR(1000) NULL,
  committed_program_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (batch_id, source_row_number),
  KEY idx_import_row_status (batch_id, status),
  CONSTRAINT fk_import_row_batch FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_import_row_program FOREIGN KEY (committed_program_id) REFERENCES admission_programs(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admission_import_changes (
  batch_id CHAR(36) NOT NULL,
  record_key CHAR(64) NOT NULL,
  operation ENUM('inserted', 'updated') NOT NULL,
  admission_program_id BIGINT UNSIGNED NOT NULL,
  previous_record JSON NULL,
  PRIMARY KEY (batch_id, record_key),
  CONSTRAINT fk_import_change_batch FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_import_change_program FOREIGN KEY (admission_program_id) REFERENCES admission_programs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_directions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  employment_category VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  aliases JSON NOT NULL,
  requires_postgraduate TINYINT(1) NOT NULL DEFAULT 0,
  requires_certificate TINYINT(1) NOT NULL DEFAULT 0,
  reviewed_at DATETIME NULL,
  KEY idx_job_category (employment_category)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS major_job_directions (
  major_id BIGINT UNSIGNED NOT NULL,
  job_direction_id BIGINT UNSIGNED NOT NULL,
  priority TINYINT UNSIGNED NOT NULL,
  direct_entry TINYINT(1) NOT NULL DEFAULT 1,
  review_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  PRIMARY KEY (major_id, job_direction_id),
  UNIQUE KEY uk_major_job_priority (major_id, priority),
  CONSTRAINT fk_mjd_major FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE CASCADE,
  CONSTRAINT fk_mjd_direction FOREIGN KEY (job_direction_id) REFERENCES job_directions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS major_employment_profiles (
  major_id BIGINT UNSIGNED PRIMARY KEY,
  nationwide_coverage_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  direct_entry_ratio DECIMAL(5,2) NOT NULL DEFAULT 0,
  stability_score DECIMAL(5,2) NULL,
  automation_risk_score DECIMAL(5,2) NULL,
  evidence JSON NOT NULL,
  stats_as_of DATE NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mep_major FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS major_outlook_evidence (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  major_id BIGINT UNSIGNED NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  signal_type ENUM('digital_talent', 'industrial_transformation', 'public_service_demand', 'demographic_demand') NOT NULL,
  signal_level ENUM('moderate', 'strong') NOT NULL,
  rationale VARCHAR(1000) NOT NULL,
  reviewed_at DATE NOT NULL,
  valid_until DATE NOT NULL,
  UNIQUE KEY uk_major_outlook_source_signal (major_id, source_id, signal_type),
  KEY idx_major_outlook_validity (major_id, valid_until),
  CONSTRAINT fk_outlook_major FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE CASCADE,
  CONSTRAINT fk_outlook_source FOREIGN KEY (source_id) REFERENCES data_sources(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  source_type ENUM('official', 'public_platform', 'employer') NOT NULL,
  base_url VARCHAR(1000) NOT NULL,
  access_policy_url VARCHAR(1000) NULL,
  collection_policy VARCHAR(1000) NOT NULL,
  status ENUM('healthy', 'degraded', 'paused') NOT NULL DEFAULT 'healthy',
  last_success_at DATETIME NULL,
  last_failure_at DATETIME NULL,
  failure_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_postings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fingerprint CHAR(64) NOT NULL,
  source_id BIGINT UNSIGNED NOT NULL,
  job_direction_id BIGINT UNSIGNED NOT NULL,
  employer VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  province VARCHAR(32) NOT NULL,
  city VARCHAR(64) NOT NULL,
  education VARCHAR(32) NULL,
  published_at DATE NOT NULL,
  source_url VARCHAR(1000) NOT NULL,
  collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATE NOT NULL,
  UNIQUE KEY uk_job_source_fingerprint (fingerprint, source_id),
  KEY idx_job_recent (published_at, job_direction_id, province),
  CONSTRAINT fk_job_source FOREIGN KEY (source_id) REFERENCES job_sources(id),
  CONSTRAINT fk_job_direction FOREIGN KEY (job_direction_id) REFERENCES job_directions(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_daily_stats (
  stat_date DATE NOT NULL,
  major_id BIGINT UNSIGNED NOT NULL,
  province VARCHAR(32) NOT NULL,
  job_count INT UNSIGNED NOT NULL,
  source_count INT UNSIGNED NOT NULL,
  PRIMARY KEY (stat_date, major_id, province),
  CONSTRAINT fk_job_stat_major FOREIGN KEY (major_id) REFERENCES majors(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS profile_saved_items (
  profile_id CHAR(36) NOT NULL,
  item_type ENUM('major', 'school') NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  state ENUM('saved', 'excluded', 'target') NOT NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id, item_type, item_id),
  CONSTRAINT fk_saved_profile FOREIGN KEY (profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO provinces (name, exam_mode, max_score) VALUES
  ('河南', '3+1+2', 750),
  ('山东', '3+3', 750),
  ('河北', '3+1+2', 750)
ON DUPLICATE KEY UPDATE exam_mode = VALUES(exam_mode), max_score = VALUES(max_score);
