export type ProfessionBand = '优先了解' | '值得比较' | '谨慎报考'
export type EvidenceReference = { title: string; publisher: string; sourceUrl: string; sourceYear: number; reviewedAt: string; validUntil: string }
export type FactorScore = { value: number | null; weight: number; evidence: string; reference?: EvidenceReference }
export type ProfessionInput = {
  id: number
  code: string
  name: string
  category: string
  requiredSubjects: string[]
  selectedSubjects: string[]
  jobCount: number
  provinceCount: number
  sourceCount: number
  directEntryRatio: number | null
  eligibleSchoolCount: number
  dailyJobCounts: number[]
  employmentUsable: boolean
  outlookScore: number | null
  outlookEvidence: string | null
  outlookReference?: EvidenceReference
  mode: 'exploration' | 'application'
}

export type ScoredProfession = ProfessionInput & {
  eligible: boolean
  totalScore: number | null
  evidenceCoverage: number
  factors: { coverage: FactorScore; directEntry: FactorScore; schoolAccess: FactorScore; stability: FactorScore; outlook: FactorScore }
  confidence: '低' | '中' | '高'
  band?: ProfessionBand
}

export function rankProfessions(inputs: ProfessionInput[]) {
  const scored = inputs.map(scoreProfession).filter(item => item.eligible).sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1) || b.evidenceCoverage - a.evidenceCoverage || a.code.localeCompare(b.code))
  return scored.slice(0, 9).map((item, index): ScoredProfession => ({
    ...item,
    band: index < 3 ? '优先了解' : index < 6 ? '值得比较' : '谨慎报考',
  }))
}

export function scoreProfession(input: ProfessionInput): ScoredProfession {
  const subjectEligible = input.requiredSubjects.every(subject => input.selectedSubjects.includes(subject))
  const eligible = subjectEligible
  const coverage = input.employmentUsable ? Math.min(100, Math.round(input.provinceCount / 31 * 100)) : null
  const directEntry = input.directEntryRatio == null ? null : Math.round(Math.max(0, Math.min(1, input.directEntryRatio)) * 100)
  const schoolAccess = input.mode === 'application' && input.eligibleSchoolCount > 0 ? Math.min(100, Math.round(input.eligibleSchoolCount / 6 * 100)) : null
  const stability = input.employmentUsable ? stabilityScore(input.dailyJobCounts, input.sourceCount) : null
  const factors = {
    coverage: { value: coverage, weight: 30, evidence: coverage == null ? '招聘数据已过期、不可用或来源不足' : `最近30天覆盖 ${input.provinceCount} 个省级地区、${input.jobCount} 个去重岗位` },
    directEntry: { value: directEntry, weight: 20, evidence: directEntry == null ? '尚无经过审核的岗位方向' : `审核岗位方向中，本科可直接尝试的比例为 ${directEntry}%` },
    schoolAccess: { value: schoolAccess, weight: 25, evidence: input.mode === 'exploration' ? '目标探索模式不计算位次可达院校' : schoolAccess == null ? '当前只有院校专业组投档线，尚不能证明该组包含此专业' : `当前位次范围内有 ${input.eligibleSchoolCount} 所具备专业交叉证据的院校` },
    stability: { value: stability, weight: 10, evidence: stability == null ? '最近30天趋势或来源数量不足' : `按每日岗位波动与 ${input.sourceCount} 个来源计算` },
    outlook: { value: input.outlookScore, weight: 15, evidence: input.outlookEvidence ?? '尚无有效期内的官方未来发展证据', reference: input.outlookReference },
  }
  const availableWeight = Object.values(factors).reduce((total, factor) => total + (factor.value == null ? 0 : factor.weight), 0)
  const weightedScore = Object.values(factors).reduce((total, factor) => total + (factor.value ?? 0) * factor.weight, 0)
  const evidenceCount = Object.values(factors).filter(factor => factor.value != null).length
  const totalScore = evidenceCount >= 2 && availableWeight >= 50 ? Math.round(weightedScore / availableWeight) : null
  const evidenceCoverage = availableWeight
  const confidence = evidenceCount === 5 && input.sourceCount >= 3 ? '高' : evidenceCount >= 3 ? '中' : '低'
  return { ...input, eligible, totalScore, evidenceCoverage, factors, confidence }
}

export function classifySingleYearRisk(candidateRank: number, referenceRank: number) {
  if (!Number.isFinite(candidateRank) || !Number.isFinite(referenceRank) || candidateRank <= 0 || referenceRank <= 0) return null
  const ratio = candidateRank / referenceRank
  const risk = ratio <= .80 ? '保' : ratio <= .95 ? '稳' : ratio <= 1.15 ? '冲' : null
  return risk ? { risk: risk as '冲'|'稳'|'保', confidence: '低' as const } : null
}

export function classifySchoolRisk(candidateRank: number, ranks: number[]) {
  const valid = ranks.filter(rank => Number.isFinite(rank) && rank > 0).sort((a, b) => a - b)
  if (valid.length < 2) return null
  const median = medianOf(valid)
  const mad = medianOf(valid.map(rank => Math.abs(rank - median)))
  const safetyMargin = Math.max(mad, Math.round(median * .05))
  const risk = candidateRank <= median - safetyMargin ? '保' : candidateRank <= median ? '稳' : candidateRank <= valid[valid.length - 1] ? '冲' : null
  return risk ? { risk: risk as '冲'|'稳'|'保', medianRank: Math.round(median), variability: Math.round(mad), confidence: valid.length >= 3 ? '高' as const : '低' as const } : null
}

function stabilityScore(counts: number[], sourceCount: number) {
  if (counts.length < 2 || sourceCount < 2) return null
  const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length
  if (!mean) return 0
  const variance = counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / counts.length
  const coefficient = Math.sqrt(variance) / mean
  return Math.max(0, Math.min(100, Math.round(100 - coefficient * 100)))
}

function medianOf(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
