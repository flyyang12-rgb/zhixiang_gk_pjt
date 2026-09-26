import { describe, expect, it } from 'vitest'
import { buildMajorExplorationBrief, buildMajorExplorationBriefText } from '../src/major-exploration-brief'
import type { CurrentLearningFact, ExplorationMajorDetail } from '../src/api'
import { learningEvidenceFixture } from './fixtures/learning-evidence'

const generatedAt = '2026-09-26T08:30:00Z'
function detail(id = 1): ExplorationMajorDetail {
  const course: CurrentLearningFact = { ...learningEvidenceFixture({ majorId: id,
    id: `10000000-0000-4000-8000-${String(id * 10).padStart(12, '0')}`, content: `合成课程${id}` }),
    school: { id, name: `合成学校${id}` }, jobDirection: null }
  const career: CurrentLearningFact = { ...course, id: `10000000-0000-4000-8000-${String(id * 10 + 1).padStart(12, '0')}`,
    kind: 'career_direction', content: '合成职业培养方向，不能当就业保证',
    source: { ...course.source, year: 2024 }, jobDirectionId: 1, careerMappingStatus: 'approved',
    jobDirection: { id: 1, name: '合成职业方向' } }
  return { identity: { id, name: `合成专业${id}`, code: String(id), category: '合成类别' }, status: 'available',
    completeness: { complete: false, curriculum: 1, activities: 0, directions: 1, missing: ['学习活动材料待补充'] },
    requestedScope: { schoolId: null, sourceYear: null }, materialStatus: 'available',
    facts: { curriculum: [course], learning_activity: [], learning_prerequisite: [], course_prerequisite: [],
      career_direction: [career], career_requirement: [], admission_requirement: [] }, otherInstances: [],
    careerDirections: [{ id: 1, name: '合成职业方向', evidence: [career], requirements: [], requirementStatus: 'unknown' }], schoolExamples: [],
    admission: { status: 'unknown', evidenceIds: [], reason: '选科材料待核验，未知不表示不限', admissionYear: 2026, evidence: [] },
    unavailableEvidence: [], savedState: 'saved', note: '  第一行原始备注\n第二行保留空格  ',
    dataGaps: ['职业准入材料待补充'], nextAction: '核对合成培养方案所在章节', generatedAt }
}
function brief(details = [detail()], effectiveMode: 'exploration' | 'application' = 'exploration') {
  return buildMajorExplorationBrief({ studentName: '合成公开档案', generatedAt, effectiveMode, details })
}

describe('专业探索简报', () => {
  it('每专业最多两项实际学习或职业事实，保留当前材料标识、来源范围和原始备注', () => {
    const input = detail()
    input.facts.curriculum.push({ ...input.facts.curriculum[0]!, id: '10000000-0000-4000-8000-000000000013', content: '不会强行填入的第三条合成事实' })
    const before = JSON.stringify(input)
    const result = brief([input]), item = result.items[0]!
    expect(item.evidence).toHaveLength(2)
    expect(item.evidence.map(fact => fact.id)).toEqual([input.facts.curriculum[0]!.id, input.careerDirections[0]!.evidence[0]!.id])
    expect(item.sourceYears).toEqual([2024, 2025])
    expect(item.note).toBe('  第一行原始备注\n第二行保留空格  ')
    expect(item.unknown).toBe('职业准入材料待补充')
    expect(item.nextAction).toBe('核对合成培养方案所在章节')
    expect(JSON.stringify(input)).toBe(before)
    const text = buildMajorExplorationBriefText(result)
    expect(text).toContain('生成时间：2026-09-26T08:30:00Z')
    expect(text).toContain('2024 年材料'); expect(text).toContain('2025 年材料')
    expect(text).toContain('合成学校1的专业实例')
    expect(text).toContain('章节：合成课程章节')
    expect(text).toContain('https://test.example.edu/plan#curriculum')
    expect(text).toContain('家庭原始备注：  第一行原始备注\n第二行保留空格  \n下一步只做：')
    expect(text).not.toMatch(/总分|赢家|最适合|冲稳保|第三条合成事实/)
  })

  it('模式只看当前effectiveMode，获得位次后不再宣称没有可靠位次', () => {
    const exploring = buildMajorExplorationBriefText(brief())
    const application = buildMajorExplorationBriefText(brief([detail()], 'application'))
    expect(exploring).toContain('暂未形成可靠位次，当前只做专业探索')
    expect(application).toContain('招生判断另看当前位次与资格')
    expect(application).not.toContain('暂未形成可靠位次')
    expect(brief([detail()], 'application').mode).toBe('application')
  })

  it('重新生成撤回专业时保留身份和备注，但不引用上一轮有效事实', () => {
    const original = detail(), first = brief([original])
    const fresh = { ...original, identity: { ...original.identity, name: '合成专业新名称' },
      status: 'unavailable' as const, dataGaps: ['课程材料待补充', '材料已撤回，需要重新核验'],
      unavailableEvidence: [{ majorId: 1, evidenceId: original.facts.curriculum[0]!.id, kind: 'curriculum' as const,
        status: 'withdrawn' as const, scope: original.facts.curriculum[0]!.scope, sourceYear: 2025,
        reason: '材料已撤回，需要重新核验' }] }
    const regenerated = brief([fresh]), text = buildMajorExplorationBriefText(regenerated)
    expect(first.items[0]!.evidence).toHaveLength(2)
    expect(regenerated.items[0]).toMatchObject({ majorId: 1, name: '合成专业新名称', note: original.note, evidence: [], sourceYears: [] })
    expect(text).toContain('材料已撤回'); expect(text).not.toContain('合成课程1')
    expect(regenerated.items[0]!.unknown).toBe('材料已撤回，需要重新核验')
    expect(text).not.toContain('https://test.example.edu')
  })

  it('资料缺失时用零条实际事实，未知不补0或通用就业结论', () => {
    const empty = detail(); empty.status = 'pending'; empty.note = null
    empty.dataGaps = ['课程材料待补充']
    const result = brief([empty]), text = buildMajorExplorationBriefText(result)
    expect(result.items[0]!.evidence).toEqual([])
    expect(text).toContain('当前材料待补充或已不可用')
    expect(text).toContain('还没有家庭讨论备注')
    expect(text).not.toMatch(/0 分|前景好|适合你|本科可直接就业/)
  })

  it('仅使用当前已关注的1—3专业，数量/重复/已排除与无效时间明确失败', () => {
    expect(brief([detail(1), detail(2), detail(3)]).items).toHaveLength(3)
    for (const values of [[], [detail(1), detail(2), detail(3), detail(4)]]) expect(() => brief(values)).toThrow('1—3')
    expect(() => brief([detail(1), detail(1)])).toThrow('重复')
    for (const state of ['excluded', 'target', null] as const) expect(() => brief([{ ...detail(), savedState: state }])).toThrow('当前已关注')
    expect(() => buildMajorExplorationBrief({ studentName: '合成档案', effectiveMode: 'exploration', generatedAt: 'invalid', details: [detail()] })).toThrow('生成时间无效')
  })
})
