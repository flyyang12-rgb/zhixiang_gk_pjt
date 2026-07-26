import { describe, expect, it } from 'vitest'
import { classifySchoolRisk, classifySingleYearRisk, rankProfessions, scoreProfession, type ProfessionInput } from '../server/profession-engine'
import { subjectRequirementSatisfied } from '../server/admission-candidates'

const base: ProfessionInput = { id: 1, code: '080901', name: '计算机科学与技术', category: '工学', requiredSubjects: ['物理'], selectedSubjects: ['物理','化学','生物'], jobCount: 1200, provinceCount: 28, sourceCount: 3, directEntryRatio: 1, eligibleSchoolCount: 6, dailyJobCounts: [100,102,98], employmentUsable: true, mode: 'application' }

describe('专业就业规则引擎', () => {
  it('专业硬过滤只依据选科，缺少专业院校交叉证据不会清空专业', () => {
    expect(scoreProfession({ ...base, selectedSubjects: ['历史','政治','地理'] }).eligible).toBe(false)
    expect(scoreProfession({ ...base, eligibleSchoolCount: 0 }).eligible).toBe(true)
    expect(scoreProfession({ ...base, eligibleSchoolCount: 0 }).factors.schoolAccess.value).toBeNull()
    expect(scoreProfession({ ...base, mode: 'exploration', eligibleSchoolCount: 0 }).eligible).toBe(true)
  })

  it('使用固定四因子权重并披露缺失证据', () => {
    const result = scoreProfession(base)
    expect(result.factors.coverage.weight).toBe(40)
    expect(result.factors.directEntry.weight).toBe(25)
    expect(result.factors.schoolAccess.weight).toBe(25)
    expect(result.factors.stability.weight).toBe(10)
    expect(scoreProfession({ ...base, employmentUsable: false }).factors.coverage.value).toBeNull()
    expect(scoreProfession({ ...base, eligibleSchoolCount: 0 }).evidenceCoverage).toBe(75)
    expect(scoreProfession({ ...base, eligibleSchoolCount: 0 }).totalScore).toBeGreaterThan(70)
  })

  it('最多输出九个并按3/3/3分档', () => {
    const results = rankProfessions(Array.from({ length: 12 }, (_, index) => ({ ...base, id: index + 1, code: String(index), eligibleSchoolCount: 12 - index })))
    expect(results).toHaveLength(9)
    expect(results.filter(item => item.band === '优先了解')).toHaveLength(3)
    expect(results.filter(item => item.band === '值得比较')).toHaveLength(3)
    expect(results.filter(item => item.band === '谨慎报考')).toHaveLength(3)
  })

  it('学校风险使用中位位次与波动而非简单平均', () => {
    expect(classifySchoolRisk(8000, [10000,11000,9000])?.risk).toBe('保')
    expect(classifySchoolRisk(10000, [10000,11000,9000])?.risk).toBe('稳')
    expect(classifySchoolRisk(10500, [10000,11000,9000])?.risk).toBe('冲')
    expect(classifySchoolRisk(10000, [10000])).toBeNull()
  })

  it('河南单年专业组只在保守边界内生成低置信冲稳保', () => {
    expect(classifySingleYearRisk(8000, 10000)).toEqual({ risk: '保', confidence: '低' })
    expect(classifySingleYearRisk(9000, 10000)).toEqual({ risk: '稳', confidence: '低' })
    expect(classifySingleYearRisk(10500, 10000)).toEqual({ risk: '冲', confidence: '低' })
    expect(classifySingleYearRisk(11500, 10000)).toEqual({ risk: '冲', confidence: '低' })
    expect(classifySingleYearRisk(11501, 10000)).toBeNull()
  })

  it('专业组选科要求必须由考生选科完整满足',()=>{
    expect(subjectRequirementSatisfied('不限',['物理','化学','生物'])).toBe(true)
    expect(subjectRequirementSatisfied('化学和生物',['物理','化学','生物'])).toBe(true)
    expect(subjectRequirementSatisfied('化学和生物',['物理','化学','地理'])).toBe(false)
  })
})
