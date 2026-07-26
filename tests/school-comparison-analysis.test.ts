import {describe,expect,it} from 'vitest'
import {isSafeComparisonAnswer} from '../server/advisor'

describe('院校 AI 对比边界',()=>{
  const schools=['大连理工大学','山东大学']
  it('接受三行简短且点名全部院校的分析',()=>{
    const answer='优先核对：大连理工大学与山东大学的当年专业组。\n关键差异：两校已核验的优势专业不同。\n填报风险：仍需复核招生计划和选科要求。'
    expect(isSafeComparisonAnswer(answer,schools)).toBe(true)
  })
  it('拒绝录取概率和遗漏院校的结论',()=>{
    const unsafe='优先核对：大连理工大学录取概率更高。\n关键差异：层次不同。\n填报风险：无。'
    expect(isSafeComparisonAnswer(unsafe,schools)).toBe(false)
  })
})
