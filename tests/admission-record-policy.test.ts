import { describe, expect, it } from 'vitest'
import { buildAdmissionRecordKey, recommendationEligibility } from '../server/admission-record-policy'

const base = {
  schoolId: 101,
  provinceId: 16,
  year: 2025,
  subjectGroup: '物理类',
  educationLevel: '本科' as const,
  admissionCategory: '普通类',
  batch: '普通本科批',
  planType: '普通计划',
  unitType: 'major_group' as const,
  unitCode: '03',
  rawUnitName: '第03组（化学）',
}

describe('招生事实业务口径', () => {
  it('同校同年不同批次或招生单元具有不同稳定业务键', () => {
    const key = buildAdmissionRecordKey(base)
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(buildAdmissionRecordKey({ ...base })).toBe(key)
    expect(buildAdmissionRecordKey({ ...base, batch: '本科提前批' })).not.toBe(key)
    expect(buildAdmissionRecordKey({ ...base, unitCode: '04' })).not.toBe(key)
  })

  it('只有普通类主批次且有可靠位次的记录可参与自动推荐', () => {
    expect(recommendationEligibility({ admissionCategory: '普通类', batch: '普通本科批', planType: '普通计划', minRank: 32000 })).toEqual({ eligible: true, reason: null })
    expect(recommendationEligibility({ admissionCategory: '普通类', batch: '本科提前批', planType: '普通计划', minRank: 32000 })).toEqual({ eligible: false, reason: '特殊批次仅供浏览' })
    expect(recommendationEligibility({ admissionCategory: '普通类', batch: '普通本科批', planType: '国家专项', minRank: 32000 })).toEqual({ eligible: false, reason: '资格计划仅供浏览' })
    expect(recommendationEligibility({ admissionCategory: '普通类', batch: '普通本科批', planType: '普通计划', minRank: null })).toEqual({ eligible: false, reason: '缺少可靠最低位次' })
  })
})
