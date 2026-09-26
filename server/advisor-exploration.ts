import type { ExplorationMajorDetail } from './major-exploration.js'
import type { CurrentLearningFact } from './learning-evidence-repository.js'

export class AdvisorMaterialLookupError extends Error {
  constructor(readonly status: 422, message: string) { super(message) }
}

export type LearningReplyKind = 'curriculum' | 'activity' | 'career' | 'requirements' | 'eligibility' | 'choose' | 'emotion' | 'repair' | 'general'
export type LearningReplyPlan = { kind: LearningReplyKind; transparent: boolean; instruction: string }
export type LearningReplyInput = { detail: ExplorationMajorDetail | null; hasPlanningRank: boolean; message: string;
  previousUserMessages?: string[]; school?: { name: string; province: string; city: string } | null }

export function planLearningReply(message: string): LearningReplyPlan {
  let kind: LearningReplyKind = 'general'
  if (/重复|答非所问|没回答|没听懂|老是一样|一直一样/.test(message)) kind = 'repair'
  else if (/直接(?:帮我)?(?:选|挑)|替我(?:选|定)|最适合|适合我|适不适合|哪个好|哪个更好|选哪|推荐一个/.test(message)) kind = 'choose'
  else if (/能不能报|能否报|可以报|能报|报考|录取|选科|招生|分数|位次/.test(message)) kind = 'eligibility'
  else if (/考研|读研|研究生|深造|考证|证书|资格证|门槛|准入/.test(message)) kind = 'requirements'
  else if (/就业|工作|毕业.*(?:干|做)|职业|前景|工资|薪资/.test(message)) kind = 'career'
  else if (/实践|实习|实验|项目|怎么学|怎样学|学习活动|学习方式/.test(message)) kind = 'activity'
  else if (/课程|学什么|学习内容|培养|先修|数学|基础/.test(message)) kind = 'curriculum'
  else if (/纠结|慌|焦虑|害怕|担心|不知道怎么办|拿不定主意|迷茫/.test(message)) kind = 'emotion'
  const transparent = kind !== 'emotion' && kind !== 'repair'
  return { kind, transparent, instruction: '当前是专业学习证据解释。只使用当前已核验事实及真实学校/材料年份，备注和兴趣只作用户自述。资料缺失不说明专业前景差，不生成个人适合度，不替用户选赢家。学习知识和大学课程先修不得改写为高考招生资格。没有可靠位次不判断录取、评分或冲稳保。' }
}

export function currentLearningFacts(detail: ExplorationMajorDetail | null | undefined): CurrentLearningFact[] {
  return detail ? Object.values(detail.facts).flat() : []
}
function excerpt(fact: CurrentLearningFact) {
  const scope = fact.school ? `${fact.school.name} ${fact.source.year} 年材料` : `${fact.source.publisher} ${fact.source.year} 年材料`
  return fact.content.length <= 190 ? `${scope}记载：${fact.content.replace(/[\r\n]+/g, ' ')}` : `${scope}有这项已核验资料，具体内容见专业详情中的原文与章节。`
}
function first(detail: ExplorationMajorDetail, kind: CurrentLearningFact['kind']) { return detail.facts[kind][0] }
function noteLine(detail: ExplorationMajorDetail | null) {
  if (!detail?.note) return ''
  // Display cleaning only. The original note remains unchanged in the context/database.
  const note = detail.note.replace(/\*\*|```|(?:^|\n)#{1,6}\s+/g, '').replace(/[\r\n]+/g, ' ')
  return `\n\n家庭原始备注：“${note}”。这是你们的自述，不是专业、招生或就业事实。`
}
function sentence(confirmed: string, unknown: string, action: string, detail: ExplorationMajorDetail | null) {
  return `现在能确定：${confirmed}\n现在还不能确定：${unknown}\n下一步只做：${action}${noteLine(detail)}`
}

export function buildLearningAdvisorReply(input: LearningReplyInput, plan = planLearningReply(input.message)): string {
  if (plan.kind === 'emotion') return '可以先不急着定专业。你更担心大学课程看不懂，还是想先了解毕业后做什么？我们先说清这一件事。'
  if (plan.kind === 'repair') {
    const previous = [...(input.previousUserMessages ?? [])].reverse().find(message => planLearningReply(message).kind !== 'repair')
    if (previous) {
      const reply = buildLearningAdvisorReply({ ...input, message: previous }, planLearningReply(previous))
      return `你说得对，刚才没有回答到你的问题。\n${reply}`
    }
    return '你说得对，刚才没有回答到你的问题。你现在最想确认课程、实践还是职业门槛？我接下来只回答这一件事。'
  }
  const detail = input.detail
  if (!detail) {
    const known = input.school ? `${input.school.name}位于${input.school.province}${input.school.city}；学校基础信息不能代替具体专业的学习材料。` : '当前还没有指定一个有审核资料的专业。'
    return sentence(known, input.hasPlanningRank ? '尚未核对具体专业的学习材料和职业门槛。' : '尚未核对具体专业的学习材料，也没有可靠全省位次，不能判断录取或个人适合度。',
      '打开一个想了解的专业详情，查看对应材料。', null)
  }
  const facts = currentLearningFacts(detail)
  if (!facts.length) {
    const withdrawn = detail.unavailableEvidence.some(gap => gap.status === 'withdrawn')
    return sentence(`${detail.identity.name}的标准身份${detail.savedState==='saved'?'和当前收藏记录':''}仍可找到。`,
      withdrawn ? '原材料已经撤回，当前没有可引用的学习或职业事实；资料缺失不代表专业差。' : '当前学习或职业资料待补充、待审核或已失效，不能从专业名称、旧聊天或家庭备注补齐事实。',
      '到意向学校官网核对这个专业的培养方案。', detail)
  }
  let fact: CurrentLearningFact | undefined, unknown: string, action: string
  switch (plan.kind) {
    case 'activity':
      fact = first(detail, 'learning_activity')
      unknown = fact ? '这些安排只代表所列学校和材料年份，其他学校的实践安排仍需核对。' : '当前没有已核验的实验、项目或实践安排，不能靠专业名称猜学习负担。'
      action = fact ? '打开这份培养材料的实践章节，查看一项具体安排。' : '到意向学校官网核对培养方案的实践章节。'
      break
    case 'career':
      fact = first(detail, 'career_direction')
      unknown = '职业培养方向不等于毕业就能进入岗位；就业率、工资及未核验的读研或证书门槛仍不能确定。'
      action = '核对一个关注职业的官方准入或学历要求。'
      break
    case 'requirements':
      fact = first(detail, 'career_requirement')
      unknown = fact ? '这条门槛只适用于材料中的职业和范围，不能说所有毕业生都必须读研或考证。' : '当前没有已核验的读研、考证或职业准入门槛，不能把未知说成无需读研或必须读研。'
      action = '核对一个关注职业的官方准入或学历要求。'
      break
    case 'eligibility':
      fact = detail.admission.evidence[0]
      unknown = !input.hasPlanningRank ? '尚无可靠全省位次，不能判断录取；学校实例和课程先修不能变成当前招生资格。' : '学习材料不证明录取；还须按当前位次和具体学校的招生资格判断。'
      if (detail.admission.status === 'unknown' || detail.admission.status === 'conflicting') unknown = `${detail.admission.reason}。${unknown}`
      action = '查看意向学校当年招生专业目录中的选科要求。'
      break
    case 'choose':
      fact = first(detail, 'curriculum') ?? first(detail, 'learning_activity') ?? first(detail, 'career_direction')
      unknown = '这些材料不能证明哪个专业最适合你，也不能替你选赢家；资料多寡不等于专业前景好坏。'
      action = '说出一门你最想进一步了解的课程。'
      break
    default:
      fact = /先修|基础|数学/.test(input.message) ? first(detail, 'learning_prerequisite') ?? first(detail, 'course_prerequisite') : first(detail, 'curriculum')
      unknown = fact ? '单校培养材料不是全国统一课程，学习前置知识和大学课程先修也不是高考选科资格。' : '当前课程或对应学习条件材料待补充，不由专业名称或 AI 拼课程。'
      action = '打开意向学校的培养方案，核对课程章节。'
  }
  let confirmed = fact ? `${detail.identity.name}：${excerpt(fact)}` : `${detail.identity.name}已有部分核验材料，但当前问题对应的资料仍有缺口。`
  if(plan.kind==='eligibility'&&detail.admission.status==='not_met')confirmed+=` ${detail.admission.reason}；只适用于已核验的招生范围。`
  return sentence(confirmed, unknown, action, detail)
}

export function learningEvidenceRefs(detail: ExplorationMajorDetail | null | undefined) {
  const seen = new Set<string>()
  return currentLearningFacts(detail).flatMap(fact => {
    const key = `${fact.source.artifactId}:${fact.locator.kind}:${fact.locator.value}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ title: `${fact.source.title}（${fact.school?.name ?? '专业范围'}；${fact.locator.value}）`,
      year: fact.source.year, publisher: fact.source.publisher, url: fact.source.url }]
  }).slice(0, 8)
}

export function learningModelFacts(input: LearningReplyInput, localAnswer: string) {
  return { mode: input.hasPlanningRank ? 'learning-with-planning-rank' : 'exploration',
    identity: input.detail?.identity ?? null, hasPlanningRank: input.hasPlanningRank,
    currentFacts: currentLearningFacts(input.detail), dataGaps: input.detail?.dataGaps ?? [],
    admission: input.detail?.admission ?? null, userNote: input.detail?.note ?? null,
    noteIsUserStatement: true, school: input.school ?? null, verifiedReply: localAnswer }
}

// The server owns factual sentences. The model can give a plain conversational
// response, but cannot rewrite evidence or gaps into a different factual claim.
export function isSafeLearningAdvisorAnswer(answer: string, localAnswer: string, plan: LearningReplyPlan, detail: ExplorationMajorDetail | null, hasPlanningRank: boolean) {
  if(!plan.transparent)return answer===localAnswer
  if(answer===localAnswer)return true
  const note = noteLine(detail)
  const clean = note && answer.endsWith(note) ? answer.slice(0, -note.length) : answer
  const forbidden = /(?:你最适合|最适合你|你更适合|你很适合|适合度(?:为|分)|匹配度(?:为|分)|前景(?:差|不好)|不值得(?:学|了解)|放弃这个专业|劝退这个专业|(?:肯定|一定|保证).{0,8}(?:录取|就业|赚钱)|无需(?:读研|考证))/
  if (forbidden.test(clean)) return false
  if (!hasPlanningRank && /(?:优先了解|值得比较|谨慎报考|冲刺|稳妥|保底|综合参考分|录取概率)/.test(clean)) return false
  const expected = localAnswer.split(/\r?\n/).slice(0, 3)
  const lines = clean.trim().split(/\r?\n/)
  if (lines.length !== 3 || lines[0] !== expected[0] || lines[1] !== expected[1]) return false
  // One action may be worded naturally; no extra fact paragraph or made-up number.
  return lines[2] === expected[2] || [
    '下一步只做：告诉我你想进一步了解的一门课程。',
    '下一步只做：说出一项你想进一步了解的学习活动。',
  ].includes(lines[2]!)
}
