import { describe, expect, it } from 'vitest'
import { describeScoreTrend } from '../src/score-trend'
import { buildFamilyBrief, buildFamilyBriefText } from '../src/family-brief'

describe('家庭陪跑',()=>{
  it('只用可比位次描述变化，不平均分数',()=>{
    expect(describeScoreTrend([{score:500,provinceRank:120000},{score:530,provinceRank:90000}])).toBe('位次前进 30,000 名')
    expect(describeScoreTrend([{score:500,provinceRank:null},{score:540,provinceRank:null}])).toBe('只有分数：不同考试难度不可直接比较')
  })

  it('目标探索简报不伪装成报考结论',()=>{
    const brief=buildFamilyBrief({profileSummary:{planningMode:'exploration',province:'河南',subjectGroup:'物理类',score:530,provinceRank:90000},schools:[{name:'测试大学',city:'郑州',level:'本科',featuredMajors:['计算机科学与技术'],admission:null,officialUrl:true,admissionsUrl:false,note:'弟弟愿意学编程'}]})
    expect(brief[0].stance).toContain('等可靠位次后再判断报考位置')
    expect(brief[0].risk).toContain('可比招生记录')
    const text=buildFamilyBriefText(brief)
    expect(text).toContain('弟弟愿不愿学四年')
    expect(text).not.toContain('录取概率')
  })
})
