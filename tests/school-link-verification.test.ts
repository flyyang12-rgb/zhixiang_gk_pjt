import { describe, expect, test } from 'vitest'
import { extractAdmissionsCandidates, extractSchoolWebsiteRows, pageConfirmsSchool } from '../scripts/school-link-verification.js'
import { prepareLinkRecord } from '../scripts/school-link-import-policy.js'

describe('院校官网链接核验', () => {
  test('学校页面必须明确出现完整校名', () => {
    expect(pageConfirmsSchool('河南牧业经济学院', '<html><title>河南牧业经济学院</title><body>学校首页</body></html>')).toBe(true)
    expect(pageConfirmsSchool('河南牧业经济学院', '<html><title>访问受限</title><body>系统提示</body></html>')).toBe(false)
  })

  test('只提取普通本科招生入口并排除研究生与继续教育', () => {
    const html = `<a href="/graduate">研究生招生</a><a href="https://zhaosheng.hnuahe.edu.cn/">招生信息</a><a href="/news">招生信息</a><a href="/jxjy">继续教育招生</a>`
    expect(extractAdmissionsCandidates(html, 'https://www.hnuahe.edu.cn/')).toEqual(['https://zhaosheng.hnuahe.edu.cn/'])
  })

  test('省级学校表格按完整校名提取官网候选', () => {
    const html='<table><tr><td>河南牧业经济学院</td><td><a class="external" href="https://www.hnuahe.edu.cn/">官方网站</a></td></tr></table>'
    expect(extractSchoolWebsiteRows(html,['河南牧业经济学院'])).toEqual(new Map([['河南牧业经济学院','https://www.hnuahe.edu.cn/']]))
  })
})

describe('院校链接安全导入边界',()=>{
  test('核验失败时不会形成可执行的数据库更新',async()=>{
    let mutations=0
    await expect(prepareLinkRecord({schoolName:'示例大学',officialUrl:'https://invalid.example/',sourceUrl:'https://source.example/'},async()=>{throw new Error('无法核验')})).rejects.toThrow('无法核验')
    expect(mutations).toBe(0)
  })

  test('同一条已核验输入可重复规范化且不会清空缺失字段',async()=>{
    const input={schoolName:' 示例大学 ',officialUrl:'https://example.edu.cn',sourceUrl:'https://example.edu.cn',verifiedAt:'2026-07-25T00:00:00.000Z'}
    const first=await prepareLinkRecord(input,async()=>{})
    const second=await prepareLinkRecord(input,async()=>{})
    expect({...first,verifiedAt:first.verifiedAt.toISOString()}).toEqual({...second,verifiedAt:second.verifiedAt.toISOString()})
    expect(first.admissionsUrl).toBeNull()
  })
})
