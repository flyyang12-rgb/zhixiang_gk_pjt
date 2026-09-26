import { describe, expect, it, vi } from 'vitest'
import { loadCurrentLearningEvidence, parseCurrentLearningEvidence, type LearningEvidenceDatabase } from '../server/learning-evidence-repository.js'
import { evidenceNow, learningEvidenceFixture } from './fixtures/learning-evidence.js'

vi.mock('../server/database.js', () => ({ database: { query: () => { throw new Error('测试禁止调用默认数据库') } } }))
const major = { id: 1, code: '080901', name: '合成测试专业', category: '工学' }
const row = (evidence: unknown) => ({ evidence, school: { id: 1, name: '合成学校' }, job_direction: null })

describe('统一读取当前学习证据', () => {
  it('参数化关联材料、来源、当前批次、审核映射与学校身份，并保留URL定位', async () => {
    const query = vi.fn().mockResolvedValueOnce([[major], null]).mockResolvedValueOnce([[row(learningEvidenceFixture())], null])
    const result = await loadCurrentLearningEvidence({ query } as LearningEvidenceDatabase, { majorIds: [1], now: evidenceNow })
    expect(query.mock.calls[0]![1]).toEqual([[1]])
    expect(query.mock.calls[1]![0]).toContain('LEFT JOIN learning_content_batches')
    expect(query.mock.calls[1]![0]).toContain('LEFT JOIN source_artifacts')
    expect(query.mock.calls[1]![0]).toContain('LEFT JOIN major_job_directions')
    expect(query.mock.calls[1]![1]).toEqual([[1]])
    expect(result.facts[0]!).toMatchObject({ school: { id: 1, name: '合成学校' }, source: { url: 'https://test.example.edu/plan#curriculum' }, locator: { value: '合成课程章节' } })
  })
  it('待审核、撤回、到期及结构失效只输出缺口，不输出内容、来源URL或待审核理由', () => {
    const pending = learningEvidenceFixture({ content: '私有待审内容', review: { status: 'pending', reviewer: null, reviewedAt: null, conclusion: null, reason: '私有待审理由' } })
    const withdrawn = learningEvidenceFixture({ content: '已撤回的事实', batch: { ...learningEvidenceFixture().batch, status: 'withdrawn' } })
    const expired = learningEvidenceFixture({ validUntil: '2026-09-25T00:00:00Z' })
    const invalid = { ...learningEvidenceFixture(), kind: 'bad_kind', scope: { level: 'invalid' }, content: '未经校验的内容' }
    const result = parseCurrentLearningEvidence([major], [pending, withdrawn, expired, invalid].map(row), evidenceNow)
    expect(result.facts).toEqual([])
    expect(result.gaps.map(gap => gap.status)).toEqual(['pending', 'withdrawn', 'expired', 'invalid'])
    expect(JSON.stringify(result.gaps)).not.toContain('私有')
    expect(JSON.stringify(result.gaps)).not.toContain('已撤回的事实')
    expect(JSON.stringify(result.gaps)).not.toContain('https:')
  })
  it('职业映射未审核时方向及门槛都不能变成事实', () => {
    const facts = ['career_direction', 'career_requirement'].map(kind => ({ ...row(learningEvidenceFixture({
      kind: kind as 'career_direction' | 'career_requirement', jobDirectionId: 1, careerMappingStatus: 'pending',
    })), job_direction: { id: 1, name: '合成方向' } }))
    const result = parseCurrentLearningEvidence([major], facts, evidenceNow)
    expect(result.facts).toEqual([])
    expect(result.gaps.map(gap => gap.status)).toEqual(['pending', 'pending'])
  })
  it('关联学校或职业身份缺失不能通过有效事实校验；空ID请求不访问数据库', async () => {
    expect(parseCurrentLearningEvidence([major], [{ ...row(learningEvidenceFixture()), school: null }], evidenceNow).gaps[0]!.status).toBe('invalid')
    const query = vi.fn()
    expect(await loadCurrentLearningEvidence({ query } as LearningEvidenceDatabase, { majorIds: [] })).toEqual({ majors: [], facts: [], gaps: [] })
    expect(query).not.toHaveBeenCalled()
  })
  it('审核冲突保留具体理由与范围，但不发布冲突材料原文', () => {
    const item = learningEvidenceFixture({ content: '不可发布的冲突原文', review: { status: 'conflicting', reviewer: '合成审核人',
      reviewedAt: '2026-09-21T00:00:00Z', conclusion: 'conflicting', reason: '合成材料年份口径冲突' } })
    const result = parseCurrentLearningEvidence([major], [row(item)], evidenceNow)
    expect(result.facts).toEqual([])
    expect(result.gaps[0]!).toMatchObject({ status: 'conflicting', scope: { schoolId: 1 }, sourceYear: 2025 })
    expect(result.gaps[0]!.reason).toContain('年份口径冲突')
    expect(JSON.stringify(result)).not.toContain('不可发布的冲突原文')
  })
  it('缺少标准身份时返回空集，越界ID不向数据库发查询', async () => {
    const query = vi.fn().mockResolvedValueOnce([[], null])
    expect(await loadCurrentLearningEvidence({ query } as LearningEvidenceDatabase, { majorIds: [777], now: evidenceNow })).toEqual({ majors: [], facts: [], gaps: [] })
    expect(query).toHaveBeenCalledTimes(1)
    await expect(loadCurrentLearningEvidence({ query } as LearningEvidenceDatabase, { majorIds: [-1] })).rejects.toThrow()
    expect(query).toHaveBeenCalledTimes(1)
  })
})
