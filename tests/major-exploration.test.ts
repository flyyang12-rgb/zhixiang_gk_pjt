import { describe, expect, it, vi } from 'vitest'
import { createExplorationCatalog, createExplorationDetail, createExplorationList, explorationCatalogQuerySchema,
  explorationDetailScopeSchema, type ExplorationContext } from '../server/major-exploration.js'
import { parseCurrentLearningEvidence, type LearningEvidenceSnapshot, type StandardMajor } from '../server/learning-evidence-repository.js'
import { admissionEvidenceFixture, evidenceNow, learningEvidenceFixture } from './fixtures/learning-evidence.js'
import type { LearningEvidence } from '../server/learning-evidence-contract.js'

vi.mock('../server/database.js', () => ({ database: { query: () => { throw new Error('测试禁止调用默认数据库') } } }))

const context: ExplorationContext = { province: '河南', subjectGroup: '物理类', selectedSubjects: ['物理', '生物', '地理'], admissionYear: 2026 }
const identity = (id: number, category = '工学', code = String(id).padStart(6, '0')): StandardMajor => ({ id, name: `合成专业${id}`, code, category })
function snapshot(majors: StandardMajor[], evidence: LearningEvidence[]): LearningEvidenceSnapshot {
  return parseCurrentLearningEvidence(majors, evidence.map(item => ({ evidence: item,
    school: item.scope.schoolId === null ? null : { id: item.scope.schoolId, name: `合成学校${item.scope.schoolId}` },
    job_direction: item.jobDirectionId === null ? null : { id: item.jobDirectionId, name: `合成职业${item.jobDirectionId}` },
  })), evidenceNow)
}
let factSequence = 10
function fact(majorId: number, overrides: Partial<LearningEvidence> = {}) {
  return learningEvidenceFixture({ id: `10000000-0000-4000-8000-${String(factSequence++).padStart(12, '0')}`,
    majorId, ...overrides })
}
function complete(majorId: number): LearningEvidence[] {
  return [fact(majorId), fact(majorId, { kind: 'learning_activity' }), fact(majorId, {
    kind: 'career_direction', jobDirectionId: 1, careerMappingStatus: 'approved',
  })]
}

describe('无位次探索清单与完整审核池', () => {
  it('完整条目优先，各组按类别、代码和 ID 稳定浏览，最多九项且没有分档或评分', () => {
    const majors = Array.from({ length: 13 }, (_, index) => identity(index + 1))
    const evidence = majors.flatMap(major => major.id === 1 ? [fact(1)] : complete(major.id))
    const data = createExplorationList(snapshot([...majors].reverse(), evidence.reverse()), context, evidenceNow)
    expect(data.cards.map(card => card.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(data.coverage).toMatchObject({ reviewedMajorCount: 13, completeMajorCount: 12, incompleteMajorCount: 1, displayedCount: 9 })
    expect(data.coverage.sourceYears).toEqual([2025])
    for (const card of data.cards) {
      expect(card).not.toHaveProperty('score')
      expect(card).not.toHaveProperty('tier')
      expect(card).not.toHaveProperty('risk')
      expect(card).not.toHaveProperty('factors')
    }
    const equalCodes = [identity(3, '理学', '01'), identity(2, '工学', '01'), identity(1, '工学', '01')]
    expect(createExplorationList(snapshot(equalCodes, equalCodes.flatMap(major => complete(major.id))), context, evidenceNow).cards.map(card => card.id)).toEqual([1, 2, 3])
  })
  it('不足九项展示实际数量，课程或活动或职业缺任一项即不完整，不补造内容', () => {
    const data = createExplorationList(snapshot([identity(1), identity(2)], [fact(1), fact(2, { kind: 'learning_activity' })]), context, evidenceNow)
    expect(data.cards).toHaveLength(2)
    expect(data.coverage).toMatchObject({ completeMajorCount: 0, incompleteMajorCount: 2 })
    expect(data.cards[0]!.completeness.missing).toContain('学习活动材料待补充')
    expect(data.cards[0]!.careerDirections).toEqual([])
    expect(data.dataGaps.join('')).toContain('2 个专业')
  })
  it('目录全池分页、名称及类别筛选，详情可直接访问首屏外专业', () => {
    const majors = Array.from({ length: 12 }, (_, index) => identity(index + 1, index % 2 ? '理学' : '工学'))
    const state = snapshot(majors, majors.flatMap(major => complete(major.id)))
    const first = createExplorationCatalog(state, context, { page: 1, pageSize: 5 }, evidenceNow)
    const second = createExplorationCatalog(state, context, { page: 2, pageSize: 5 }, evidenceNow)
    expect(first.total).toBe(12)
    expect(first.items).toHaveLength(5)
    expect(second.items.map(card => card.id).filter(id => first.items.some(card => card.id === id))).toEqual([])
    expect(createExplorationCatalog(state, context, { search: '专业12', category: '理学' }, evidenceNow).items.map(card => card.id)).toEqual([12])
    expect(createExplorationDetail(state, context, 12, {}, evidenceNow)?.identity.id).toBe(12)
  })
  it('存在但未审核与不存在分开，未审核原文不出现在任何详情事实中', () => {
    const pending = fact(2, { content: '禁止发布的待审核原文', review: { status: 'pending', reviewer: null, reviewedAt: null, conclusion: null, reason: '禁止发布的待审核理由' } })
    const state = snapshot([identity(1), identity(2)], [...complete(1), pending])
    expect(createExplorationCatalog(state, context, {}, evidenceNow).total).toBe(2)
    const result = createExplorationCatalog(state, context, { search: '专业2' }, evidenceNow)
    expect(result.items[0]!.status).toBe('pending')
    expect(result.items[0]!.dataGaps.join('')).toContain('资料待补充')
    const detail = createExplorationDetail(state, context, 2, {}, evidenceNow)
    expect(detail?.status).toBe('pending')
    expect(JSON.stringify(detail)).not.toContain('禁止发布')
    expect(createExplorationDetail(state, context, 999, {}, evidenceNow)).toBeNull()
  })
  it('没有审核材料时仍展示标准专业入门方向，最多九项，不发布事实或假装选科不限', () => {
    const majors = Array.from({ length: 12 }, (_, index) => identity(index + 1))
    const state = snapshot(majors.reverse(), [])
    const saved = { ...context, savedItems: [{ itemType: 'major' as const, itemId: 1, state: 'excluded' as const }] }
    const list = createExplorationList(state, saved, evidenceNow)
    expect(list.cards.map(card => card.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(list.coverage).toMatchObject({ reviewedMajorCount: 0, completeMajorCount: 0, incompleteMajorCount: 0, displayedCount: 9 })
    expect(list.coverage.sourceYears).toEqual([])
    for (const card of list.cards) {
      expect(card.status).toBe('pending')
      expect(card.curriculum).toEqual([])
      expect(card.learningActivities).toEqual([])
      expect(card.careerDirections).toEqual([])
      expect(card.schoolExamples).toEqual([])
      expect(card.admission.status).toBe('unknown')
      expect(card).not.toHaveProperty('score')
      expect(card).not.toHaveProperty('tier')
      expect(card).not.toHaveProperty('risk')
    }
    expect(createExplorationCatalog(state, saved, {}, evidenceNow).total).toBe(12)
  })
  it('有部分审核材料时优先展示，不使用失效专业填充首屏或默认目录', () => {
    const withdrawn = fact(3, { batch: { ...learningEvidenceFixture().batch, status: 'withdrawn' } })
    const state = snapshot([identity(1), identity(2), identity(3)], [fact(2), withdrawn])
    expect(createExplorationList(state, context, evidenceNow).cards.map(card => card.id)).toEqual([2, 1])
    expect(createExplorationCatalog(state, context, {}, evidenceNow).items.map(card => card.id)).toEqual([1, 2])
    expect(createExplorationCatalog(state, context, { search: '专业3' }, evidenceNow).items[0]?.status).toBe('unavailable')
  })
  it('排除只影响首屏，目录、详情和家庭原始备注仍保留，恢复后重新出现', () => {
    const state = snapshot([identity(1), identity(2)], [...complete(1), ...complete(2)])
    const excluded = { ...context, savedItems: [{ itemType: 'major' as const, itemId: 1, state: 'excluded' as const, note: '  家庭原始备注  ' }] }
    expect(createExplorationList(state, excluded, evidenceNow).cards.map(card => card.id)).toEqual([2])
    expect(createExplorationCatalog(state, excluded, {}, evidenceNow).items[0]).toMatchObject({ id: 1, savedState: 'excluded', note: '  家庭原始备注  ' })
    expect(createExplorationDetail(state, excluded, 1, {}, evidenceNow)?.note).toBe('  家庭原始备注  ')
    expect(createExplorationList(state, context, evidenceNow).cards.map(card => card.id)).toEqual([1, 2])
  })
})

describe('选科资格与学习条件的范围', () => {
  it('适用专业要求不满足时不进清单但目录可查；未知不能当不限', () => {
    const state = snapshot([identity(1), identity(2)], [...complete(1), ...complete(2), admissionEvidenceFixture()])
    expect(createExplorationList(state, context, evidenceNow).cards.map(card => card.id)).toEqual([2])
    const cards = createExplorationCatalog(state, context, {}, evidenceNow).items
    expect(cards[0]!.admission.status).toBe('not_met')
    expect(cards[1]!.admission).toMatchObject({ status: 'unknown', admissionYear: 2026 })
    expect(cards[1]!.admission.reason).toContain('未知不表示不限')
  })
  it('单校要求只标记对应实例，省份/科类/招生年不匹配不会过滤整个专业', () => {
    const requirements = [admissionEvidenceFixture({ scope: { level: 'school', schoolId: 1, province: '河南', subjectGroup: '物理类', admissionYear: 2026 } }),
      admissionEvidenceFixture({ id: '10000000-0000-4000-8000-000000000003', scope: { level: 'major', schoolId: null, province: '山东', subjectGroup: '物理类', admissionYear: 2026 } }),
      admissionEvidenceFixture({ id: '10000000-0000-4000-8000-000000000004', scope: { level: 'major', schoolId: null, province: '河南', subjectGroup: '物理类', admissionYear: 2025 } })]
    const result = createExplorationList(snapshot([identity(1)], [...complete(1), ...requirements]), context, evidenceNow)
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]!.admission.status).toBe('unknown')
    expect(result.cards[0]!.schoolExamples[0]!.admission.status).toBe('not_met')
  })
  it('课程先修与学习前置知识不会变成招生资格，职业门槛同样隔离', () => {
    const prerequisites = ['learning_prerequisite', 'course_prerequisite', 'career_requirement'] as const
    const state = snapshot([identity(1)], [...complete(1), ...prerequisites.map(kind => fact(1, { kind, content: '合成条件，仅用于学习或职业，不作为招生条件' }))])
    const result = createExplorationList(state, context, evidenceNow)
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]!.admission.status).toBe('unknown')
    const detail = createExplorationDetail(state, context, 1, {}, evidenceNow)!
    expect(detail.facts.course_prerequisite).toHaveLength(1)
    expect(detail.facts.learning_prerequisite).toHaveLength(1)
    expect(detail.facts.admission_requirement).toHaveLength(0)
  })
  it('同一精确范围的矛盾选科材料成为冲突缺口，不挑其中一条判满足', () => {
    const rule1 = admissionEvidenceFixture()
    const rule2 = admissionEvidenceFixture({ id: '10000000-0000-4000-8000-000000000002', condition: { type: 'subjects', mode: 'unrestricted', subjects: [] } })
    const state = snapshot([identity(1)], [...complete(1), rule1, rule2])
    const detail = createExplorationDetail(state, context, 1, {}, evidenceNow)!
    expect(detail.admission.status).toBe('conflicting')
    expect(detail.admission.evidence).toEqual([])
    expect(detail.facts.admission_requirement).toEqual([])
    expect(detail.unavailableEvidence.filter(gap => gap.status === 'conflicting')).toHaveLength(2)
    expect(createExplorationList(state, context, evidenceNow).cards).toHaveLength(1)
  })
})

describe('具体材料范围、失效和当前事实', () => {
  it('指定学校/材料年缺失不静默回退，其他实例保留实际学校和年份', () => {
    const state = snapshot([identity(1)], complete(1))
    const detail = createExplorationDetail(state, context, 1, { schoolId: 2, sourceYear: 2026 }, evidenceNow)!
    expect(detail.materialStatus).toBe('missing')
    expect(detail.requestedScope).toEqual({ schoolId: 2, sourceYear: 2026 })
    expect(detail.facts.curriculum).toEqual([])
    expect(detail.otherInstances).toHaveLength(3)
    expect(detail.otherInstances[0]!.school!.id).toBe(1)
    expect(detail.otherInstances[0]!.source.year).toBe(2025)
    expect(detail.dataGaps.join('')).toContain('指定学校或材料年份')
  })
  it('材料年限制同样约束招生引用，不用其他年同一招生年材料静默补齐', () => {
    const rule = admissionEvidenceFixture({ scope: { level: 'school', schoolId: 1, province: '河南', subjectGroup: '物理类', admissionYear: 2026 },
      condition: { type: 'subjects', mode: 'unrestricted', subjects: [] } })
    const state = snapshot([identity(1)], [...complete(1), rule])
    const exact = createExplorationDetail(state, context, 1, { schoolId: 1, sourceYear: 2025 }, evidenceNow)!
    expect(exact.admission.status).toBe('known')
    expect(exact.dataGaps.join('')).not.toContain('选科材料待核验')
    const missing = createExplorationDetail(state, context, 1, { schoolId: 1, sourceYear: 2026 }, evidenceNow)!
    expect(missing.admission.status).toBe('unknown')
    expect(missing.admission.evidence).toEqual([])
    expect(missing.facts.admission_requirement).toEqual([])
    expect(missing.otherInstances.find(fact => fact.id === rule.id)?.source.year).toBe(2025)
  })
  it('其他学校和材料年的冲突缺口不套到当前明确请求范围', () => {
    const conflict = fact(1, { kind: 'curriculum', scope: { level: 'school', schoolId: 2, province: null, subjectGroup: null, admissionYear: null },
      review: { status: 'conflicting', reviewer: '合成审核人', reviewedAt: '2026-09-21T00:00:00Z', conclusion: 'conflicting', reason: '其他学校的合成冲突' } })
    const state = snapshot([identity(1)], [...complete(1), conflict])
    const detail = createExplorationDetail(state, context, 1, { schoolId: 1, sourceYear: 2025 }, evidenceNow)!
    expect(detail.materialStatus).toBe('available')
    expect(detail.unavailableEvidence).toEqual([])
    expect(detail.dataGaps.join('')).not.toContain('其他学校的合成冲突')
  })
  it('学校实例最多两所，只来自具体专业学习材料，职业方向最多三个且门槛来源独立', () => {
    const evidence = [...complete(1), ...[4, 3, 2].map(schoolId => fact(1, { scope: { level: 'school', schoolId, province: null, subjectGroup: null, admissionYear: null } })),
      ...[5, 4, 3, 2].map(jobDirectionId => fact(1, { kind: 'career_direction', jobDirectionId, careerMappingStatus: 'approved' })),
      fact(1, { kind: 'career_requirement', jobDirectionId: 1, careerMappingStatus: 'approved' }),
      fact(1, { kind: 'career_direction', jobDirectionId: 6, careerMappingStatus: 'approved', scope: { level: 'school', schoolId: 7, province: null, subjectGroup: null, admissionYear: null } })]
    const detail = createExplorationDetail(snapshot([identity(1)], evidence), context, 1, {}, evidenceNow)!
    expect(detail.schoolExamples.map(school => school.id)).toEqual([1, 2])
    expect(detail.careerDirections.map(direction => direction.id)).toEqual([1, 2, 3])
    expect(detail.careerDirections[0]!.requirements).toHaveLength(1)
    expect(detail.careerDirections[1]!.requirementStatus).toBe('unknown')
    expect(detail.schoolExamples[0]!.note).toContain('不能据此认定当前可报或可达')
  })
  it('撤回/到期后有效事实为空，改名保留ID、收藏和备注；下次生成读取当前状态', () => {
    const evidence = complete(1)
    const saved = { ...context, savedItems: [{ itemType: 'major' as const, itemId: 1, state: 'saved' as const, note: '原始讨论' }] }
    expect(createExplorationDetail(snapshot([identity(1)], evidence), saved, 1, {}, evidenceNow)?.facts.curriculum).toHaveLength(1)
    const unavailable = evidence.map(item => ({ ...item, batch: { ...item.batch, status: 'withdrawn' as const } }))
    const detail = createExplorationDetail(snapshot([{ ...identity(1), name: '合成新名称' }], unavailable), saved, 1, {}, evidenceNow)!
    expect(detail).toMatchObject({ identity: { id: 1, name: '合成新名称' }, status: 'unavailable', savedState: 'saved', note: '原始讨论' })
    expect(Object.values(detail.facts).flat()).toEqual([])
    expect(detail.unavailableEvidence).toHaveLength(3)
    expect(detail.dataGaps.join('')).toContain('已撤回')
    const expired = fact(1, { validUntil: '2026-09-25T00:00:00Z' })
    expect(createExplorationDetail(snapshot([identity(1)], [expired]), saved, 1, {}, evidenceNow)?.unavailableEvidence[0]!.status).toBe('expired')
  })
  it('不依赖外部AI、招聘健康或未来发展信号，来源原锚点和定位保留', () => {
    const result = createExplorationDetail(snapshot([identity(1)], complete(1)), context, 1, {}, evidenceNow)!
    expect(result.completeness.complete).toBe(true)
    expect(result.facts.curriculum[0]!.source.url).toContain('#curriculum')
    expect(result.facts.curriculum[0]!.locator).toEqual({ kind: 'section', value: '合成课程章节' })
    expect(result).not.toHaveProperty('employment')
  })
  it('分页、ID范围和材料年份输入拒绝越界，限制单页50项', () => {
    expect(explorationCatalogQuerySchema.safeParse({ page: 0 }).success).toBe(false)
    expect(explorationCatalogQuerySchema.safeParse({ pageSize: 51 }).success).toBe(false)
    expect(explorationCatalogQuerySchema.safeParse({ search: 'x'.repeat(101) }).success).toBe(false)
    expect(explorationCatalogQuerySchema.safeParse({ other: 'unrecognized' }).success).toBe(false)
    expect(explorationDetailScopeSchema.safeParse({ schoolId: -1 }).success).toBe(false)
    expect(explorationDetailScopeSchema.safeParse({ sourceYear: 1999 }).success).toBe(false)
  })
})
