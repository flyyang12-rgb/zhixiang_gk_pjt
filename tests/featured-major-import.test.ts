import { describe,expect,test } from 'vitest'
import { prepareFeaturedMajorRecord } from '../scripts/featured-major-import-policy.js'

describe('官方优势专业导入边界',()=>{
  test('规范化完整证据并形成稳定业务键',()=>{
    const record=prepareFeaturedMajorRecord({schoolName:' 山东大学 ',majorName:'物理学',recognitionType:'国家级一流本科专业建设点',recognitionYear:2021,sourceYear:2021,sourceUrl:'https://www.moe.gov.cn/example',publisher:'教育部',verifiedAt:'2026-07-25T00:00:00.000Z'})
    expect(record.businessKey).toBe('山东大学\u0000物理学\u0000国家级一流本科专业建设点\u00002021')
    expect(record.sourceUrl).toBe('https://www.moe.gov.cn/example')
  })

  test('拒绝无官方证据、无年份和不可映射的猜测输入',()=>{
    expect(()=>prepareFeaturedMajorRecord({schoolName:'示例大学',majorName:'计算机类',recognitionType:'优势专业',recognitionYear:0,sourceYear:2021,sourceUrl:'http://marketing.example/rank',publisher:'某排名',verifiedAt:'invalid'})).toThrow()
  })
})
