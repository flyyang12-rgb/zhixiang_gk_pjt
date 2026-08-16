import 'dotenv/config'
import mysql from 'mysql2/promise'
import { z } from 'zod'

const config = z.object({
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default('zhixiang'),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  MIGRATION_START_TABLE: z.string().optional(),
}).parse(process.env)

type TableSpec = {
  name: string
  conflict: string[]
  jsonColumns?: string[]
  batchSize?: number
}

const tables: TableSpec[] = [
  { name:'provinces',conflict:['id'] },
  { name:'schools',conflict:['id'],jsonColumns:['features'] },
  { name:'majors',conflict:['id'],jsonColumns:['holland_types','career_tags'] },
  { name:'school_majors',conflict:['school_id','major_id'] },
  { name:'admission_scores',conflict:['id'] },
  { name:'data_sources',conflict:['id'] },
  { name:'admission_programs',conflict:['id'],batchSize:500 },
  { name:'source_artifacts',conflict:['id'] },
  { name:'school_aliases',conflict:['alias'] },
  { name:'school_fact_audits',conflict:['school_id','fact_type'] },
  { name:'admission_scope_audits',conflict:['id'] },
  { name:'school_featured_major_evidence',conflict:['id'] },
  { name:'admission_unit_majors',conflict:['admission_program_id','raw_major_name'] },
  { name:'import_batches',conflict:['id'],jsonColumns:['report'] },
  { name:'admission_import_rows',conflict:['batch_id','source_row_number'],jsonColumns:['normalized_record'] },
  { name:'admission_import_changes',conflict:['batch_id','record_key'],jsonColumns:['previous_record'] },
  { name:'job_directions',conflict:['id'],jsonColumns:['aliases'] },
  { name:'major_job_directions',conflict:['major_id','job_direction_id'] },
  { name:'major_employment_profiles',conflict:['major_id'],jsonColumns:['evidence'] },
  { name:'major_outlook_evidence',conflict:['id'] },
  { name:'job_sources',conflict:['id'] },
  { name:'job_postings',conflict:['id'] },
  { name:'job_daily_stats',conflict:['stat_date','major_id','province'] },
]

const source = mysql.createPool({
  host:config.DB_HOST,
  port:config.DB_PORT,
  database:config.DB_NAME,
  user:config.DB_USER,
  password:config.DB_PASSWORD,
  connectionLimit:2,
  enableKeepAlive:true,
})

async function main() {
  const startIndex=config.MIGRATION_START_TABLE?tables.findIndex(table=>table.name===config.MIGRATION_START_TABLE):0
  if(startIndex<0)throw new Error(`未知的续传起点：${config.MIGRATION_START_TABLE}`)
  for (const table of tables.slice(startIndex)) await migrateTable(table)
  console.log('公共基础数据迁移完成；学生档案、收藏、推荐和顾问聊天未上传。')
}

async function migrateTable(table: TableSpec) {
  const [[countRow]] = await source.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) count FROM \`${table.name}\``)
  const total = Number(countRow?.count ?? 0)
  if (!total) { console.log(`${table.name}: 0，跳过`); return }

  const batchSize = table.batchSize ?? 1000
  let migrated = 0
  while (migrated < total) {
    const [rows] = await source.query<mysql.RowDataPacket[]>(`SELECT * FROM \`${table.name}\` ORDER BY ${table.conflict.map(column=>`\`${column}\``).join(',')} LIMIT ? OFFSET ?`,[batchSize,migrated])
    const normalized = rows.map(row => normalizeRow(row,table.jsonColumns ?? []))
    await upsertBatch(table,normalized)
    migrated += rows.length
    console.log(`${table.name}: ${migrated}/${total}`)
  }
}

function normalizeRow(row: mysql.RowDataPacket, jsonColumns: string[]) {
  const normalized: Record<string, unknown> = { ...row }
  for (const column of jsonColumns) {
    const value = normalized[column]
    if (typeof value === 'string') normalized[column] = JSON.parse(value)
  }
  return normalized
}

async function upsertBatch(table: TableSpec, rows: Record<string, unknown>[]) {
  const url = new URL(`/rest/v1/${table.name}`,config.SUPABASE_URL)
  url.searchParams.set('on_conflict',table.conflict.join(','))
  let lastError: Error | null = null

  for (let attempt=1;attempt<=3;attempt+=1) {
    try {
      const response = await fetch(url,{
        method:'POST',
        signal:AbortSignal.timeout(30_000),
        headers:{
          apikey:config.SUPABASE_PUBLISHABLE_KEY,
          Authorization:`Bearer ${config.SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type':'application/json',
          Prefer:'resolution=merge-duplicates,return=minimal',
        },
        body:JSON.stringify(rows),
      })
      if (response.ok) return
      const detail=(await response.text()).slice(0,500)
      throw new Error(`${table.name} 写入失败（HTTP ${response.status}）：${detail}`)
    } catch (error) {
      lastError=error instanceof Error?error:new Error(String(error))
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1000))
    }
  }
  throw lastError
}

main().catch(error=>{
  console.error(error instanceof Error?error.message:error)
  process.exitCode=1
}).finally(()=>source.end())
