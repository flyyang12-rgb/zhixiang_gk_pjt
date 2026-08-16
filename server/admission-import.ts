import { buildAdmissionRecordKey, recommendationEligibility, type AdmissionUnitType, type EducationLevel } from './admission-record-policy.js'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { DatabaseConnection, DatabaseResult, DatabaseRow } from './database.js'

export type AdmissionImportSource = {
  provinceId: number
  province: string
  year: number
  subjectGroup: string
  educationLevel: EducationLevel
  admissionCategory: string
  batch: string
  planType: string
  unitType: AdmissionUnitType
  eligibilityRequirement?: string | null
}

export type RawAdmissionImportRow = {
  schoolName: string
  matchSchoolName?: string
  validationError?: string | null
  educationLevel?: EducationLevel
  admissionCategory?: string
  batch?: string
  planType?: string
  eligibilityRequirement?: string | null
  unitName: string
  unitCode?: string | null
  schoolCode?: string | null
  majorCode?: string | null
  subjectRequirement?: string | null
  minScore?: number | null
  minRank?: number | null
  enrollmentCount?: number | null
}

export type NormalizedAdmissionRecord = AdmissionImportSource & RawAdmissionImportRow & {
  schoolId: number
  recordKey: string
  recommendationEligible: boolean
  recommendationExclusionReason: string | null
}

export type AdmissionPreflightRow = {
  rowNumber: number
  status: 'valid' | 'duplicate' | 'unmatched' | 'rejected'
  reason: string | null
  recordKey: string | null
  record: NormalizedAdmissionRecord | null
}

export function preflightAdmissionRows(input: {
  source: AdmissionImportSource
  schools: Array<{ id: number; name: string }>
  verifiedAliases?: Array<{ alias: string; schoolId: number }>
  rows: RawAdmissionImportRow[]
}) {
  const schoolIds = new Map(input.schools.map(school => [school.name.trim(), school.id]))
  for (const alias of input.verifiedAliases ?? []) schoolIds.set(alias.alias.trim(), alias.schoolId)
  const seen = new Set<string>()
  const rows: AdmissionPreflightRow[] = input.rows.map((raw, index) => {
    const rowNumber = index + 1
    const schoolName = raw.schoolName.trim()
    const matchSchoolName=(raw.matchSchoolName??schoolName).trim()
    const unitName = raw.unitName.trim()
    if(raw.validationError)return {rowNumber,status:'rejected',reason:raw.validationError,recordKey:null,record:null}
    if (!schoolName || !unitName || (!positive(raw.minRank) && !positive(raw.minScore))) {
      return { rowNumber, status: 'rejected', reason: '缺少院校、招生单元或有效分数位次', recordKey: null, record: null }
    }
    const schoolId = schoolIds.get(matchSchoolName)
    if (!schoolId) return { rowNumber, status: 'unmatched', reason: '院校名称未通过正式名称或已核验别名匹配', recordKey: null, record: null }
    const semantics={educationLevel:raw.educationLevel??input.source.educationLevel,admissionCategory:raw.admissionCategory??input.source.admissionCategory,batch:raw.batch??input.source.batch,planType:raw.planType??input.source.planType,eligibilityRequirement:raw.eligibilityRequirement??input.source.eligibilityRequirement??null}
    const eligibility = recommendationEligibility({
      admissionCategory: semantics.admissionCategory,
      batch: semantics.batch,
      planType: semantics.planType,
      minRank: raw.minRank,
    })
    const recordKey = buildAdmissionRecordKey({
      schoolId, provinceId: input.source.provinceId, year: input.source.year, subjectGroup: input.source.subjectGroup,
      educationLevel: semantics.educationLevel, admissionCategory: semantics.admissionCategory, batch: semantics.batch,
      planType: semantics.planType, unitType: input.source.unitType, unitCode: raw.unitCode, rawUnitName: unitName,
    })
    const record: NormalizedAdmissionRecord = {
      ...input.source, ...raw, ...semantics,schoolName, unitName, schoolId, recordKey,
      recommendationEligible: eligibility.eligible,
      recommendationExclusionReason: eligibility.reason,
    }
    if (seen.has(recordKey)) return { rowNumber, status: 'duplicate', reason: '同一源文件内业务键重复', recordKey, record }
    seen.add(recordKey)
    return { rowNumber, status: 'valid', reason: null, recordKey, record }
  })
  const count = (status: AdmissionPreflightRow['status']) => rows.filter(row => row.status === status).length
  const report = { raw: rows.length, valid: count('valid'), duplicate: count('duplicate'), unmatched: count('unmatched'), rejected: count('rejected'), insertable: count('valid') }
  return { rows, report }
}

function positive(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0
}

type ImportConnection = Pick<DatabaseConnection, 'query' | 'execute' | 'beginTransaction' | 'commit' | 'rollback'>

export async function registerSourceArtifact(connection: ImportConnection, input: {
  sourceId:number;officialPageUrl:string;downloadUrl?:string|null;mirrorUrl?:string|null;mirrorDisclosure?:string|null;
  publishedAt?:string|null;bytes:Uint8Array;localPath:string
}) {
  const sha256=createHash('sha256').update(input.bytes).digest('hex')
  const [existing]=await connection.execute<DatabaseRow[]>(`SELECT id FROM source_artifacts WHERE source_id=? AND sha256=? LIMIT 1`,[input.sourceId,sha256])
  if(existing[0])return {id:String(existing[0].id),sha256}
  const id=randomUUID()
  await connection.execute(
    `INSERT INTO source_artifacts(id,source_id,official_page_url,download_url,mirror_url,mirror_disclosure,published_at,sha256,local_path,byte_size) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id,input.sourceId,input.officialPageUrl,input.downloadUrl??null,input.mirrorUrl??null,input.mirrorDisclosure??null,input.publishedAt??null,sha256,input.localPath,input.bytes.byteLength],
  )
  return {id,sha256}
}

export async function persistAdmissionPreflight(connection: ImportConnection, input: {
  sourceId: number
  artifactId?: string | null
  preflight: ReturnType<typeof preflightAdmissionRows>
}) {
  const batchId = randomUUID()
  await connection.execute(
    `INSERT INTO import_batches(id,source_id,artifact_id,status,report) VALUES (?,?,?,'preflight',?)`,
    [batchId, input.sourceId, input.artifactId ?? null, JSON.stringify(input.preflight.report)],
  )
  for (const row of input.preflight.rows) {
    await connection.execute(
      `INSERT INTO admission_import_rows(batch_id,source_row_number,record_key,normalized_record,status,reason) VALUES (?,?,?,?,?,?)`,
      [batchId, row.rowNumber, row.recordKey, row.record ? JSON.stringify(row.record) : null, row.status, row.reason],
    )
  }
  return batchId
}

export async function commitAdmissionPreflight(connection: ImportConnection, batchId: string) {
  await connection.beginTransaction()
  try {
    const [batches] = await connection.execute<DatabaseRow[]>(`SELECT source_id sourceId,status FROM import_batches WHERE id=? FOR UPDATE`, [batchId])
    const batch = batches[0]
    if (!batch) throw new Error('导入预检批次不存在')
    if (String(batch.status) !== 'preflight') throw new Error('只有预检状态的批次可以提交')
    await connection.execute(`UPDATE import_batches SET status='running' WHERE id=?`, [batchId])
    const [rows] = await connection.execute<DatabaseRow[]>(
      `SELECT source_row_number rowNumber,normalized_record normalizedRecord FROM admission_import_rows WHERE batch_id=? AND status='valid' ORDER BY source_row_number`,
      [batchId],
    )
    let inserted = 0
    let updated = 0
    for (const row of rows) {
      const record = parseRecord(row.normalizedRecord)
      const [existingRows] = await connection.execute<DatabaseRow[]>(`SELECT * FROM admission_programs WHERE record_key=? LIMIT 1`, [record.recordKey])
      const existing = existingRows[0]
      if (existing) {
        await connection.execute(
          `INSERT INTO admission_import_changes(batch_id,record_key,operation,admission_program_id,previous_record) VALUES (?,?,'updated',?,?)`,
          [batchId, record.recordKey, Number(existing.id), JSON.stringify(existing)],
        )
        await updateAdmissionRecord(connection, Number(existing.id), record, Number(batch.sourceId))
        await connection.execute(`UPDATE admission_import_rows SET committed_program_id=? WHERE batch_id=? AND source_row_number=?`, [Number(existing.id), batchId, Number(row.rowNumber)])
        updated += 1
      } else {
        const [result] = await insertAdmissionRecord(connection, record, Number(batch.sourceId))
        const programId = result.insertId
        await connection.execute(
          `INSERT INTO admission_import_changes(batch_id,record_key,operation,admission_program_id,previous_record) VALUES (?,?,'inserted',?,NULL)`,
          [batchId, record.recordKey, programId],
        )
        await connection.execute(`UPDATE admission_import_rows SET committed_program_id=? WHERE batch_id=? AND source_row_number=?`, [programId, batchId, Number(row.rowNumber)])
        inserted += 1
      }
    }
    await connection.execute(
      `UPDATE import_batches SET status='completed',inserted_count=?,updated_count=?,completed_at=NOW() WHERE id=?`,
      [inserted, updated, batchId],
    )
    await connection.commit()
    return { batchId, inserted, updated }
  } catch (error) {
    await connection.rollback()
    throw error
  }
}

export async function rollbackAdmissionImport(connection: ImportConnection, batchId: string) {
  await connection.beginTransaction()
  try {
    const [batches] = await connection.execute<DatabaseRow[]>(`SELECT status FROM import_batches WHERE id=? FOR UPDATE`, [batchId])
    if (!batches[0]) throw new Error('导入批次不存在')
    if (String(batches[0].status) !== 'completed') throw new Error('只有已完成批次可以回滚')
    const [changes] = await connection.execute<DatabaseRow[]>(
      `SELECT operation,admission_program_id programId,previous_record previousRecord FROM admission_import_changes WHERE batch_id=? ORDER BY admission_program_id DESC`,
      [batchId],
    )
    for (const change of changes) {
      if (String(change.operation) === 'inserted') await connection.execute(`DELETE FROM admission_programs WHERE id=?`, [Number(change.programId)])
      else await restoreAdmissionRecord(connection, parseJsonObject(change.previousRecord))
    }
    await connection.execute(`UPDATE import_batches SET status='rolled_back' WHERE id=?`, [batchId])
    await connection.commit()
    return { batchId, rolledBack: changes.length }
  } catch (error) {
    await connection.rollback()
    throw error
  }
}

function parseRecord(value: unknown): NormalizedAdmissionRecord {
  const record = parseJsonObject(value)
  return record as NormalizedAdmissionRecord
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  if (value && typeof value === 'object') return value as Record<string, unknown>
  throw new Error('导入记录结构无效')
}

function admissionValues(record: NormalizedAdmissionRecord, sourceId: number) {
  return [
    record.recordKey, record.schoolId, record.provinceId, record.year, record.subjectGroup, record.educationLevel,
    record.admissionCategory, record.batch, record.planType, record.eligibilityRequirement ?? null,
    record.recommendationEligible ? 1 : 0, record.recommendationExclusionReason, record.unitType, record.unitName,
    record.schoolName, record.unitName, record.unitCode ?? null, record.subjectRequirement ?? null, record.schoolCode ?? null,
    record.majorCode ?? null, record.minScore ?? null, record.minRank ?? null, record.enrollmentCount ?? null, sourceId,
  ]
}

function insertAdmissionRecord(connection: ImportConnection, record: NormalizedAdmissionRecord, sourceId: number) {
  return connection.execute<DatabaseResult>(
    `INSERT INTO admission_programs(record_key,school_id,province_id,year,subject_group,education_level,admission_category,batch,plan_type,
     eligibility_requirement,recommendation_eligible,recommendation_exclusion_reason,unit_type,major_name,raw_school_name,raw_unit_name,
     unit_code,subject_requirement,school_code,major_code,min_score,min_rank,enrollment_count,source_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    admissionValues(record, sourceId),
  )
}

function updateAdmissionRecord(connection: ImportConnection, id: number, record: NormalizedAdmissionRecord, sourceId: number) {
  return connection.execute(
    `UPDATE admission_programs SET record_key=?,school_id=?,province_id=?,year=?,subject_group=?,education_level=?,admission_category=?,batch=?,plan_type=?,
     eligibility_requirement=?,recommendation_eligible=?,recommendation_exclusion_reason=?,unit_type=?,major_name=?,raw_school_name=?,raw_unit_name=?,
     unit_code=?,subject_requirement=?,school_code=?,major_code=?,min_score=?,min_rank=?,enrollment_count=?,source_id=? WHERE id=?`,
    [...admissionValues(record, sourceId), id],
  )
}

function restoreAdmissionRecord(connection: ImportConnection, row: Record<string, unknown>) {
  const fields = ['record_key','school_id','province_id','year','subject_group','education_level','admission_category','batch','plan_type','eligibility_requirement','recommendation_eligible','recommendation_exclusion_reason','unit_type','major_name','raw_school_name','raw_unit_name','unit_code','subject_requirement','school_code','major_code','min_score','min_rank','enrollment_count','source_id']
  const values = [...fields.map(field => (row[field] ?? null) as string | number | Buffer | Date | null), row.id as string | number]
  return connection.execute(`UPDATE admission_programs SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=?`, values)
}
