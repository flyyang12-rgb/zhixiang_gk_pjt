import type mysql from 'mysql2/promise'

type MigrationConnection = Pick<mysql.Connection, 'query' | 'execute'>

function ignorableSchemaError(error: unknown) {
  return error instanceof Error && 'code' in error && [
    'ER_DUP_FIELDNAME',
    'ER_DUP_KEYNAME',
    'ER_FK_DUP_NAME',
    'ER_CANT_DROP_FIELD_OR_KEY',
  ].includes(String(error.code))
}

async function executeSchema(connection: MigrationConnection, statements: string[]) {
  for (const statement of statements) {
    try { await connection.query(statement) }
    catch (error) { if (!ignorableSchemaError(error)) throw error }
  }
}

export async function migrateDataAudit(connection: MigrationConnection, databaseName: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error('数据库名称不合法')
  const database = `\`${databaseName}\``

  await executeSchema(connection, [
    `ALTER TABLE ${database}.school_featured_major_evidence ADD COLUMN education_level ENUM('本科','高职') NOT NULL DEFAULT '本科' AFTER major_code`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN record_key CHAR(64) NULL AFTER id`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN education_level ENUM('本科','专科') NOT NULL DEFAULT '本科' AFTER subject_group`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN admission_category VARCHAR(64) NOT NULL DEFAULT '普通类' AFTER education_level`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN batch VARCHAR(64) NOT NULL DEFAULT '普通本科批' AFTER admission_category`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN plan_type VARCHAR(64) NOT NULL DEFAULT '普通计划' AFTER batch`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN eligibility_requirement VARCHAR(500) NULL AFTER plan_type`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN recommendation_eligible TINYINT(1) NOT NULL DEFAULT 0 AFTER eligibility_requirement`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN recommendation_exclusion_reason VARCHAR(255) NULL AFTER recommendation_eligible`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN raw_school_name VARCHAR(255) NULL AFTER major_name`,
    `ALTER TABLE ${database}.admission_programs ADD COLUMN raw_unit_name VARCHAR(500) NULL AFTER raw_school_name`,
    `ALTER TABLE ${database}.admission_programs MODIFY min_rank INT UNSIGNED NULL`,
  ])

  const normalized=(expression:string)=>`REPLACE(REPLACE(REPLACE(TRIM(${expression}),' ',''),'(','（'),')','）')`
  const batchExpression=`CASE WHEN p.name='山东' THEN '常规批第1次' WHEN p.name='河北' THEN '本科批' WHEN p.name='河南' AND ap.year<2025 THEN '本科一批' ELSE '普通本科批' END`
  await connection.query(
    `UPDATE ${database}.admission_programs ap JOIN ${database}.schools s ON s.id=ap.school_id JOIN ${database}.provinces p ON p.id=ap.province_id
     SET ap.education_level='本科',ap.admission_category='普通类',ap.batch=${batchExpression},ap.plan_type='普通计划',
      ap.recommendation_eligible=IF(ap.min_rank IS NOT NULL AND ap.min_rank>0,1,0),
      ap.recommendation_exclusion_reason=IF(ap.min_rank IS NULL OR ap.min_rank=0,'缺少可靠最低位次',NULL),
      ap.raw_school_name=s.name,ap.raw_unit_name=ap.major_name,
      ap.record_key=SHA2(CONCAT(ap.school_id,CHAR(0),ap.province_id,CHAR(0),ap.year,CHAR(0),${normalized('ap.subject_group')},CHAR(0),'本科',CHAR(0),'普通类',CHAR(0),${normalized(batchExpression)},CHAR(0),'普通计划',CHAR(0),ap.unit_type,CHAR(0),${normalized("COALESCE(ap.unit_code,'')")},CHAR(0),${normalized('ap.major_name')}),256)
     WHERE ap.record_key IS NULL OR ap.raw_school_name IS NULL OR ap.raw_unit_name IS NULL`,
  )

  await executeSchema(connection, [
    `CREATE INDEX idx_program_school_fk ON ${database}.admission_programs(school_id)`,
    `ALTER TABLE ${database}.admission_programs DROP INDEX uk_admission_program`,
    `ALTER TABLE ${database}.admission_programs MODIFY record_key CHAR(64) NOT NULL, MODIFY raw_school_name VARCHAR(255) NOT NULL, MODIFY raw_unit_name VARCHAR(500) NOT NULL`,
    `CREATE UNIQUE INDEX uk_admission_record_key ON ${database}.admission_programs(record_key)`,
    `CREATE INDEX idx_program_audited_lookup ON ${database}.admission_programs(province_id,year,subject_group,education_level,recommendation_eligible,min_rank)`,
    `CREATE TABLE IF NOT EXISTS ${database}.source_artifacts (
      id CHAR(36) PRIMARY KEY,source_id BIGINT UNSIGNED NOT NULL,official_page_url VARCHAR(1000) NOT NULL,download_url VARCHAR(1000) NULL,
      mirror_url VARCHAR(1000) NULL,mirror_disclosure VARCHAR(1000) NULL,published_at DATE NULL,collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sha256 CHAR(64) NOT NULL,local_path VARCHAR(1000) NOT NULL,byte_size BIGINT UNSIGNED NOT NULL,
      UNIQUE KEY uk_source_artifact_checksum(source_id,sha256),CONSTRAINT fk_source_artifact_source FOREIGN KEY(source_id) REFERENCES ${database}.data_sources(id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ${database}.school_aliases (
      alias VARCHAR(255) PRIMARY KEY,school_id BIGINT UNSIGNED NOT NULL,source_id BIGINT UNSIGNED NOT NULL,
      verification_status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',verified_at DATETIME NULL,note VARCHAR(500) NULL,
      KEY idx_school_alias_target(school_id,verification_status),CONSTRAINT fk_school_alias_school FOREIGN KEY(school_id) REFERENCES ${database}.schools(id) ON DELETE CASCADE,
      CONSTRAINT fk_school_alias_source FOREIGN KEY(source_id) REFERENCES ${database}.data_sources(id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ${database}.school_fact_audits (
      school_id BIGINT UNSIGNED NOT NULL,fact_type ENUM('official_website','admissions_website','featured_major','admission_coverage') NOT NULL,
      status ENUM('verified','unavailable','not_applicable','pending') NOT NULL DEFAULT 'pending',reason VARCHAR(1000) NULL,source_url VARCHAR(1000) NULL,checked_at DATETIME NULL,
      PRIMARY KEY(school_id,fact_type),KEY idx_school_fact_status(fact_type,status),
      CONSTRAINT fk_school_fact_audit_school FOREIGN KEY(school_id) REFERENCES ${database}.schools(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ${database}.admission_scope_audits (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,province_id INT UNSIGNED NOT NULL,year SMALLINT UNSIGNED NOT NULL,
      education_level ENUM('本科','专科') NOT NULL,admission_category VARCHAR(64) NOT NULL DEFAULT '*',batch VARCHAR(64) NOT NULL DEFAULT '*',
      subject_group VARCHAR(32) NOT NULL DEFAULT '*',status ENUM('verified','unavailable','not_applicable','pending') NOT NULL DEFAULT 'pending',
      reason VARCHAR(1000) NULL,source_id BIGINT UNSIGNED NULL,checked_at DATETIME NULL,
      UNIQUE KEY uk_admission_scope_audit(province_id,year,education_level,admission_category,batch,subject_group),
      KEY idx_admission_scope_status(province_id,year,status),
      CONSTRAINT fk_admission_scope_province FOREIGN KEY(province_id) REFERENCES ${database}.provinces(id),
      CONSTRAINT fk_admission_scope_source FOREIGN KEY(source_id) REFERENCES ${database}.data_sources(id)
    ) ENGINE=InnoDB`,
    `ALTER TABLE ${database}.import_batches ADD COLUMN artifact_id CHAR(36) NULL AFTER source_id`,
    `ALTER TABLE ${database}.import_batches ADD COLUMN report JSON NULL AFTER status`,
    `ALTER TABLE ${database}.import_batches MODIFY status ENUM('preflight','running','completed','failed','rolled_back') NOT NULL`,
    `ALTER TABLE ${database}.import_batches ADD CONSTRAINT fk_batch_artifact FOREIGN KEY(artifact_id) REFERENCES ${database}.source_artifacts(id)`,
    `CREATE TABLE IF NOT EXISTS ${database}.admission_import_rows (
      batch_id CHAR(36) NOT NULL,source_row_number INT UNSIGNED NOT NULL,record_key CHAR(64) NULL,normalized_record JSON NULL,
      status ENUM('valid','duplicate','unmatched','rejected') NOT NULL,reason VARCHAR(1000) NULL,committed_program_id BIGINT UNSIGNED NULL,
      PRIMARY KEY(batch_id,source_row_number),KEY idx_import_row_status(batch_id,status),
      CONSTRAINT fk_import_row_batch FOREIGN KEY(batch_id) REFERENCES ${database}.import_batches(id) ON DELETE CASCADE,
      CONSTRAINT fk_import_row_program FOREIGN KEY(committed_program_id) REFERENCES ${database}.admission_programs(id) ON DELETE SET NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ${database}.admission_import_changes (
      batch_id CHAR(36) NOT NULL,record_key CHAR(64) NOT NULL,operation ENUM('inserted','updated') NOT NULL,
      admission_program_id BIGINT UNSIGNED NOT NULL,previous_record JSON NULL,PRIMARY KEY(batch_id,record_key),
      CONSTRAINT fk_import_change_batch FOREIGN KEY(batch_id) REFERENCES ${database}.import_batches(id) ON DELETE CASCADE,
      CONSTRAINT fk_import_change_program FOREIGN KEY(admission_program_id) REFERENCES ${database}.admission_programs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
  ])

  await connection.query(
    `INSERT IGNORE INTO ${database}.school_fact_audits(school_id,fact_type,status,reason,source_url,checked_at)
     SELECT id,'official_website',IF(official_url IS NOT NULL AND links_source_url IS NOT NULL,'verified','pending'),
      IF(official_url IS NULL,'学校官网尚待核验',NULL),links_source_url,links_verified_at FROM ${database}.schools`,
  )
  await connection.query(
    `INSERT IGNORE INTO ${database}.school_fact_audits(school_id,fact_type,status,reason,source_url,checked_at)
     SELECT id,'admissions_website',IF(admissions_url IS NOT NULL AND links_source_url IS NOT NULL,'verified','pending'),
      IF(admissions_url IS NULL,'招生官网尚待核验',NULL),links_source_url,links_verified_at FROM ${database}.schools`,
  )
  await connection.query(
    `INSERT IGNORE INTO ${database}.school_fact_audits(school_id,fact_type,status,reason,source_url,checked_at)
     SELECT s.id,'featured_major',IF(EXISTS(SELECT 1 FROM ${database}.school_featured_major_evidence f WHERE f.school_id=s.id AND f.verified_at IS NOT NULL),'verified','pending'),
      IF(EXISTS(SELECT 1 FROM ${database}.school_featured_major_evidence f WHERE f.school_id=s.id AND f.verified_at IS NOT NULL),NULL,'官方优势专业证据尚待核验'),NULL,NOW()
     FROM ${database}.schools s`,
  )
  await connection.query(
    `INSERT IGNORE INTO ${database}.school_fact_audits(school_id,fact_type,status,reason,source_url,checked_at)
     SELECT s.id,'admission_coverage',IF(EXISTS(SELECT 1 FROM ${database}.admission_programs ap WHERE ap.school_id=s.id AND ap.year BETWEEN 2023 AND 2025),'verified','pending'),
      IF(EXISTS(SELECT 1 FROM ${database}.admission_programs ap WHERE ap.school_id=s.id AND ap.year BETWEEN 2023 AND 2025),NULL,'三省 2023—2025 招生记录尚待核验'),NULL,NOW()
     FROM ${database}.schools s`,
  )
  await connection.query(
    `INSERT IGNORE INTO ${database}.admission_scope_audits(province_id,year,education_level,status,reason)
     SELECT p.id,y.year,l.education_level,'pending','全批次官方资料尚未逐项审计闭环'
     FROM ${database}.provinces p
     JOIN (SELECT 2023 year UNION ALL SELECT 2024 UNION ALL SELECT 2025) y
     JOIN (SELECT '本科' education_level UNION ALL SELECT '专科') l
     WHERE p.name IN ('河南','山东','河北')`,
  )
}
