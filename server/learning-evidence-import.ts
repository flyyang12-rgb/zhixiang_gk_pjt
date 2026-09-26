import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import {
  admissionSubjectConditionSchema, evidenceAvailability, learningCompleteness, learningEvidenceKindSchema,
  learningEvidenceSchema, learningReviewSchema, officialEvidenceUrlSchema, type LearningEvidence,
} from './learning-evidence-contract.js'

const checksum = z.string().regex(/^[a-f0-9]{64}$/)
const text = z.string().trim().min(1)
const timestamp = z.string().datetime({ offset: true })
const year = z.number().int().min(2000).max(2100)
const sourceSchema = z.object({
  key: text.max(100), title: text.max(500), url: officialEvidenceUrlSchema, year,
  publisher: text.max(200), publisherType: z.enum(['education_authority', 'university', 'professional_authority']),
  collectedAt: timestamp, localPath: text.max(500), sha256: checksum,
}).strict()
export const learningImportRecordSchema = z.object({
  factKey: text.max(160), majorCode: text.max(32), kind: learningEvidenceKindSchema,
  content: text.max(2000), sourceKey: text.max(100),
  locator: z.object({ kind: z.enum(['page', 'section', 'anchor']), value: text.max(500) }).strict(),
  scope: z.object({ level: z.enum(['major', 'school']), schoolName: text.max(200).nullable(),
    province: text.max(30).nullable(), subjectGroup: text.max(50).nullable(), admissionYear: year.nullable() }).strict(),
  review: learningReviewSchema, validUntil: timestamp.nullable(), jobDirectionCode: text.max(100).nullable(),
  condition: admissionSubjectConditionSchema.nullable(),
}).strict().superRefine((record, context) => {
  if ((record.scope.level === 'school') !== (record.scope.schoolName !== null)) {
    context.addIssue({ code: 'custom', message: '学校实例必须指定正式学校名' })
  }
})
export const learningImportManifestSchema = z.object({
  version: z.literal(1), batchId: z.string().uuid(), status: z.enum(['staged', 'active']),
  sources: z.array(sourceSchema).min(1).max(200), records: z.array(z.unknown()).min(1).max(5000),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.sources.map(source => source.key)).size !== manifest.sources.length) {
    context.addIssue({ code: 'custom', message: '来源键重复' })
  }
})

export type LearningImportManifest = z.infer<typeof learningImportManifestSchema>
export type LearningImportRecord = z.infer<typeof learningImportRecordSchema>
type Source = z.infer<typeof sourceSchema>
type Row = Record<string, unknown>
// This interface deliberately does not import the app database/config module.
export interface LearningImportConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>
}
export class LearningImportError extends Error {}
type PreparedSource = { source: Source; localPath: string | null; byteSize: number; error: string | null }
export type PreparedLearningImport = {
  manifest: LearningImportManifest; sha256: string; sources: PreparedSource[];
  bytes: Buffer; baseDirectory: string; previousSha256?: string;
}
export type LearningImportRow = {
  rowNumber: number; factKey: string | null; status: 'inserted' | 'updated' | 'skipped' | 'missing' | 'anomalous';
  reason: string | null; record: LearningImportRecord | null; evidence: LearningEvidence | null;
}
export type LearningImportPreflight = {
  batchId: string; payloadSha256: string; mode: 'preflight' | 'committed'; status: 'staged' | 'active';
  report: { total: number; inserted: number; updated: number; skipped: number; missing: number; anomalous: number };
  batchErrors: string[]; sourceErrors: Array<{ sourceKey: string; reason: string }>;
  rows: LearningImportRow[];
  coverage: Array<{ majorId: number; majorCode: string; complete: boolean; curriculum: number; activities: number;
    directions: number; admissionRequirements: number; schoolExamples: number; missing: string[] }>;
}

export function learningPayloadSha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex') }

async function inspectSource(source: Source, baseDirectory: string): Promise<PreparedSource> {
  const failed = (error: string): PreparedSource => ({ source, localPath: null, byteSize: 0, error })
  if (isAbsolute(source.localPath) || source.localPath.includes(':')) return failed('原材料路径必须在输入目录内')
  const path = resolve(baseDirectory, source.localPath)
  const child = relative(resolve(baseDirectory), path)
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return failed('原材料路径必须在输入目录内')
  try {
    const realBase = await realpath(baseDirectory), realFile = await realpath(path)
    const realChild = relative(realBase, realFile)
    if (!realChild || realChild === '..' || realChild.startsWith(`..${sep}`) || isAbsolute(realChild)) return failed('原材料路径必须在输入目录内，不能通过链接跳出目录')
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > 20 * 1024 * 1024) return failed('原材料必须为非空文件且不超过 20MB')
    const bytes = await readFile(path)
    if (bytes.length > 20 * 1024 * 1024 || learningPayloadSha256(bytes) !== source.sha256) return failed('原材料 SHA-256 与登记值不一致')
    return { source, localPath: path, byteSize: bytes.length, error: null }
  } catch { return failed('原材料无法只读访问，请核对文件是否存在及权限') }
}

export async function prepareLearningImport(bytes: Uint8Array, expectedSha256: string, options: { baseDirectory: string; previousSha256?: string }): Promise<PreparedLearningImport> {
  if (!checksum.safeParse(expectedSha256).success || (options.previousSha256 && !checksum.safeParse(options.previousSha256).success)) {
    throw new LearningImportError('输入校验值须为完整的小写 SHA-256')
  }
  if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) throw new LearningImportError('输入文件必须非空且不超过 2MB')
  const sha256 = learningPayloadSha256(bytes)
  if (sha256 !== expectedSha256) throw new LearningImportError('输入文件 SHA-256 与指定值不一致')
  let input: unknown
  try { input = JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '')) } catch { throw new LearningImportError('输入文件不是有效 JSON') }
  const parsed = learningImportManifestSchema.safeParse(input)
  if (!parsed.success) throw new LearningImportError('输入清单结构无效，请核对版本、批次、来源、材料年份及必填字段')
  const sources: PreparedSource[] = []
  // Bound memory even if a manifest references many files near the size limit.
  for (let index = 0; index < parsed.data.sources.length; index += 4) sources.push(...await Promise.all(parsed.data.sources.slice(index, index + 4).map(source => inspectSource(source, options.baseDirectory))))
  return { manifest: parsed.data, sha256, sources, bytes: Buffer.from(bytes), baseDirectory: options.baseDirectory, previousSha256: options.previousSha256 }
}

function numberId(value: unknown): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new LearningImportError('数据库标准身份无效')
  return id
}
function date(value: unknown): string | null { return value == null ? null : (value instanceof Date ? value : new Date(String(value))).toISOString() }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
function comparable(evidence: LearningEvidence) {
  return { majorId: evidence.majorId, kind: evidence.kind, content: evidence.content, locator: evidence.locator,
    scope: evidence.scope, review: { ...evidence.review, reviewedAt: date(evidence.review.reviewedAt) },
    validUntil: date(evidence.validUntil), jobDirectionId: evidence.jobDirectionId, condition: evidence.condition,
    sourceUrl: evidence.source.url, sourceYear: evidence.source.year, sourceTitle: evidence.source.title,
    publisher: evidence.source.publisher, publisherType: evidence.source.publisherType, sha256: evidence.source.sha256 }
}
function existingComparable(row: Row) {
  return { majorId: numberId(row.major_id), kind: row.kind, content: row.content,
    locator: { kind: row.locator_kind, value: row.locator_value },
    scope: { level: row.scope_level, schoolId: row.school_id == null ? null : numberId(row.school_id),
      province: row.province, subjectGroup: row.subject_group, admissionYear: row.admission_year },
    review: { status: row.review_status, reviewer: row.reviewer, reviewedAt: date(row.reviewed_at), conclusion: row.review_conclusion, reason: row.review_reason },
    validUntil: date(row.valid_until), jobDirectionId: row.job_direction_id == null ? null : numberId(row.job_direction_id), condition: row.condition,
    sourceUrl: row.source_url, sourceYear: row.source_year, sourceTitle: row.source_title,
    publisher: row.publisher, publisherType: row.publisher_type, sha256: row.sha256 }
}
const identity = (value: ReturnType<typeof comparable>) => canonical({ majorId: value.majorId, kind: value.kind, scope: value.scope, jobDirectionId: value.jobDirectionId })

export async function preflightLearningImport(connection: LearningImportConnection, prepared: PreparedLearningImport, now = new Date()): Promise<LearningImportPreflight> {
  const { manifest } = prepared
  const parsedRows = manifest.records.map(record => learningImportRecordSchema.safeParse(record))
  const validRecords = parsedRows.flatMap(parsed => parsed.success ? [parsed.data] : [])
  const majors = (await connection.query('SELECT id,code FROM majors WHERE code=ANY($1::text[])', [[...new Set(validRecords.map(record => record.majorCode))]])).rows
  const schools = (await connection.query('SELECT id,name FROM schools WHERE name=ANY($1::text[])', [[...new Set(validRecords.map(record => record.scope.schoolName).filter(Boolean))]])).rows
  const mappings = (await connection.query(`SELECT m.major_id,m.job_direction_id,m.review_status,j.code,j.reviewed_at
    FROM major_job_directions m JOIN job_directions j ON j.id=m.job_direction_id
    WHERE m.major_id=ANY($1::bigint[]) AND j.code=ANY($2::text[])`,
  [majors.map(row => numberId(row.id)), [...new Set(validRecords.map(record => record.jobDirectionCode).filter(Boolean))]])).rows
  const sources = (await connection.query('SELECT id,source_url,source_year,title,publisher FROM data_sources WHERE source_url=ANY($1::text[])', [manifest.sources.map(source => source.url)])).rows
  const existingBatch = (await connection.query('SELECT id,payload_sha256,status FROM learning_content_batches WHERE id=$1', [manifest.batchId])).rows[0]
  const existingRows = (await connection.query(`SELECT e.*,s.source_url,s.source_year,s.title source_title,s.publisher,a.sha256
    FROM major_learning_evidence e JOIN source_artifacts a ON a.id=e.artifact_id JOIN data_sources s ON s.id=a.source_id WHERE e.batch_id=$1`, [manifest.batchId])).rows
  const batchErrors: string[] = []
  if (existingBatch?.status === 'withdrawn') batchErrors.push('撤回的批次不能重新导入或激活')
  if (existingBatch && existingBatch.payload_sha256 !== prepared.sha256) {
    if (existingBatch.status !== 'staged' || prepared.previousSha256 !== existingBatch.payload_sha256) batchErrors.push('只有待发布批次可凭准确原 SHA-256 显式替换输入')
    const keys = new Set(validRecords.map(record => record.factKey))
    if (existingRows.length !== keys.size || existingRows.some(row => !keys.has(String(row.fact_key)))) batchErrors.push('替换待发布批次必须完整保留原事实键，不允许增删事实')
  }
  if (existingBatch && existingBatch.payload_sha256 === prepared.sha256 && existingRows.some(row => !validRecords.some(record => record.factKey === row.fact_key))) batchErrors.push('登记批次含输入之外的事实键，请核验批次一致性')
  if (existingBatch && existingBatch.payload_sha256 === prepared.sha256 && existingBatch.status !== manifest.status && existingBatch.status !== 'withdrawn') {
    batchErrors.push('批次状态与相同输入的登记状态不一致')
  }
  const sourceErrors = prepared.sources.filter(source => source.error).map(source => ({ sourceKey: source.source.key, reason: source.error! }))
  for (const source of manifest.sources) {
    if (manifest.sources.some(other => other.key !== source.key && other.url === source.url && other.year === source.year &&
      (other.title !== source.title || other.publisher !== source.publisher))) sourceErrors.push({ sourceKey: source.key, reason: '输入中同 URL 与年份有不同标题或发布方' })
  }
  const seen = new Set<string>()
  const rows: LearningImportRow[] = parsedRows.map((parsed, index) => {
    const fail = (status: 'missing' | 'anomalous', reason: string, record: LearningImportRecord | null = null): LearningImportRow => ({ rowNumber: index + 1, factKey: record?.factKey ?? null, status, reason, record, evidence: null })
    if (!parsed.success) return fail('anomalous', '事实字段、范围、审核记录或条件结构无效')
    const record = parsed.data
    if (seen.has(record.factKey)) return fail('anomalous', '批次内事实键重复', record)
    seen.add(record.factKey)
    const matchingMajors = majors.filter(major => major.code === record.majorCode)
    if (matchingMajors.length !== 1) return fail('missing', '专业代码不能精确唯一匹配标准专业', record)
    const matchingSchools = record.scope.schoolName === null ? [] : schools.filter(school => school.name === record.scope.schoolName)
    if (record.scope.schoolName !== null && matchingSchools.length !== 1) return fail('missing', '学校名不能精确唯一匹配正式学校', record)
    const majorId = numberId(matchingMajors[0]!.id)
    const mapping = record.jobDirectionCode === null ? null : mappings.find(item => numberId(item.major_id) === majorId && item.code === record.jobDirectionCode)
    if (record.jobDirectionCode !== null && !mapping) return fail('missing', '职业方向须有该标准专业已存在的精确映射', record)
    const material = prepared.sources.find(source => source.source.key === record.sourceKey)
    if (!material) return fail('missing', '事实引用的来源键不存在', record)
    if (material.error) return fail('anomalous', material.error, record)
    const sourceError = sourceErrors.find(error => error.sourceKey === record.sourceKey)
    if (sourceError) return fail('anomalous', sourceError.reason, record)
    const source = material.source
    const existingSource = sources.find(item => item.source_url === source.url && Number(item.source_year) === source.year)
    if (existingSource && (existingSource.title !== source.title || existingSource.publisher !== source.publisher)) return fail('anomalous', '同 URL 与年份已登记不同标题或发布方，禁止覆盖', record)
    if (Date.parse(source.collectedAt) > now.getTime() || (record.review.reviewedAt && Date.parse(record.review.reviewedAt) > now.getTime())) return fail('anomalous', '采集或人工审核时间不能在未来', record)
    const existing = existingRows.find(item => item.fact_key === record.factKey)
    const evidenceResult = learningEvidenceSchema.safeParse({
      id: existing ? String(existing.id) : randomUUID(), factKey: record.factKey, majorId, kind: record.kind, content: record.content,
      source: { id: existingSource ? numberId(existingSource.id) : 1, artifactId: existing ? String(existing.artifact_id) : randomUUID(), title: source.title,
        url: source.url, year: source.year, publisher: source.publisher, publisherType: source.publisherType, sha256: source.sha256, collectedAt: source.collectedAt },
      locator: record.locator, scope: { level: record.scope.level, schoolId: matchingSchools.length ? numberId(matchingSchools[0]!.id) : null,
        province: record.scope.province, subjectGroup: record.scope.subjectGroup, admissionYear: record.scope.admissionYear },
      review: record.review, batch: { id: manifest.batchId, checksum: prepared.sha256, status: manifest.status },
      validUntil: record.validUntil, jobDirectionId: mapping ? numberId(mapping.job_direction_id) : null,
      careerMappingStatus: mapping ? String(mapping.review_status) : null, condition: record.condition,
    })
    if (!evidenceResult.success) return fail('anomalous', '事实不符合学习证据契约；核对事实类型、招生条件和职业方向', record)
    const evidence = evidenceResult.data
    if (mapping && record.kind === 'career_direction' && record.review.status === 'verified' && mapping.review_status === 'approved' && !mapping.reviewed_at) return fail('anomalous', '已通过的职业映射缺少核验时间，不能由导入工具补为人工审核', record)
    if (mapping && record.kind === 'career_direction' && record.review.status === 'verified' && mapping.review_status === 'approved' && Date.parse(String(mapping.reviewed_at)) > now.getTime()) return fail('anomalous', '职业映射核验时间在未来，不能发布为已审核方向', record)
    if (existing && identity(comparable(evidence)) !== identity(existingComparable(existing) as ReturnType<typeof comparable>)) return fail('anomalous', '已有事实键的专业、类型、范围或职业身份不可更改', record)
    return { rowNumber: index + 1, factKey: record.factKey,
      status: existing ? canonical(comparable(evidence)) === canonical(existingComparable(existing)) ? 'skipped' : 'updated' : 'inserted',
      reason: null, record, evidence }
  })
  const report = { total: rows.length, inserted: 0, updated: 0, skipped: 0, missing: 0, anomalous: 0 }
  for (const row of rows) report[row.status] += 1
  const coverage = majors.map(major => {
    const majorId = numberId(major.id)
    const evidence = rows.flatMap(row => row.evidence?.majorId === majorId ? [row.evidence] : [])
    const effective = evidence.filter(item => evidenceAvailability(item, now) === 'verified')
    return { majorId, majorCode: String(major.code), ...learningCompleteness(evidence, now),
      admissionRequirements: effective.filter(item => item.kind === 'admission_requirement').length,
      schoolExamples: new Set(effective.filter(item => item.scope.schoolId !== null).map(item => item.scope.schoolId)).size }
  })
  return { batchId: manifest.batchId, payloadSha256: prepared.sha256, mode: 'preflight', status: manifest.status, report, batchErrors, sourceErrors, rows, coverage }
}

async function refresh(prepared: PreparedLearningImport) {
  return prepareLearningImport(prepared.bytes, prepared.sha256, { baseDirectory: prepared.baseDirectory, previousSha256: prepared.previousSha256 })
}
export async function commitLearningImport(connection: LearningImportConnection, prepared: PreparedLearningImport, now = new Date()): Promise<LearningImportPreflight> {
  const current = await refresh(prepared)
  await connection.query('BEGIN')
  try {
    // Serializes source/metadata decisions made by this importer, including first import.
    await connection.query('SELECT pg_advisory_xact_lock($1)', [71402402])
    const preflight = await preflightLearningImport(connection, current, now)
    if (preflight.batchErrors.length || preflight.sourceErrors.length || preflight.report.missing || preflight.report.anomalous) throw new LearningImportError('导入预检未通过；请先查看缺失、异常及批次报告')
    await connection.query(`INSERT INTO learning_content_batches(id,payload_sha256,status,activated_at) VALUES($1,$2,$3,CASE WHEN $3='active' THEN $4::timestamptz ELSE NULL END)
      ON CONFLICT(id) DO UPDATE SET payload_sha256=EXCLUDED.payload_sha256,status=EXCLUDED.status,activated_at=EXCLUDED.activated_at
      WHERE learning_content_batches.payload_sha256 IS DISTINCT FROM EXCLUDED.payload_sha256`,
    [current.manifest.batchId, current.sha256, current.manifest.status, now.toISOString()])
    const artifacts = new Map<string, { id: string; sourceId: number }>()
    for (const material of current.sources) {
      const source = material.source
      const sourceRows = (await connection.query(`INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,collected_at) VALUES('major',$1,$2,$3,$4,$5)
        ON CONFLICT(source_url,source_year) DO NOTHING RETURNING id`, [source.title, source.url, source.year, source.publisher, source.collectedAt])).rows
      const storedSource = sourceRows.length ? null : (await connection.query('SELECT id,title,publisher FROM data_sources WHERE source_url=$1 AND source_year=$2 FOR UPDATE', [source.url, source.year])).rows[0]
      if (storedSource && (storedSource.title !== source.title || storedSource.publisher !== source.publisher)) throw new LearningImportError('同 URL 与年份来源登记发生变化，禁止覆盖；事务已回滚')
      const sourceId = sourceRows.length ? numberId(sourceRows[0]!.id) : numberId(storedSource!.id)
      const existingArtifact = (await connection.query('SELECT id FROM source_artifacts WHERE source_id=$1 AND sha256=$2', [sourceId, source.sha256])).rows[0]
      const artifactId = existingArtifact ? String(existingArtifact.id) : randomUUID()
      if (!existingArtifact) await connection.query(`INSERT INTO source_artifacts(id,source_id,official_page_url,collected_at,sha256,local_path,byte_size) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [artifactId, sourceId, source.url, source.collectedAt, source.sha256, material.localPath, material.byteSize])
      artifacts.set(source.key, { id: artifactId, sourceId })
    }
    for (const row of preflight.rows) {
      if (row.status === 'skipped') continue
      const item = row.evidence!, artifact = artifacts.get(row.record!.sourceKey)!
      await connection.query(`INSERT INTO major_learning_evidence(id,batch_id,fact_key,major_id,artifact_id,kind,content,publisher_type,locator_kind,locator_value,
        scope_level,school_id,province,subject_group,admission_year,condition,job_direction_id,review_status,reviewer,reviewed_at,review_conclusion,review_reason,valid_until)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT(batch_id,fact_key) DO UPDATE SET artifact_id=EXCLUDED.artifact_id,content=EXCLUDED.content,publisher_type=EXCLUDED.publisher_type,
        locator_kind=EXCLUDED.locator_kind,locator_value=EXCLUDED.locator_value,review_status=EXCLUDED.review_status,reviewer=EXCLUDED.reviewer,
        reviewed_at=EXCLUDED.reviewed_at,review_conclusion=EXCLUDED.review_conclusion,review_reason=EXCLUDED.review_reason,valid_until=EXCLUDED.valid_until,condition=EXCLUDED.condition`,
      [item.id, item.batch.id, item.factKey, item.majorId, artifact.id, item.kind, item.content, item.source.publisherType,
        item.locator.kind, item.locator.value, item.scope.level, item.scope.schoolId, item.scope.province, item.scope.subjectGroup,
        item.scope.admissionYear, item.condition ? JSON.stringify(item.condition) : null, item.jobDirectionId,
        item.review.status, item.review.reviewer, item.review.reviewedAt, item.review.conclusion, item.review.reason, item.validUntil])
      item.source.id = artifact.sourceId
      item.source.artifactId = artifact.id
    }
    await connection.query('COMMIT')
    return { ...preflight, mode: 'committed' }
  } catch (error) {
    await connection.query('ROLLBACK')
    if (error instanceof LearningImportError) throw error
    throw new LearningImportError('数据库导入失败，事务已回滚；请检查结构和权限')
  }
}

export async function withdrawLearningBatch(connection: LearningImportConnection, batchId: string, reason: string) {
  if (!z.string().uuid().safeParse(batchId).success || !text.max(1000).safeParse(reason).success) throw new LearningImportError('撤回须指定准确批次 UUID 和非空理由（最多 1000 字）')
  await connection.query('BEGIN')
  try {
    await connection.query('SELECT pg_advisory_xact_lock($1)', [71402402])
    const batch = (await connection.query('SELECT status FROM learning_content_batches WHERE id=$1 FOR UPDATE', [batchId])).rows[0]
    if (!batch) throw new LearningImportError('指定学习内容批次不存在')
    const count = Number((await connection.query('SELECT COUNT(*)::int count FROM major_learning_evidence WHERE batch_id=$1', [batchId])).rows[0]!.count)
    if (batch.status !== 'withdrawn') await connection.query(`UPDATE learning_content_batches SET status='withdrawn',withdrawn_at=NOW(),withdrawal_reason=$2 WHERE id=$1`, [batchId, reason.trim()])
    await connection.query('COMMIT')
    return { batchId, status: 'withdrawn' as const, evidenceCount: count, changed: batch.status !== 'withdrawn' }
  } catch (error) {
    await connection.query('ROLLBACK')
    if (error instanceof LearningImportError) throw error
    throw new LearningImportError('批次撤回失败，事务已回滚；请检查结构和权限')
  }
}
