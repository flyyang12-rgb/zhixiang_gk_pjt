import { describe, expect, it } from 'vitest'
import { admissionSubjectConditionSchema, evidenceAvailability, evaluateAdmissionEvidence,
  learningCompleteness, learningEvidenceSchema, officialEvidenceUrlSchema, selectLearningMaterials } from '../server/learning-evidence-contract.js'
import { admissionEvidenceFixture, evidenceNow, learningEvidenceFixture } from './fixtures/learning-evidence.js'

const context = { province: '河南', subjectGroup: '物理类', admissionYear: 2026, schoolId: null, selectedSubjects: ['物理', '化学', '生物'] }

describe('逐事实来源与人工审核契约', () => {
  it('保留原 URL 锚点、独立定位与源校验值', () => {
    const evidence = learningEvidenceSchema.parse(learningEvidenceFixture())
    expect(evidence.source.url).toContain('#curriculum')
    expect(evidence.locator.value).toBe('合成课程章节')
    expect(evidenceAvailability(evidence, evidenceNow)).toBe('verified')
  })
  it.each(['http://test.example.edu/plan', 'https://localhost/plan', 'https://127.0.0.1/plan',
    'https://user:password@test.example.edu/plan', 'javascript:alert(1)', 'https://[::1]/plan', 'not a URL'])('拒绝危险或非公开地址 %s', url => {
    expect(officialEvidenceUrlSchema.safeParse(url).success).toBe(false)
  })
  it('只有来源链接和模型时间不等于审核通过', () => {
    const evidence = learningEvidenceFixture()
    evidence.review = { status: 'pending', reviewer: null, reviewedAt: null, conclusion: null, reason: null }
    expect(evidenceAvailability(evidence, evidenceNow)).toBe('pending')
    evidence.review.status = 'verified'
    expect(evidenceAvailability(evidence, evidenceNow)).toBe('invalid')
    expect(learningEvidenceSchema.safeParse({ ...learningEvidenceFixture(), modelGeneratedAt: evidenceNow.toISOString() }).success).toBe(false)
  })
  it.each(['conflicting', 'rejected', 'withdrawn'] as const)('%s 不进入有效事实', status => {
    const evidence = learningEvidenceFixture()
    evidence.review.status = status
    evidence.review.conclusion = status
    expect(evidenceAvailability(evidence, evidenceNow)).toBe(status)
    expect(learningCompleteness([evidence], evidenceNow).curriculum).toBe(0)
  })
  it('批次未激活或已撤回不发布，过期和未来核验不变成有效事实', () => {
    const evidence = learningEvidenceFixture()
    evidence.batch.status = 'staged'
    expect(evidenceAvailability(evidence, evidenceNow)).toBe('pending')
    evidence.batch.status = 'withdrawn'
    expect(evidenceAvailability(evidence, evidenceNow)).toBe('withdrawn')
    evidence.batch.status = 'active'
    evidence.validUntil = evidenceNow.toISOString()
    expect(evidenceAvailability(evidence, evidenceNow)).toBe('expired')
    evidence.validUntil = null
    evidence.review.reviewedAt = '2026-10-01T00:00:00Z'
    expect(evidenceAvailability(evidence, evidenceNow)).toBe('pending')
  })
  it('拒绝丢失定位、无效校验值和提前失效', () => {
    const evidence = learningEvidenceFixture()
    expect(learningEvidenceSchema.safeParse({ ...evidence, locator: { kind: 'page', value: '' } }).success).toBe(false)
    expect(learningEvidenceSchema.safeParse({ ...evidence, source: { ...evidence.source, sha256: 'not-a-checksum' } }).success).toBe(false)
    expect(learningEvidenceSchema.safeParse({ ...evidence, validUntil: '2025-01-01T00:00:00Z' }).success).toBe(false)
  })
  it('契约拒绝个人适合度、人格标签与家庭权重', () => {
    for (const key of ['suitability', 'personality', 'familyWeights']) {
      expect(learningEvidenceSchema.safeParse({ ...learningEvidenceFixture(), [key]: 100 }).success).toBe(false)
    }
  })
})

describe('完整条目与已审核职业方向', () => {
  it('课程、活动与方向各至少一项才完整；选科和实例不是完整度条件', () => {
    const curriculum = learningEvidenceFixture({ scope: { level: 'major', schoolId: null, province: null, subjectGroup: null, admissionYear: null } })
    const activity = learningEvidenceFixture({ kind: 'learning_activity' })
    const direction = learningEvidenceFixture({ kind: 'career_direction', jobDirectionId: 1, careerMappingStatus: 'approved' })
    expect(learningCompleteness([curriculum, activity], evidenceNow)).toMatchObject({ complete: false, directions: 0, missing: ['职业方向材料待补充'] })
    expect(learningCompleteness([curriculum, activity, direction, direction], evidenceNow)).toMatchObject({ complete: true, directions: 1, missing: [] })
    direction.careerMappingStatus = 'pending'
    expect(learningCompleteness([curriculum, activity, direction], evidenceNow).complete).toBe(false)
    direction.careerMappingStatus = 'rejected'
    expect(evidenceAvailability(direction, evidenceNow)).toBe('pending')
  })
  it('完全缺失保持缺口，不给零分或补职业方向', () => {
    expect(learningCompleteness([], evidenceNow)).toEqual({ complete: false, curriculum: 0, activities: 0, directions: 0,
      missing: ['课程材料待补充', '学习活动材料待补充', '职业方向材料待补充'] })
  })
})

describe('招生范围与四类条件隔离', () => {
  it('未知不等于不限；不限须已核验且显式登记', () => {
    expect(evaluateAdmissionEvidence([], context, evidenceNow).status).toBe('unknown')
    const evidence = admissionEvidenceFixture({ condition: { type: 'subjects', mode: 'unrestricted', subjects: [] } })
    expect(evaluateAdmissionEvidence([evidence], context, evidenceNow).status).toBe('known')
    expect(admissionSubjectConditionSchema.safeParse({ type: 'subjects', mode: 'all', subjects: [] }).success).toBe(false)
    expect(admissionSubjectConditionSchema.safeParse({ type: 'subjects', mode: 'all', subjects: ['物理', '物理'] }).success).toBe(false)
  })
  it('精确匹配省份、科类和招生年，缺当前范围不回退', () => {
    const evidence = admissionEvidenceFixture()
    expect(evaluateAdmissionEvidence([evidence], context, evidenceNow).status).toBe('known')
    for (const override of [{ province: '河北' }, { subjectGroup: '历史类' }, { admissionYear: 2025 }]) {
      expect(evaluateAdmissionEvidence([evidence], { ...context, ...override }, evidenceNow).status).toBe('unknown')
    }
    expect(evaluateAdmissionEvidence([evidence], { ...context, selectedSubjects: ['物理', '生物', '地理'] }, evidenceNow).status).toBe('not_met')
  })
  it('某校不满足只影响该学校对象，不过滤全国专业方向', () => {
    const evidence = admissionEvidenceFixture()
    evidence.scope.level = 'school'
    evidence.scope.schoolId = 1
    const noChemistry = { ...context, selectedSubjects: ['物理', '生物', '地理'] }
    expect(evaluateAdmissionEvidence([evidence], noChemistry, evidenceNow).status).toBe('unknown')
    expect(evaluateAdmissionEvidence([evidence], { ...noChemistry, schoolId: 1 }, evidenceNow).status).toBe('not_met')
    expect(evaluateAdmissionEvidence([evidence], { ...noChemistry, schoolId: 2 }, evidenceNow).status).toBe('unknown')
    expect(learningEvidenceSchema.safeParse({ ...evidence, scope: { ...evidence.scope, level: 'major' } }).success).toBe(false)
  })
  it.each(['learning_prerequisite', 'course_prerequisite', 'career_requirement'] as const)('%s 不转成高考选科过滤', kind => {
    const evidence = learningEvidenceFixture({ kind, content: '合成测试：需要数学基础' })
    expect(evaluateAdmissionEvidence([evidence], context, evidenceNow).status).toBe('unknown')
    expect(learningEvidenceSchema.safeParse({ ...evidence, condition: { type: 'subjects', mode: 'all', subjects: ['物理'] } }).success).toBe(false)
  })
  it('不同要求或明确冲突材料不能择优通过', () => {
    const first = admissionEvidenceFixture()
    const second = admissionEvidenceFixture({ id: '10000000-0000-4000-8000-000000000002', condition: { type: 'subjects', mode: 'any', subjects: ['物理', '化学'] } })
    expect(evaluateAdmissionEvidence([first, second], context, evidenceNow).status).toBe('conflicting')
    second.condition = first.condition
    second.review = { ...second.review, status: 'conflicting', conclusion: 'conflicting' }
    expect(evaluateAdmissionEvidence([first, second], context, evidenceNow).status).toBe('conflicting')
    second.review = { ...second.review, status: 'withdrawn', conclusion: 'withdrawn' }
    expect(evaluateAdmissionEvidence([first, second], context, evidenceNow).status).toBe('known')
  })
  it('请求学校/材料年缺失时明确缺口，其他实例保留真实范围', () => {
    const evidence = learningEvidenceFixture()
    const result = selectLearningMaterials([evidence], { schoolId: 2, sourceYear: 2026 }, evidenceNow)
    expect(result.status).toBe('missing')
    expect(result.evidence).toEqual([])
    expect(result.otherInstances[0]?.scope.schoolId).toBe(1)
    expect(result.otherInstances[0]?.source.year).toBe(2025)
    expect(selectLearningMaterials([evidence], { schoolId: 1, sourceYear: 2025 }, evidenceNow).evidence).toEqual([evidence])
  })
})
