import { describe, expect, it } from 'vitest'
import { buildMajorComparison, learningFactSourceText, validateMajorSelection } from '../src/major-comparison'
import type { CurrentLearningFact, ExplorationMajorDetail } from '../src/api'
import { learningEvidenceFixture } from './fixtures/learning-evidence'

function detail(id: number): ExplorationMajorDetail {
  const course: CurrentLearningFact = { ...learningEvidenceFixture({ majorId: id,
    id: `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`, content: `合成课程${id}` }),
    school: { id, name: `合成学校${id}` }, jobDirection: null }
  return { identity: { id, name: `合成专业${id}`, code: String(id), category: '合成类别' }, status: 'available',
    completeness: { complete: false, curriculum: 1, activities: 0, directions: 0, missing: ['学习活动材料待补充', '职业方向材料待补充'] },
    requestedScope: { schoolId: null, sourceYear: null }, materialStatus: 'available',
    facts: { curriculum: [course], learning_activity: [], learning_prerequisite: [], course_prerequisite: [],
      career_direction: [], career_requirement: [], admission_requirement: [] }, otherInstances: [], careerDirections: [], schoolExamples: [],
    admission: { status: 'unknown', evidenceIds: [], reason: '合成学校和当年范围的选科要求未知，不表示不限', admissionYear: 2026, evidence: [] },
    unavailableEvidence: [], savedState: 'saved', note: '原始合成备注', dataGaps: ['学习活动材料待补充'],
    nextAction: '核对合成材料章节', generatedAt: '2026-09-26T00:00:00Z' }
}

describe('专业比较的当前材料投影', () => {
  it('保留选择顺序、事实标识与逐条学校、年份和定位，不生成排序或分数', () => {
    const inputs = [detail(2), detail(1), detail(3)]
    const before = JSON.stringify(inputs)
    const result = buildMajorComparison(inputs)
    expect(result.map(item => item.identity.id)).toEqual([2, 1, 3])
    expect(result[0]!.curriculum[0]).toBe(inputs[0]!.facts.curriculum[0])
    expect(result[0]!.curriculum[0]).toMatchObject({ id: inputs[0]!.facts.curriculum[0]!.id,
      school: { name: '合成学校2' }, source: { year: 2025 }, locator: { value: '合成课程章节' } })
    for (const item of result) {
      expect(item).not.toHaveProperty('score'); expect(item).not.toHaveProperty('winner'); expect(item).not.toHaveProperty('rank')
    }
    expect(JSON.stringify(inputs)).toBe(before)
  })

  it('缺字段保留为空与具体缺口，课程先修不转为高考选科要求', () => {
    const first = detail(1)
    const prerequisite = { ...first.facts.curriculum[0]!, kind: 'course_prerequisite' as const,
      content: '合成大学课程先修要求' }
    first.facts.course_prerequisite = [prerequisite]
    const result = buildMajorComparison([first, detail(2)])[0]!
    expect(result.activities).toEqual([])
    expect(result.careers).toEqual([])
    expect(result.admissionFacts).toEqual([])
    expect(result.coursePrerequisites[0]!.kind).toBe('course_prerequisite')
    expect(result.admission.status).toBe('unknown')
    expect(result.dataGaps).toContain('学习活动材料待补充')
    expect(result).not.toHaveProperty('directEntryScore')
  })

  it('指定范围缺失时不把其他学校或年份事实放进主字段', () => {
    const first = detail(1), oldCourse = first.facts.curriculum[0]!
    first.requestedScope = { schoolId: 2, sourceYear: 2026 }
    first.materialStatus = 'missing'; first.facts.curriculum = []; first.otherInstances = [oldCourse]
    first.dataGaps = ['指定学校或材料年份缺失']
    const result = buildMajorComparison([first, detail(2)])[0]!
    expect(result.requestedScope).toEqual({ schoolId: 2, sourceYear: 2026 })
    expect(result.curriculum).toEqual([])
    expect(result.otherInstances).toEqual([oldCourse])
    expect(result.otherInstances[0]!.source.year).toBe(2025)
    expect(result.dataGaps).toContain('指定学校或材料年份缺失')
  })

  it('已失效或待补充的响应不继续把旧事实当比较依据，名称修订仍按原ID', () => {
    const first = detail(1)
    first.identity.name = '合成专业修订名'; first.status = 'unavailable'
    first.dataGaps = ['材料已撤回，需要重新核验']
    const result = buildMajorComparison([first, { ...detail(2), status: 'pending' }])
    expect(result[0]!.identity).toMatchObject({ id: 1, name: '合成专业修订名' })
    expect(result.flatMap(item => item.curriculum)).toEqual([])
    expect(JSON.stringify(result)).not.toContain('合成课程1')
    expect(result[0]!.dataGaps).toContain('材料已撤回，需要重新核验')
  })

  it('复制来源保持URL锚点、章节与材料年，单校范围不提升为全国要求', () => {
    const fact = detail(1).facts.curriculum[0]!
    fact.scope = { level: 'school', schoolId: 1, province: '河南', subjectGroup: '物理类', admissionYear: 2026 }
    const text = learningFactSourceText(fact)
    expect(text).toContain('合成学校1的专业实例 · 河南 · 物理类 · 2026 年招生 · 2025 年材料')
    expect(text).toContain('章节：合成课程章节')
    expect(text).toContain('https://test.example.edu/plan#curriculum')
    expect(text).not.toContain('全国统一')
  })
})

describe('专业选择边界', () => {
  it('比较限定2—3个不同有效专业，数量或标识错误都有明确反馈', () => {
    expect(validateMajorSelection([1, 2], 'comparison')).toEqual([1, 2])
    expect(validateMajorSelection([1, 2, 3], 'comparison')).toEqual([1, 2, 3])
    for (const ids of [[], [1], [1, 2, 3, 4]]) expect(() => validateMajorSelection(ids, 'comparison')).toThrow('2—3')
    expect(() => validateMajorSelection([1, 1], 'comparison')).toThrow('重复')
    for (const invalid of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => validateMajorSelection([1, invalid], 'comparison')).toThrow('标识无效')
  })
})
