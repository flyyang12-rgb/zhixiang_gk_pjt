import { describe, expect, it } from 'vitest'
import { buildProfessionInsights } from '../src/profession-insights'
import type { ProfessionCard } from '../src/api'

describe('专业三句解读', () => {
  it('只使用专业卡已有证据说明档位、路径和风险', () => {
    const card={name:'护理学',band:'优先了解',jobCount:72,provinceCount:25,schoolMatchStatus:'group_only',jobs:[{directEntry:true,requiresPostgraduate:false,requiresCertificate:true},{directEntry:false,requiresPostgraduate:true,requiresCertificate:false},{directEntry:true,requiresPostgraduate:false,requiresCertificate:false}],factors:{coverage:{value:81,evidence:'最近30天覆盖 25 个省级地区、72 个去重岗位'},directEntry:{value:67,evidence:'本科入口'},schoolAccess:{value:null,evidence:'当前只有院校专业组投档线'},stability:{value:70,evidence:'趋势稳定'}}} as ProfessionCard
    const result=buildProfessionInsights(card)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(expect.objectContaining({label:'为什么放在这组'}))
    expect(result[0].text).toContain('优先了解')
    expect(result[1].text).toContain('2 个方向本科毕业后就可以尝试')
    expect(result[2].text).toContain('专业组')
  })
})
