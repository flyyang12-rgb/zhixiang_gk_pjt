import {describe,expect,it} from 'vitest'
import {buildLocalComparisonAnalysis,isSafeComparisonAnswer} from '../server/advisor'

describe('院校 AI 对比边界',()=>{
  const schools=['大连理工大学','山东大学']
  it('接受四句简短、专业优先且点名全部院校的分析',()=>{
    const answer='我的建议：计算机证据更清楚时，我更建议大连理工大学，山东大学先别排前面。\n专业依据：大连理工大学有具体记录；山东大学暂时没有。\n最大风险：两校仍需核对冲稳保和专业组。\n下一步只做：核对今年的计算机招生目录。'
    expect(isSafeComparisonAnswer(answer,schools)).toBe(true)
  })
  it('拒绝录取概率和遗漏院校的结论',()=>{
    const unsafe='我的建议：大连理工大学录取概率更高。\n专业依据：层次不同。\n最大风险：无。\n下一步只做：直接填报。'
    expect(isSafeComparisonAnswer(unsafe,schools)).toBe(false)
  })

  it('没定目标专业时不为了显得大胆而硬选学校',()=>{
    const detail=(name:string)=>({school:{name},featuredMajors:[],admissionContext:{records:[]}})
    const answer=buildLocalComparisonAnalysis([detail('大连理工大学'),detail('山东大学')] as never)
    expect(answer).toContain('没定想学的专业')
    expect(answer).toContain('只按校名站队就是瞎报')
    expect(answer).toContain('下一步只做：先从收藏专业里定一个最想学的专业')
  })
})
