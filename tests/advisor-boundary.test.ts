import { describe, expect, it } from 'vitest'
import { isSafeAdvisorAnswer } from '../server/advisor'

const valid = '这个担心很实际。\n【先说结论】仅解释卡片。\n【为什么这么说】规则证据。\n【这事最容易踩的坑】数据不足。\n【接下来怎么查】核对官网。'

describe('顾问输出边界', () => {
  it('接受包含完整解释结构且无概率承诺的回答', () => expect(isSafeAdvisorAnswer(valid)).toBe(true))
  it('院校焦点回答必须明确包含对应院校名称',()=>{
    expect(isSafeAdvisorAnswer(valid,'山东大学')).toBe(false)
    expect(isSafeAdvisorAnswer(`${valid}\n山东大学`,'山东大学')).toBe(true)
  })
  it.each(['录取概率较高','概率很高','确保有学上','一定能录取'])('拒绝越界措辞：%s', phrase => expect(isSafeAdvisorAnswer(`${valid}\n${phrase}`)).toBe(false))
})
