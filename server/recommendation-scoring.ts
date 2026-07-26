export type DecisionFactor = 'majorFit' | 'schoolLevel' | 'career' | 'city' | 'cost' | 'distance'
export type DecisionWeights = Record<DecisionFactor, number>

export const defaultDecisionWeights: DecisionWeights = {
  majorFit: 25,
  schoolLevel: 25,
  career: 20,
  city: 15,
  cost: 10,
  distance: 5,
}

export function scoreCandidate(input: { level: string; hasMatchingMajor: boolean }, weights: DecisionWeights) {
  const components: Record<DecisionFactor, number> = {
    majorFit: input.hasMatchingMajor ? 85 : 50,
    schoolLevel: input.level === '985' ? 95 : input.level === '211' ? 85 : input.level === '本科' ? 65 : 45,
    career: 50,
    city: 50,
    cost: 50,
    distance: 50,
  }
  const ruleScore = Math.round(Object.entries(weights).reduce(
    (total, [factor, weight]) => total + components[factor as DecisionFactor] * weight / 100,
    0,
  ))
  return { ruleScore, components }
}
