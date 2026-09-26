import type { CurrentLearningFact, ExplorationMajorDetail } from './api'
import { learningFactSourceText, validateMajorSelection } from './major-comparison'

export type MajorExplorationBriefItem = {
  majorId: number
  name: string
  code: string
  state: 'saved'
  status: ExplorationMajorDetail['status']
  evidence: CurrentLearningFact[]
  sourceYears: number[]
  unknown: string
  note: string | null
  nextAction: string
}
export type MajorExplorationBrief = {
  studentName: string
  generatedAt: string
  mode: 'exploration' | 'application'
  modeNote: string
  items: MajorExplorationBriefItem[]
}

export function buildMajorExplorationBrief(input: {
  studentName: string
  effectiveMode: MajorExplorationBrief['mode']
  generatedAt: string
  details: ExplorationMajorDetail[]
}): MajorExplorationBrief {
  validateMajorSelection(input.details.map(detail => detail.identity.id), 'brief')
  if (input.details.some(detail => detail.savedState !== 'saved')) throw new Error('专业简报只使用当前已关注的专业，请返回收藏重新选择')
  if (!Number.isFinite(new Date(input.generatedAt).getTime())) throw new Error('简报生成时间无效，请重新生成')
  if (!['exploration', 'application'].includes(input.effectiveMode)) throw new Error('当前模式无法确认，请重新生成')
  const items = input.details.map(detail => {
    const evidence: CurrentLearningFact[] = []
    if (detail.status === 'available') {
      // One learning fact and one career fact when available; remaining slots
      // follow the API's order. This is a compact citation selection, not a rank.
      const careerFacts = detail.careerDirections.flatMap(direction => direction.evidence)
      const candidates = [detail.facts.curriculum[0], careerFacts[0], detail.facts.learning_activity[0],
        ...detail.facts.curriculum, ...detail.facts.learning_activity, ...careerFacts]
      for (const fact of candidates) {
        if (fact && !evidence.some(item => item.id === fact.id)) evidence.push(fact)
        if (evidence.length === 2) break
      }
    }
    const unavailableReason = detail.status === 'unavailable'
      ? detail.unavailableEvidence.find(gap => gap.status !== 'pending')?.reason || detail.unavailableEvidence[0]?.reason
      : null
    const unknown = unavailableReason || detail.dataGaps[0] || (detail.admission.status !== 'known' ? detail.admission.reason : '') ||
      '这些材料不能确认个人学习意愿或毕业去向。'
    return { majorId: detail.identity.id, name: detail.identity.name, code: detail.identity.code,
      state: 'saved' as const, status: detail.status, evidence,
      sourceYears: [...new Set(evidence.map(fact => fact.source.year))].sort(),
      unknown, note: detail.note, nextAction: detail.nextAction }
  })
  return { studentName: input.studentName, generatedAt: input.generatedAt, mode: input.effectiveMode,
    modeNote: input.effectiveMode === 'exploration' ? '暂未形成可靠位次，当前只做专业探索。'
      : '当前材料用于专业探索，招生判断另看当前位次与资格。', items }
}

export function buildMajorExplorationBriefText(brief: MajorExplorationBrief): string {
  const lines = ['专业探索简报', `公开档案：${brief.studentName}`, `生成时间：${brief.generatedAt}`, brief.modeNote]
  for (const item of brief.items) {
    lines.push('', `${item.name}（${item.code}）`, '关注状态：已关注')
    if (!item.evidence.length) lines.push('学习 / 职业依据：当前材料待补充或已不可用，不补造事实。')
    for (const fact of item.evidence) lines.push(`依据：${fact.content}`, learningFactSourceText(fact))
    lines.push(`主要未知：${item.unknown}`, `家庭原始备注：${item.note === null ? '还没有家庭讨论备注' : item.note}`,
      `下一步只做：${item.nextAction}`)
  }
  lines.push('', '培养材料仅适用于所注明的学校与年份；本简报用于家庭讨论，不构成录取或就业承诺。')
  return lines.join('\n')
}
