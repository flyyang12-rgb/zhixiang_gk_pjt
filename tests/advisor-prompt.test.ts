import {describe,expect,it} from 'vitest'
import {buildConversationMemory,buildModelMessages,isSafeAdvisorAnswer,isTransparentAdvisorAnswer} from '../server/advisor-prompt'

describe('顾问连续记忆与表达边界',()=>{
  it('模型上下文带上摘要和最近 16 条原始消息',()=>{
    const history=Array.from({length:20},(_,index)=>({id:index+1,role:(index%2?'assistant':'user') as 'user'|'assistant',content:`第${index+1}条内容`}))
    const memory=buildConversationMemory('家里能承担四年本科',history)
    expect(memory.recent).toHaveLength(16)
    expect(memory.recent[0].content).toBe('第5条内容')
    expect(memory.summary).toContain('家里能承担四年本科')
    expect(memory.summary).toContain('第1条内容')
    const messages=buildModelMessages({methodology:'安全方法论',facts:{profile:{province:'河南'}},memory,currentMessage:'那它呢？'})
    expect(messages[0].content).toContain('savedItems.note')
    expect(messages[0].content).toContain('不得用趋势推断高考分数')
    expect(messages.some(item=>item.content.includes('当前数据库事实优先'))).toBe(true)
    expect(messages.some(item=>item.content.includes('事实和推断必须分开'))).toBe(true)
    expect(messages.some(item=>item.content.includes('任何年份、位次、分数、数量或比例都必须来自当前本地事实'))).toBe(true)
    expect(messages.some(item=>item.content.includes('先下判断，再摆事实'))).toBe(true)
    expect(messages.some(item=>item.content.includes('可以骂选择瞎、策略蠢、宣传扯淡，但不能骂提问的人'))).toBe(true)
    expect(messages.at(-1)).toEqual({role:'user',content:'那它呢？'})
  })

  it('允许尖锐批评选择，拒绝真人扮演、家庭羞辱和承诺',()=>{
    const safe='这个担心很实际。\n【先说结论】这个选择风险很大，别被宣传话术牵着走。\n【为什么这么说】当前证据不足。\n【这事最容易踩的坑】把少数成功案例当成普遍结果。\n【接下来怎么查】核对当年章程。'
    expect(isSafeAdvisorAnswer(safe)).toBe(true)
    for(const unsafe of ['我就是张雪峰','穷人别谈理想','打晕也别报','一定能录取','去看 https://example.com','综合参考分 87','低置信度'])expect(isSafeAdvisorAnswer(`${safe}\n${unsafe}`)).toBe(false)
  })

  it('自然分段的完整回答不再被四段标题绑架',()=>{
    const answer='这所学校能看，但别只看校名。离家近只能省一点生活成本，专业不对口，四年照样难熬。你最想学什么专业？'
    expect(isSafeAdvisorAnswer(answer)).toBe(true)
  })

  it('透明回答必须三行完整、纯文本且只有一个下一步',()=>{
    const valid='现在能确定：当前有两年可比招生记录。\n现在还不能确定：今年专业组是否仍包含计算机。\n下一步只做：查看今年招生专业目录。\n\n学校线能过，不等于一定能进计算机。'
    expect(isTransparentAdvisorAnswer(valid)).toBe(true)
    expect(isTransparentAdvisorAnswer(valid.replace('现在还不能确定：今年专业组是否仍包含计算机。\n',''))).toBe(false)
    expect(isTransparentAdvisorAnswer(valid.replace('当前有两年可比招生记录。','**当前有两年可比招生记录。**'))).toBe(false)
    expect(isTransparentAdvisorAnswer(valid.replace('查看今年招生专业目录。','1. 查目录；2. 算学费。'))).toBe(false)
  })
})
