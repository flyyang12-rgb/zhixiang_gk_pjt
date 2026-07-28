import { describe, expect, it } from 'vitest'
import { preflightAdmissionRows } from '../server/admission-import'

const source = {
  provinceId: 16, province: '河南', year: 2025, subjectGroup: '物理类', educationLevel: '本科' as const,
  admissionCategory: '普通类', batch: '普通本科批', planType: '普通计划', unitType: 'major_group' as const,
}

describe('招生导入预检', () => {
  it('逐行区分有效、重复、未匹配和拒绝并保持行数守恒', () => {
    const result = preflightAdmissionRows({
      source,
      schools: [{ id: 1, name: '河南大学' }],
      verifiedAliases: [{ alias: '河南大学郑州校区', schoolId: 1 }],
      rows: [
        { schoolName: '河南大学', unitName: '第01组', unitCode: '01', minRank: 20000 },
        { schoolName: '河南大学', unitName: '第01组', unitCode: '01', minRank: 20000 },
        { schoolName: '河南大学郑州校区', unitName: '第02组', unitCode: '02', minRank: 22000 },
        { schoolName: '河南人学', unitName: '第03组', unitCode: '03', minRank: 23000 },
        { schoolName: '河南大学', unitName: '', unitCode: '04', minRank: 0 },
      ],
    })

    expect(result.report).toEqual({ raw: 5, valid: 2, duplicate: 1, unmatched: 1, rejected: 1, insertable: 2 })
    expect(result.rows.map(row => row.status)).toEqual(['valid', 'duplicate', 'valid', 'unmatched', 'rejected'])
    expect(result.rows[3]?.reason).toBe('院校名称未通过正式名称或已核验别名匹配')
    expect(Object.values(result.report).slice(1, 5).reduce((sum, value) => sum + value, 0)).toBe(5)
  })
})
