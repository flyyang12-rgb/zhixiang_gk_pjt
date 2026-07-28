import { describe, expect, it } from 'vitest'
import { describeScoreTrend } from '../src/score-trend'
import { buildFamilyBrief, buildFamilyBriefText } from '../src/family-brief'
import {calculatePlanningCoordinate} from '../server/planning-coordinate'

describe('家庭陪跑',()=>{
  it('只用可比位次描述变化，不平均分数',()=>{
    expect(describeScoreTrend([{score:500,provinceRank:120000},{score:530,provinceRank:90000}])).toBe('位次前进 30,000 名')
    expect(describeScoreTrend([{score:500,provinceRank:null},{score:540,provinceRank:null}])).toBe('只有分数：不同考试难度不可直接比较')
  })

  it('最近五次位次取中位数，异常单次不直接改写规划坐标',()=>{
    expect(calculatePlanningCoordinate([9122,9999])).toMatchObject({rank:9561,sampleCount:2,stability:'preliminary'})
    expect(calculatePlanningCoordinate([100000,9000,10000])).toMatchObject({rank:10000,sampleCount:3,bestRank:9000,worstRank:100000,stability:'volatile'})
    expect(calculatePlanningCoordinate([11000,10500,10000,9500,9000,1])).toMatchObject({rank:10000,sampleCount:5})
  })

  it('目标探索简报不伪装成报考结论',()=>{
    const brief=buildFamilyBrief({planningRank:null,profileSummary:{planningMode:'exploration',province:'河南',subjectGroup:'物理类',score:530,provinceRank:null},schools:[{id:1,name:'测试大学',city:'郑州',level:'本科',featuredMajors:['计算机科学与技术'],admission:null,officialUrl:true,admissionsUrl:false,note:'弟弟愿意学编程'}]})
    expect(brief[0].stance).toContain('等可靠位次后再判断报考位置')
    expect(brief[0].risk).toContain('可比招生记录')
    const text=buildFamilyBriefText(brief)
    expect(text).toContain('弟弟愿不愿学四年')
    expect(text).not.toContain('录取概率')
  })

  it('目标探索档案有规划位次后简报可以讨论学校历史位置',()=>{
    const brief=buildFamilyBrief({planningRank:12000,profileSummary:{planningMode:'exploration',province:'山东',subjectGroup:'综合改革',score:620,provinceRank:null},schools:[{id:2,name:'示例大学',city:'济南',level:'本科',featuredMajors:[],admission:{year:2025,risk:'稳',minRank:12500},officialUrl:true,admissionsUrl:true,note:null}]})
    expect(brief[0].stance).toContain('可以比较')
    expect(brief[0].stance).toContain('稳')
    expect(brief[0].stance).not.toContain('等可靠位次')
  })
})
