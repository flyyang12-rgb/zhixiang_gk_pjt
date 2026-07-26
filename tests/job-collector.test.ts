import { describe, expect, it } from 'vitest'
import { matchDirection, postingFingerprint } from '../server/job-collector'

describe('招聘采集标准化', () => {
  it('同公司、方向、城市、学历和日期生成稳定指纹', () => {
    const base = { employer: '示例科技有限公司', directionId: 2, city: '郑州', education: '本科', publishedAt: '2026-07-20' }
    expect(postingFingerprint(base)).toBe(postingFingerprint({ ...base, employer: ' 示例科技有限公司 ' }))
    expect(postingFingerprint(base)).not.toBe(postingFingerprint({ ...base, city: '武汉' }))
  })

  it('只使用人工审核别名匹配岗位方向', () => {
    const directions = [{ id: 1, aliases: ['软件工程师', '后端开发'] }, { id: 2, aliases: ['会计', '财务核算'] }]
    expect(matchDirection('高级后端开发工程师', directions)).toBe(1)
    expect(matchDirection('销售工程师', directions)).toBeNull()
  })
})
