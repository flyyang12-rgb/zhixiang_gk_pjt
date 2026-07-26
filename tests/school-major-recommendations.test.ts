import {describe,expect,it} from 'vitest'
import {orientationRecommendations} from '../server/school-major-recommendations'

describe('学校专业推荐兜底',()=>{
  it('从明确办学方向给出待核验建议且不冒充官方认定',()=>{
    const items=orientationRecommendations('某某医科大学','https://example.edu.cn/')
    expect(items.map(item=>item.name)).toEqual(['临床医学方向','医学技术方向','护理学方向'])
    expect(items.every(item=>item.evidenceLevel==='orientation'&&item.basis.includes('并非官方优势专业认定'))).toBe(true)
  })

  it('普通校名仍提供通用探索方向并强调核验',()=>{
    const items=orientationRecommendations('某某大学',null)
    expect(items).toHaveLength(3)
    expect(items.every(item=>item.sourceUrl===null&&item.basis.includes('须先核对'))).toBe(true)
  })
})
