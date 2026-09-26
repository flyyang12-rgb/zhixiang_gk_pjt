import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { learningPayloadSha256, preflightLearningImport, prepareLearningImport, type LearningImportManifest } from '../server/learning-evidence-import.js'

// Only synthetic facts; never copy this material into a formal data batch.
const now = new Date('2026-09-26T00:00:00Z')
const raw = Buffer.from('合成测试材料，不是任何真实专业证据。')
function manifest(status: 'active' | 'staged' = 'active'): LearningImportManifest {
  const base = { majorCode: '080901', sourceKey: 'synthetic', locator: { kind: 'section', value: '合成测试章节' },
    scope: { level: 'school', schoolName: '合成学校', province: null, subjectGroup: null, admissionYear: null },
    review: { status: 'verified', reviewer: '合成测试审核人', reviewedAt: '2026-09-21T00:00:00Z', conclusion: 'verified', reason: '仅用于验证合成材料，未审核正式事实' },
    validUntil: null, jobDirectionCode: null, condition: null }
  return { version: 1, batchId: '73000000-0000-4000-8000-000000000001', status,
    sources: [{ key: 'synthetic', title: '合成材料', url: 'https://test.example.edu/plan#synthetic', year: 2025,
      publisher: '合成学校', publisherType: 'university', collectedAt: '2026-09-20T00:00:00Z', localPath: 'raw.txt', sha256: learningPayloadSha256(raw) }],
    records: [{ ...base, factKey: 'curriculum', kind: 'curriculum', content: '合成课程' },
      { ...base, factKey: 'activity', kind: 'learning_activity', content: '合成活动' },
      { ...base, factKey: 'career', kind: 'career_direction', content: '合成职业', jobDirectionCode: 'synthetic-career' }] }
}
function connection(overrides: Record<string, unknown[]> = {}) {
  const tables: Record<string, unknown[]> = { majors: [{ id: 101, code: '080901' }], schools: [{ id: 201, name: '合成学校' }],
    mappings: [{ major_id: 101, job_direction_id: 301, code: 'synthetic-career', review_status: 'approved', reviewed_at: '2026-09-21T00:00:00Z' }],
    sources: [], batch: [], facts: [], ...overrides }
  return { query: vi.fn(async (sql: string) => {
    const key = sql.includes('FROM majors ') ? 'majors' : sql.includes('FROM schools ') ? 'schools' : sql.includes('FROM major_job_directions') ? 'mappings'
      : sql.includes('FROM data_sources ') ? 'sources' : sql.includes('FROM learning_content_batches ') ? 'batch' : sql.includes('FROM major_learning_evidence ') ? 'facts' : null
    if (!key) throw new Error(`测试不允许预检写库：${sql}`)
    return { rows: tables[key] as Record<string, unknown>[], rowCount: tables[key]!.length }
  }) }
}

describe('学习证据导入的只读预检', () => {
  let directory: string
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'zhixiang-learning-import-')); await writeFile(join(directory, 'raw.txt'), raw) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
  async function prepare(input = manifest(), previousSha256?: string) {
    const bytes = Buffer.from(JSON.stringify(input))
    return prepareLearningImport(bytes, learningPayloadSha256(bytes), { baseDirectory: directory, previousSha256 })
  }

  it('核对真实输入与原文件；预检只有 SELECT，保留原锚点且按三要素计算覆盖', async () => {
    const db = connection(), prepared = await prepare()
    const result = await preflightLearningImport(db, prepared, now)
    expect(result.report).toEqual({ total: 3, inserted: 3, updated: 0, skipped: 0, missing: 0, anomalous: 0 })
    expect(result.rows[0]!.evidence!.source.url).toContain('#synthetic')
    expect(result.coverage[0]).toMatchObject({ complete: true, curriculum: 1, activities: 1, directions: 1, admissionRequirements: 0, schoolExamples: 1 })
    expect(db.query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true)
  })
  it('输入SHA错误与输入超限在数据库访问前拒绝', async () => {
    const bytes = Buffer.from(JSON.stringify(manifest()))
    await expect(prepareLearningImport(bytes, 'a'.repeat(64), { baseDirectory: directory })).rejects.toThrow('SHA-256')
    await expect(prepareLearningImport(Buffer.alloc(2 * 1024 * 1024 + 1), 'a'.repeat(64), { baseDirectory: directory })).rejects.toThrow('2MB')
  })
  it.each(['../outside.txt', 'C:/private/secrets.txt'])('拒绝原材料路径跳出输入目录：%s', async path => {
    const input = manifest(); input.sources[0]!.localPath = path
    const result = await preflightLearningImport(connection(), await prepare(input), now)
    expect(result.sourceErrors).toHaveLength(1); expect(result.report.anomalous).toBe(3)
    expect(JSON.stringify(result.sourceErrors)).not.toContain(directory)
  })
  it('原文件改动或缺失不会被校验字段伪装为正确', async () => {
    await writeFile(join(directory, 'raw.txt'), '改动过的合成文件')
    expect((await prepare()).sources[0]!.error).toContain('SHA-256')
    const input = manifest(); input.sources[0]!.localPath = 'missing.txt'
    expect((await prepare(input)).sources[0]!.error).toContain('无法只读访问')
  })
  it('没有明确材料年，不能从采集日期猜测', async () => {
    const input = manifest() as unknown as { sources: Array<Record<string, unknown>> }
    delete input.sources[0]!.year
    const bytes = Buffer.from(JSON.stringify(input))
    await expect(prepareLearningImport(bytes, learningPayloadSha256(bytes), { baseDirectory: directory })).rejects.toThrow('材料年份')
  })
  it('staged批次或pending审核不能发布完整条目', async () => {
    const staged = await preflightLearningImport(connection(), await prepare(manifest('staged')), now)
    expect(staged.coverage[0]!.complete).toBe(false)
    const input = manifest()
    input.records = input.records.map(record => ({ ...record as object, review: { status: 'pending', reviewer: null, reviewedAt: null, conclusion: null, reason: null } }))
    const pending = await preflightLearningImport(connection(), await prepare(input), now)
    expect(pending.report.anomalous).toBe(0); expect(pending.coverage[0]!.complete).toBe(false)
  })
  it('职业映射只读取既有审核状态，不把pending自动提升为approved', async () => {
    const result = await preflightLearningImport(connection({ mappings: [{ major_id: 101, job_direction_id: 301, code: 'synthetic-career', review_status: 'pending', reviewed_at: null }] }), await prepare(), now)
    expect(result.rows[2]!.evidence!.careerMappingStatus).toBe('pending')
    expect(result.coverage[0]!.directions).toBe(0)
  })
  it('approved职业映射没有审核时间时不能靠导入补为人工审核', async () => {
    const result = await preflightLearningImport(connection({ mappings: [{ major_id: 101, job_direction_id: 301, code: 'synthetic-career', review_status: 'approved', reviewed_at: null }] }), await prepare(), now)
    expect(result.report.anomalous).toBe(1)
    expect(result.rows[2]!.reason).toContain('核验时间')
  })
  it.each(['majors', 'schools', 'mappings'])('标准身份必须精确存在，不模糊匹配或新建：%s', async key => {
    const result = await preflightLearningImport(connection({ [key]: [] }), await prepare(), now)
    expect(result.report.missing).toBe(key === 'mappings' ? 1 : 3)
  })
  it('重复factKey和未经审核的verified结构报异常', async () => {
    const input = manifest()
    input.records.push(input.records[0])
    input.records.push({ ...input.records[0] as object, factKey: 'bad-review', review: { status: 'verified', reviewer: null, reviewedAt: null, conclusion: 'verified', reason: null } })
    const result = await preflightLearningImport(connection(), await prepare(input), now)
    expect(result.report.anomalous).toBe(2)
    expect(result.report.total).toBe(Object.entries(result.report).filter(([key]) => key !== 'total').reduce((sum, [, value]) => sum + value, 0))
  })
  it('学习先修条件不能转换成招生资格', async () => {
    const input = manifest()
    input.records = [{ ...input.records[0] as object, kind: 'learning_prerequisite', condition: { type: 'subjects', mode: 'unrestricted', subjects: [] } }]
    const result = await preflightLearningImport(connection(), await prepare(input), now)
    expect(result.report.anomalous).toBe(1)
  })
  it('同URL/年份不同标题或发布方禁止覆盖已有来源', async () => {
    const input = manifest()
    const result = await preflightLearningImport(connection({ sources: [{ id: 401, source_url: input.sources[0]!.url, source_year: 2025, title: '已有不同标题', publisher: '合成学校' }] }), await prepare(input), now)
    expect(result.report.anomalous).toBe(3)
  })
  it('输入自身的来源键虽然不同，矛盾标题也不能通过', async () => {
    const input = manifest()
    input.sources.push({ ...input.sources[0]!, key: 'conflict', title: '另一标题' })
    const result = await preflightLearningImport(connection(), await prepare(input), now)
    expect(result.sourceErrors).toHaveLength(2); expect(result.report.anomalous).toBe(3)
  })
  it('active不能替换、withdrawn不能重激活', async () => {
    const prepared = await prepare()
    const active = await preflightLearningImport(connection({ batch: [{ id: prepared.manifest.batchId, status: 'active', payload_sha256: 'c'.repeat(64) }] }), prepared, now)
    expect(active.batchErrors).toContain('只有待发布批次可凭准确原 SHA-256 显式替换输入')
    const withdrawn = await preflightLearningImport(connection({ batch: [{ id: prepared.manifest.batchId, status: 'withdrawn', payload_sha256: prepared.sha256 }] }), prepared, now)
    expect(withdrawn.batchErrors).toContain('撤回的批次不能重新导入或激活')
  })
})
