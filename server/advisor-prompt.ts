export type AdvisorHistoryMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
}

export type ConversationMemory = {
  summary: string
  recent: AdvisorHistoryMessage[]
  summarizedThroughMessageId: number | null
}

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const RECENT_MESSAGE_LIMIT = 16
const RECENT_CHARACTER_LIMIT = 12_000
const SUMMARY_CHARACTER_LIMIT = 4_000

function compactLine(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Build deterministic conversational memory. This function never asks the model
 * to invent a summary: it only compresses text that already exists in the chat.
 */
export function buildConversationMemory(existingSummary: string | null | undefined, history: AdvisorHistoryMessage[]): ConversationMemory {
  let recent = history.slice(-RECENT_MESSAGE_LIMIT)
  let recentCharacters = recent.reduce((total, item) => total + item.content.length, 0)
  while (recent.length > 1 && recentCharacters > RECENT_CHARACTER_LIMIT) {
    recentCharacters -= recent[0].content.length
    recent = recent.slice(1)
  }

  const recentStartId = recent[0]?.id ?? Number.POSITIVE_INFINITY
  const older = history.filter(item => item.id < recentStartId)
  const additions = older.map(item => {
    const label = item.role === 'user' ? '用户此前说过' : '顾问此前的讨论结论（仅作上下文，不作事实）'
    return `${label}：${compactLine(item.content)}`
  })
  const summaryParts = [compactLine(existingSummary ?? ''), ...additions].filter(Boolean)
  let summary = summaryParts.join('\n')
  if (summary.length > SUMMARY_CHARACTER_LIMIT) summary = `……（更早内容已省略）\n${summary.slice(-SUMMARY_CHARACTER_LIMIT)}`

  return {
    summary,
    recent,
    summarizedThroughMessageId: older.at(-1)?.id ?? null,
  }
}

export function buildModelMessages(input: {
  methodology: string
  facts: unknown
  memory: ConversationMemory
  currentMessage: string
  responseInstruction?: string
}): ModelMessage[] {
  const system = [
    '你是“知向规划顾问”，不是任何真人、官方机构或录取预测工具。',
    '当前数据库事实优先于旧聊天内容；旧助手回答只能帮助理解指代，绝不能当作招生、就业或收入事实。',
    '事实和推断必须分开：事实只能来自下面的当前本地事实；倾向和建议必须写成有条件的判断，不能伪装成事实。',
    '任何年份、位次、分数、数量或比例都必须来自当前本地事实；没有证据就不要输出数字。',
    '只解释下面提供的本地已核验事实。资料不足就明确说不知道，禁止自行联网、补造数字、链接、排名或成功案例。',
    'savedItems.note 是学生或家长填写的“家庭讨论备注”，只能当作用户条件自然承接，不是官方招生或就业事实，不得据此改变专业档位、候选排序或冲稳保。',
    'scoreSnapshots 是用户记录的模考坐标，只能说明已发生的位次变化。不得用趋势推断高考分数、录取概率或“按这个势头一定能上”。只有分数没有全省位次时，要明说不同考试难度不可直接比较。',
    '回答面向刚高中毕业的学生和不熟悉志愿术语的父母：短句、说人话，先回应当前问题。不要机械复述前文，不要每次都说“这个担心很实际”。',
    '每一轮都要像真人在接话：先识别用户此刻是在问、担心、反驳还是犹豫，再回应这一句话。不要把所有问题改写成一份志愿报告。',
    '先下判断，再摆事实：第一句话先告诉用户“能不能看、值不值得、该不该停”，下一句再讲数据库依据。不要先介绍学校半天，最后才含糊表态。',
    '判断学校时，硬条件通过后必须先看用户目标专业的具体招生记录和已核验优势证据，再看规划位次、调剂和证据缺口、城市成本，最后才看学校层次和名气。不能因为校名好听就让专业让路。',
    '可以明确说“我站这所”“不建议优先报”“这个选择不划算”或“这是拿专业去赌”，但必须紧跟当前事实和条件。专业更强但风险高时，要说清它只能冲，并提醒保留同专业的稳妥或保底候选，绝不能偷改冲稳保。',
    '要有鲜明判断和口语节奏。需要判断时，第一句就回答“值不值得、能不能、该不该”；用户只是问候、倾诉或纠正你时，先正常回应，别硬下结论。可以说“先别急”“这话我得给你说透”“别被校名唬住”，也可以用一个反问戳破误区。禁止用“需要继续核对”“综合考虑”“因人而异”冒充结论。',
    '可以骂选择瞎、策略蠢、宣传扯淡，但不能骂提问的人。火力只对着错误选择、招生宣传和侥幸心理：不攻击学生、父母、职业、收入、地域或出身，不制造羞耻和恐惧。',
    '位次、专业组等术语第一次出现时紧跟日常解释。聊天中禁止直接展示综合参考分、置信度等级和本科直接就业入口分，必须翻成普通家庭能听懂的话。院校判断默认控制在4—6个短句，最后只留一个动作；最多追问两个真正会改变判断的问题。',
    input.responseInstruction??'需要判断或核对事实时使用透明三句话开头；问候、感谢和身份说明自然短答。不要使用旧四段报告模板。',
    '',
    '安全改编方法论：',
    input.methodology,
    '',
    '当前本地事实（只读）：',
    JSON.stringify(input.facts),
    '',
    '本会话较早内容摘要（只作上下文，不作事实）：',
    input.memory.summary || '无',
  ].join('\n')

  return [
    {role: 'system', content: system},
    ...input.memory.recent.map(item => ({role: item.role, content: item.content})),
    {role: 'user', content: input.currentMessage},
  ]
}

const UNSAFE_PATTERNS = [
  /我(?:就)?是张雪峰/,
  /张雪峰(?:本人|老师为你)/,
  /穷人别谈理想/,
  /打晕.*别报/,
  /(?:你|你家|你父母).*(?:没出息|没见识|活该|穷)/,
  /(?:一定|保证|稳稳|百分之百).{0,8}(?:录取|考上|就业|找到工作|赚钱)/,
  /(?:包录取|包就业|保就业)/,
  /录取概率/,
  /概率(?:很高|较高|较低|很低)/,
  /确保有学上/,
  /https?:\/\//i,
  /www\./i,
  /(?:\*\*|^#{1,6}\s|```)/m,
  /(?:综合参考分|[高中低]置信度|本科直接就业入口(?:参考)?分)/,
]

export function isTransparentAdvisorAnswer(answer:string){
  const lines=answer.split(/\r?\n/)
  if(!/^现在能确定：\S.+/.test(lines[0]??''))return false
  if(!/^现在还不能确定：\S.+/.test(lines[1]??''))return false
  if(!/^下一步只做：\S.+/.test(lines[2]??''))return false
  const nextStep=lines[2].slice('下一步只做：'.length)
  if(/(?:^|[；;])\s*(?:\d+[.、．]|[一二三四五六七八九十][、.．])/.test(nextStep))return false
  if(/[；;]/.test(nextStep)||/(?:，|,)(?:再|然后|并且|同时)/.test(nextStep))return false
  if(/(?:\*\*|^#{1,6}\s|```)/m.test(answer))return false
  return true
}

export function isSafeAdvisorAnswer(answer: string,requiredName?:string,style:'full'|'concise'='full') {
  if (!answer.trim()) return false
  const headings=['【先说结论】', '【为什么这么说】', '【这事最容易踩的坑】', '【接下来怎么查】']
  if(style==='full'&&answer.length>1200)return false
  if(style==='concise'&&(answer.length>600||headings.some(heading=>answer.includes(heading))||answer.includes('你前面明确提到')))return false
  return !UNSAFE_PATTERNS.some(pattern => pattern.test(answer))&&(!requiredName||answer.includes(requiredName))
}
