import { describe, expect, it } from 'vitest'
import { defaultDecisionWeights, scoreCandidate } from '../server/recommendation-scoring'

describe('候选规则评分', () => {
  it('明确返回规则分而不是概率，并让专业匹配影响结果', () => {
    const matched = scoreCandidate({ level: '本科', hasMatchingMajor: true }, defaultDecisionWeights)
    const unmatched = scoreCandidate({ level: '本科', hasMatchingMajor: false }, defaultDecisionWeights)
    expect(matched.ruleScore).toBeGreaterThan(unmatched.ruleScore)
    expect(matched.ruleScore).toBeLessThanOrEqual(100)
  })

  it('使用家庭确认的学校层次权重', () => {
    const weights = { majorFit: 0, schoolLevel: 100, career: 0, city: 0, cost: 0, distance: 0 }
    expect(scoreCandidate({ level: '985', hasMatchingMajor: false }, weights).ruleScore).toBeGreaterThan(
      scoreCandidate({ level: '本科', hasMatchingMajor: true }, weights).ruleScore,
    )
  })
})
