import type { CurrentLearningFact, ExplorationCareerDirection, ExplorationMajorDetail } from './api'

export type MajorComparisonItem = {
  identity: ExplorationMajorDetail['identity']
  status: ExplorationMajorDetail['status']
  requestedScope: ExplorationMajorDetail['requestedScope']
  materialStatus: ExplorationMajorDetail['materialStatus']
  curriculum: CurrentLearningFact[]
  activities: CurrentLearningFact[]
  learningPrerequisites: CurrentLearningFact[]
  coursePrerequisites: CurrentLearningFact[]
  careers: ExplorationCareerDirection[]
  admission: ExplorationMajorDetail['admission']
  admissionFacts: CurrentLearningFact[]
  otherInstances: CurrentLearningFact[]
  dataGaps: string[]
  nextAction: string
  note: string | null
}

export function validateMajorSelection(ids: number[], purpose: 'comparison' | 'brief'): number[] {
  const minimum = purpose === 'comparison' ? 2 : 1
  const label = purpose === 'comparison' ? '专业比较请选择 2—3 个专业' : '专业简报请选择 1—3 个已关注专业'
  if (ids.length < minimum || ids.length > 3) throw new Error(label)
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('专业标识无效，请重新选择')
  if (new Set(ids).size !== ids.length) throw new Error('同一个专业不能重复选择')
  return [...ids]
}

// This is a display projection of the current detail API, not a new evidence
// review or eligibility rule. Other scopes remain separate from selected facts.
export function buildMajorComparison(details: ExplorationMajorDetail[]): MajorComparisonItem[] {
  validateMajorSelection(details.map(detail => detail.identity.id), 'comparison')
  return details.map(detail => {
    const available = detail.status === 'available'
    return {
      identity: { ...detail.identity }, status: detail.status,
      requestedScope: { ...detail.requestedScope }, materialStatus: detail.materialStatus,
      curriculum: available ? [...detail.facts.curriculum] : [],
      activities: available ? [...detail.facts.learning_activity] : [],
      learningPrerequisites: available ? [...detail.facts.learning_prerequisite] : [],
      coursePrerequisites: available ? [...detail.facts.course_prerequisite] : [],
      careers: available ? detail.careerDirections.map(direction => ({ ...direction,
        evidence: [...direction.evidence], requirements: [...direction.requirements] })) : [],
      admission: { ...detail.admission, evidence: [...detail.admission.evidence] },
      admissionFacts: available ? [...detail.facts.admission_requirement] : [],
      otherInstances: available ? [...detail.otherInstances] : [],
      dataGaps: [...detail.dataGaps], nextAction: detail.nextAction, note: detail.note,
    }
  })
}

export function learningFactSourceText(fact: CurrentLearningFact): string {
  const scope = [fact.school ? `${fact.school.name}的专业实例` : '专业范围', fact.scope.province,
    fact.scope.subjectGroup, fact.scope.admissionYear ? `${fact.scope.admissionYear} 年招生` : null]
    .filter(Boolean).join(' · ')
  const location = { page: '页码', section: '章节', anchor: '定位' }[fact.locator.kind]
  return `${scope} · ${fact.source.year} 年材料\n来源：${fact.source.title}｜${fact.source.publisher}\n${location}：${fact.locator.value}\n核验时间：${fact.review.reviewedAt ?? '待核验'}\n${fact.source.url}`
}
