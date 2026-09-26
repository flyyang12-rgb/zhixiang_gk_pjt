import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import pg from 'pg'
import { normalizeMigrationValue, orderMigrationTables } from './migration-values.mjs'

// Same-host copy to a NEW, EMPTY PostgreSQL database only. No row contents,
// credentials, statements, or provider error messages are printed.
const publicTables = ['provinces','schools','majors','school_majors','admission_scores','data_sources',
  'admission_programs','source_artifacts','school_aliases','school_fact_audits','admission_scope_audits',
  'school_featured_major_evidence','admission_unit_majors','import_batches','admission_import_rows',
  'admission_import_changes','job_directions','major_job_directions','major_employment_profiles',
  'major_outlook_evidence','job_sources','job_postings','job_daily_stats']
const profileTables = ['student_profiles','profile_score_snapshots','profile_assessments','profile_preferences',
  'profile_saved_items','recommendation_results','recommendation_snapshots','advisor_messages',
  'advisor_conversations','advisor_conversation_messages']
let stage = 'configuration', source, target
try {
  const config = process.env
  const url = new URL(config.MIGRATION_TARGET_URL ?? '')
  if (url.hostname !== 'zhixiang-exploration-db-1' || url.pathname !== '/zhixiang' ||
      config.MIGRATION_SOURCE_HOST !== 'zhixiang-db-1' || config.MIGRATION_SOURCE_DATABASE !== 'zhixiang') throw new Error('wrong_target')
  const names = process.argv.includes('--same-host-profiles') ? [...publicTables, ...profileTables] : publicTables
  target = new pg.Client({connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 10000})
  await target.connect()
  source = await mysql.createConnection({host:config.MIGRATION_SOURCE_HOST, user:config.MIGRATION_SOURCE_USER,
    password:config.MIGRATION_SOURCE_PASSWORD, database:config.MIGRATION_SOURCE_DATABASE,
    supportBigNumbers:true, bigNumberStrings:true, dateStrings:true, timezone:'Z'})
  stage = 'empty_target_check'
  const existing = await target.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
  if (existing.rowCount) throw new Error('target_not_empty')
  await target.query('BEGIN')
  await target.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN")
  const schema = await readFile('database/schema.sql', 'utf8')
  const seedMarker = 'INSERT INTO public.provinces(name, exam_mode, max_score) VALUES'
  if (schema.split(seedMarker).length !== 2) throw new Error('unexpected_schema')
  await target.query(schema.split(seedMarker)[0])
  const dependencyRows = await target.query(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
    FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`)
  const dependencies = new Map()
  for (const row of dependencyRows.rows) {
    const child = row.child.replace(/^public\./, ''), parent = row.parent.replace(/^public\./, '')
    dependencies.set(child, [...(dependencies.get(child) ?? []), parent])
  }
  const tableOrder = orderMigrationTables(names, dependencies)
  await source.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
  await source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
  for (const name of tableOrder) {
    stage = name
    const [{count}] = (await source.query(`SELECT COUNT(*) count FROM \`${name}\``))[0]
    const metadata = await target.query(`SELECT column_name,data_type,column_default,is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [name])
    const [sourceColumns] = await source.query('SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=?', [config.MIGRATION_SOURCE_DATABASE,name])
    const sourceNames = new Set(sourceColumns.map(row => row.COLUMN_NAME ?? row.column_name))
    const columns = metadata.rows.filter(row => sourceNames.has(row.column_name))
    if (metadata.rows.some(row => !sourceNames.has(row.column_name) && row.is_nullable === 'NO' && row.column_default === null)) throw new Error('required_column_missing')
    if (sourceColumns.some(row => !metadata.rows.some(c => c.column_name === (row.COLUMN_NAME ?? row.column_name)))) throw new Error('source_column_unmapped')
    const [primaryKeys] = await source.query(`SELECT column_name FROM information_schema.key_column_usage
      WHERE table_schema=? AND table_name=? AND constraint_name='PRIMARY' ORDER BY ordinal_position`, [config.MIGRATION_SOURCE_DATABASE,name])
    const sortColumns = primaryKeys.map(row => row.COLUMN_NAME ?? row.column_name)
    if (!sortColumns.length) throw new Error('missing_primary_key')
    let copied = 0
    while (copied < Number(count)) {
      const [rows] = await source.query(`SELECT * FROM \`${name}\` ORDER BY ${sortColumns.map(c => `\`${c}\``).join(',')} LIMIT ? OFFSET ?`,[500,copied])
      if (!rows.length) throw new Error('source_count_changed')
      const values = rows.flatMap(row => columns.map(column => normalizeMigrationValue(row[column.column_name],column)))
      const tuples = rows.map((_, index) => `(${columns.map((_, c) => `$${index*columns.length+c+1}`).join(',')})`).join(',')
      await target.query(`INSERT INTO public."${name}" (${columns.map(c => `"${c.column_name}"`).join(',')}) VALUES ${tuples}`, values)
      copied += rows.length
    }
    const check = await target.query(`SELECT COUNT(*)::int count FROM public."${name}"`)
    if (check.rows[0].count !== Number(count)) throw new Error('count_mismatch')
    console.log(JSON.stringify({table:name,sourceCount:Number(count),copied,verified:true}))
  }
  stage = 'identity_sequences'
  const sequences = await target.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND is_identity='YES'`)
  for (const {table_name:name,column_name:column} of sequences.rows) {
    await target.query(`SELECT setval(pg_get_serial_sequence($1,$2),COALESCE((SELECT MAX("${column}") FROM public."${name}"),1),
      EXISTS(SELECT 1 FROM public."${name}"))`, [`public.${name}`,column])
  }
  await target.query('COMMIT')
  await source.query('ROLLBACK')
  console.log(JSON.stringify({status:'passed',sameHost:true,preservedProfiles:process.argv.includes('--same-host-profiles')}))
} catch {
  await target?.query('ROLLBACK').catch(()=>{})
  console.error(JSON.stringify({status:'failed',stage}))
  process.exitCode = 1
} finally {
  await source?.end().catch(()=>{})
  await target?.end().catch(()=>{})
}
