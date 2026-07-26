import {describe,expect,it} from 'vitest'
import {parseAdvisorTransparency,plainAdvisorText} from '../src/advisor-transparency'

describe('顾问透明三句话展示',()=>{
  it('从历史消息文本中拆出三行和补充说明',()=>{
    expect(parseAdvisorTransparency('现在能确定：有两年记录。\r\n现在还不能确定：今年专业目录未知。\r\n下一步只做：查看今年招生目录。\r\n\r\n学校线不能代替专业线。')).toEqual({
      confirmed:'有两年记录。',
      unknown:'今年专业目录未知。',
      nextStep:'查看今年招生目录。',
      detail:'学校线不能代替专业线。',
    })
  })

  it('普通聊天不被误识别为透明回答',()=>{
    expect(parseAdvisorTransparency('你好，我在。直接说你拿不准的事。')).toBeNull()
    expect(parseAdvisorTransparency('现在能确定：只有一行。')).toBeNull()
  })

  it('旧消息中的 Markdown 标记按纯文本显示',()=>{
    expect(plainAdvisorText('**你现在最想学什么专业？** 告诉我。')).toBe('你现在最想学什么专业？ 告诉我。')
    expect(plainAdvisorText('## 先说结论\n```文字```')).toBe('先说结论\n文字')
  })
})
