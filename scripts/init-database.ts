import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { z } from 'zod'
import { migrateAdvisorV2 } from './migrate-advisor-v2.js'
import { migrateDataAudit } from './migrate-data-audit.js'
import { migrateFamilyCompanion } from './migrate-family-companion.js'

const initConfig = z.object({
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().regex(/^[a-zA-Z0-9_]+$/).default('zhixiang'),
  DB_USER: z.string().regex(/^[a-zA-Z0-9_]+$/).default('zhixiang_app'),
  DB_PASSWORD: z.string().min(8),
  ROOT_DB_USER: z.string().default('root'),
  ROOT_DB_PASSWORD: z.string().min(1),
}).parse(process.env)

const connection = await mysql.createConnection({
  host: initConfig.DB_HOST,
  port: initConfig.DB_PORT,
  user: initConfig.ROOT_DB_USER,
  password: initConfig.ROOT_DB_PASSWORD,
  multipleStatements: true,
})

try {
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
  await connection.query(schema)
  const employmentSeed = await readFile(new URL('../database/employment-seed.sql', import.meta.url), 'utf8')
  await connection.query(employmentSeed)
  await migrateAdvisorV2(connection,initConfig.DB_NAME)
  await migrateDataAudit(connection,initConfig.DB_NAME)
  await migrateFamilyCompanion(connection,initConfig.DB_NAME)
  try {
    await connection.query('ALTER TABLE zhixiang.admission_programs ADD COLUMN min_score SMALLINT UNSIGNED NULL AFTER major_code')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ER_DUP_FIELDNAME')) throw error
  }
  for (const migration of [
    'ALTER TABLE zhixiang.schools ADD COLUMN admissions_url VARCHAR(500) NULL AFTER official_url',
    'ALTER TABLE zhixiang.schools ADD COLUMN links_verified_at DATETIME NULL AFTER admissions_url',
    'ALTER TABLE zhixiang.schools ADD COLUMN links_source_url VARCHAR(1000) NULL AFTER links_verified_at',
    "ALTER TABLE zhixiang.job_sources ADD COLUMN collection_policy VARCHAR(1000) NOT NULL DEFAULT '待补充来源采集政策' AFTER access_policy_url",
    "ALTER TABLE zhixiang.student_profiles ADD COLUMN planning_mode ENUM('exploration', 'application') NOT NULL DEFAULT 'application' AFTER current_stage",
    "ALTER TABLE zhixiang.student_profiles ADD COLUMN selected_subjects JSON NULL AFTER subject_group",
    "ALTER TABLE zhixiang.admission_programs ADD COLUMN unit_type ENUM('exact_major', 'major_group', 'school_line') NOT NULL DEFAULT 'exact_major' AFTER subject_group",
    "ALTER TABLE zhixiang.admission_programs ADD COLUMN unit_code VARCHAR(32) NULL AFTER major_name",
    "ALTER TABLE zhixiang.admission_programs ADD COLUMN subject_requirement VARCHAR(128) NULL AFTER unit_code",
    "ALTER TABLE zhixiang.school_featured_major_evidence ADD COLUMN major_name VARCHAR(128) NULL AFTER major_id",
    "ALTER TABLE zhixiang.school_featured_major_evidence ADD COLUMN major_code VARCHAR(16) NULL AFTER major_name",
  ]) {
    try { await connection.query(migration) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ER_DUP_FIELDNAME')) throw error }
  }
  await connection.query(`UPDATE zhixiang.school_featured_major_evidence fme JOIN zhixiang.majors m ON m.id=fme.major_id SET fme.major_name=COALESCE(fme.major_name,m.name),fme.major_code=COALESCE(fme.major_code,m.code)`)
  await connection.query('ALTER TABLE zhixiang.school_featured_major_evidence MODIFY major_id BIGINT UNSIGNED NULL, MODIFY major_name VARCHAR(128) NOT NULL, MODIFY recognition_year SMALLINT UNSIGNED NULL')
  try { await connection.query('CREATE UNIQUE INDEX uk_featured_major_name ON zhixiang.school_featured_major_evidence(school_id,major_name,recognition_type,recognition_year)') }
  catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ER_DUP_KEYNAME'))throw error}
  await connection.query(`UPDATE zhixiang.admission_programs ap JOIN zhixiang.provinces p ON p.id=ap.province_id
    SET ap.unit_type=CASE WHEN p.name='河南' AND ap.year=2025 THEN 'major_group' WHEN p.name='河南' AND ap.year<2025 THEN 'school_line' ELSE 'exact_major' END,
    ap.unit_code=COALESCE(ap.unit_code,ap.major_code),
    ap.subject_requirement=CASE WHEN p.name='河南' AND ap.year=2025 THEN COALESCE(ap.subject_requirement,NULLIF(SUBSTRING_INDEX(SUBSTRING_INDEX(ap.major_name,'（',-1),'）',1),ap.major_name)) ELSE ap.subject_requirement END`)
  const [postingColumns] = await connection.query<mysql.RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='zhixiang' AND TABLE_NAME='job_postings' AND COLUMN_NAME='id'")
  if (!postingColumns.length) {
    await connection.query('ALTER TABLE zhixiang.job_postings DROP PRIMARY KEY, ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST, ADD UNIQUE KEY uk_job_source_fingerprint (fingerprint,source_id)')
  }
  const account = `${connection.escape(initConfig.DB_USER)}@'localhost'`
  await connection.query(`CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY ${connection.escape(initConfig.DB_PASSWORD)}`)
  await connection.query(`ALTER USER ${account} IDENTIFIED BY ${connection.escape(initConfig.DB_PASSWORD)}`)
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${initConfig.DB_NAME}\`.* TO ${account}`)
  await connection.query('FLUSH PRIVILEGES')
  console.log('知向本地数据库初始化完成。')
} finally {
  await connection.end()
}
