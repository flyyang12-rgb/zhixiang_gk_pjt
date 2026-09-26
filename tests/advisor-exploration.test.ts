import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const ai = vi.hoisted(() => ({ AI_BASE_URL:'',AI_API_KEY:'',AI_MODEL:'' }))
vi.mock('../server/config.js', () => ({ config:ai }))
vi.mock('node:fs/promises', () => ({ readFile:vi.fn(async () => '锁定的测试方法论') }))
vi.mock('../server/database.js', () => ({ database:{ query:() => {throw new Error('单元测试不得访问默认数据库')} } }))
import { buildLearningAdvisorReply, learningEvidenceRefs, learningModelFacts, planLearningReply, isSafeLearningAdvisorAnswer } from '../server/advisor-exploration.js'
import { buildLocalAdvisorReply, generateAdvisorReply, type AdvisorReplyContext } from '../server/advisor-reply.js'
import { buildModelMessages } from '../server/advisor-prompt.js'
import { advisorLearningContext, advisorLearningDetail } from './fixtures/advisor-exploration.js'

const noRank = (detail=advisorLearningDetail(), message='请解释课程') => ({detail,message,hasPlanningRank:false})
function mockAnswer(answer:string) {return vi.fn(async () => ({ok:true,json:async () => ({choices:[{message:{content:answer}}]})}))}

describe('专业探索顾问当轮证据与表达', () => {
  beforeEach(() => { ai.AI_BASE_URL='';ai.AI_API_KEY='';ai.AI_MODEL='' })
  afterEach(() => {vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks()})
  it.each([
    ['课程学什么','合成课程：材料观察与记录'], ['平时怎样实践','实验记录与团队讨论'],
    ['毕业职业方向有哪些','资料分析'], ['学习需要哪些课程基础','完成基础观察课程'],
  ])('按当前问题解释对应材料、学校和真实年份：%s', (message,fact) => {
    const reply=buildLocalAdvisorReply(advisorLearningContext(),message)
    expect(reply).toContain(fact);expect(reply).toContain('合成测试学校 2025 年材料')
    expect(reply).toMatch(/^现在能确定：.+\n现在还不能确定：.+\n下一步只做：.+/)
    expect(reply).not.toMatch(/优先了解|值得比较|谨慎报考|保底|第.*名|综合参考分/)
  })
  it('课程先修不当高考招生资格；未知要求不当不限', () => {
    const reply=buildLocalAdvisorReply(advisorLearningContext(),'能不能报这个专业？')
    expect(reply).toContain('尚无可靠全省位次，不能判断录取')
    expect(reply).toContain('课程先修不能变成当前招生资格')
    expect(reply).not.toContain('满足继续了解');expect(reply).toContain('未知不表示不限')
  })
  it('尚无职业门槛事实时不把未知说成无需或必须读研', () => {
    const reply=buildLocalAdvisorReply(advisorLearningContext(),'是不是必须读研考证？')
    expect(reply).toContain('当前没有已核验的读研、考证或职业准入门槛')
    expect(reply.split('\n')[0]).not.toContain('必须读研')
  })
  it('直接替我选也不强选赢家、推断适合度或用资料缺口劝退', () => {
    const reply=buildLocalAdvisorReply(advisorLearningContext(),'你直接帮我选最适合的')
    expect(reply).toContain('不能替你选赢家');expect(reply).toContain('说出一门')
    expect(reply).not.toMatch(/你更适合|不值得学|前景差/)
  })
  it('撤回后不使用旧回答或原始备注中的课程，只保留身份、当前缺口和自述', async () => {
    const note='  我喜欢旧课程，担心 9000 元费用\n继续核验  '
    const detail=advisorLearningDetail({state:'withdrawn',saved:true,note})
    const result=await generateAdvisorReply({context:advisorLearningContext(detail),message:'当前课程还有可靠材料吗？',history:[{id:1,role:'assistant',content:'旧材料记载线性代数和录取率99%'}]})
    expect(result.answer).toContain('原材料已经撤回');expect(result.answer).toContain('不是专业、招生或就业事实')
    expect(result.answer).not.toContain('线性代数');expect(result.answer).not.toContain('合成课程：')
    expect(result.evidenceRefs).toEqual([]);expect(detail.note).toBe(note)
    const facts=learningModelFacts(noRank(detail),result.answer)
    expect(facts.userNote).toBe(note);expect(facts.currentFacts).toEqual([])
    expect(facts).not.toHaveProperty('dashboard')
  })
  it('已收藏 pending 保留备注而不补造课程', () => {
    const reply=buildLocalAdvisorReply(advisorLearningContext(advisorLearningDetail({state:'pending',saved:true,note:'我想学数学'})),'课程是什么？')
    expect(reply).toContain('资料待补充');expect(reply).toContain('家庭原始备注')
    expect(reply.split('\n')[0]).not.toContain('数学');expect(reply).not.toContain('合成课程：')
  })
  it('新材料覆盖旧聊天事实；来源仅由服务端当前材料生成，保留原锚点和定位', async () => {
    const result=await generateAdvisorReply({context:advisorLearningContext(advisorLearningDetail({curriculum:'更新后的合成课程'})),message:'它现在学什么？',history:[{id:1,role:'assistant',content:'旧合成课程'}]})
    expect(result.answer).toContain('更新后的合成课程');expect(result.answer).not.toContain('旧合成课程')
    expect(result.evidenceRefs[0]).toMatchObject({year:2025,publisher:'合成测试学校',url:'https://test.example.edu/plan#curriculum'})
    expect(result.evidenceRefs[0]?.title).toContain('合成课程章节')
    expect(learningEvidenceRefs(advisorLearningDetail({state:'withdrawn'}))).toEqual([])
  })
  it.each(['你好','你好，谢谢你','谢谢你','你是谁','我很焦虑，不知道怎么办'])('自然短答不强套三句：%s', message => {
    const reply=buildLocalAdvisorReply(advisorLearningContext(),message)
    expect(reply).not.toMatch(/现在能确定|现在还不能确定|下一步只做/)
  })
  it('纠错回到最近用户问题，不重复前一篇学校介绍', () => {
    const result=buildLocalAdvisorReply(advisorLearningContext(),'你一直重复没回答', {summary:'',summarizedThroughMessageId:null,recent:[{id:1,role:'user',content:'它平时怎样实践？'},{id:2,role:'assistant',content:'旧通稿'}]})
    expect(result).toContain('你说得对');expect(result).toContain('实验记录与团队讨论');expect(result).not.toContain('旧通稿')
  })
  it('探索 prompt 不要求强选和劝退，学习事实不携带评分', () => {
    const local=buildLearningAdvisorReply(noRank())
    const prompt=buildModelMessages({methodology:'测试方法论',facts:learningModelFacts(noRank(),local),memory:{summary:'',recent:[],summarizedThroughMessageId:null},currentMessage:'课程',exploration:true})[0]!.content
    expect(prompt).toContain('不能生成个人适合度');expect(prompt).not.toContain('先下判断，再摆事实')
    expect(prompt).not.toContain('我站这所');expect(prompt).not.toContain('totalScore')
  })
  it('有位次后专业学习会话仍不由课程推出录取', () => {
    const context=advisorLearningContext();context.dashboard.mode='application';context.dashboard.planningCoordinate.rank=10000
    const result=buildLocalAdvisorReply(context,'能不能报这个专业？')
    expect(result).toContain('学习材料不证明录取');expect(result).not.toContain('尚无可靠全省位次')
  })
  it('已核验资格不满足必须直接说明，缺位次不掩盖硬条件', () => {
    const detail=advisorLearningDetail()
    detail.admission.status='not_met';detail.admission.reason='当前选科不满足已核验要求'
    const answer=buildLocalAdvisorReply(advisorLearningContext(detail),'能不能报这个专业？')
    expect(answer.split('\n')[0]).toContain('当前选科不满足已核验要求')
    expect(answer).toContain('只适用于已核验的招生范围')
    expect(answer).toContain('尚无可靠全省位次，不能判断录取')
  })
  it('无位次学校焦点仍进入学校评价、学费和地址路由', () => {
    const context=advisorLearningContext(null)
    context.schoolDetail={school:{id:1,name:'合成测试学校',province:'河南',city:'郑州',level:'本科'},featuredMajors:[],admissionContext:{records:[]}} as unknown as AdvisorReplyContext['schoolDetail']
    expect(buildLocalAdvisorReply(context,'这学校怎么样')).toContain('不建议现在把合成测试学校放在前面')
    expect(buildLocalAdvisorReply(context,'这学校学费贵吗')).toContain('学费')
    expect(buildLocalAdvisorReply(context,'这学校在哪')).toContain('河南郑州')
  })
  it('对未知、当前材料缺口的回答，AI不得添加无来源事实或个人结论', () => {
    const input=noRank();const local=buildLearningAdvisorReply(input);const plan=planLearningReply(input.message)
    expect(isSafeLearningAdvisorAnswer(local,local,plan,input.detail,false)).toBe(true)
    expect(isSafeLearningAdvisorAnswer(local+'\n课程还有高等数学',local,plan,input.detail,false)).toBe(false)
    expect(isSafeLearningAdvisorAnswer(local.replace('材料观察与记录','人工智能和机器学习'),local,plan,input.detail,false)).toBe(false)
  })
  it('透明动作仅接受本地动作或固定的无事实追问，不接收任意事实文字', () => {
    const input=noRank();const local=buildLearningAdvisorReply(input);const plan=planLearningReply(input.message)
    const firstTwo=local.split('\n').slice(0,2).join('\n')
    expect(isSafeLearningAdvisorAnswer(firstTwo+'\n下一步只做：告诉我你想进一步了解的一门课程。',local,plan,input.detail,false)).toBe(true)
    expect(isSafeLearningAdvisorAnswer(firstTwo+'\n下一步只做：告诉我月薪90000的课程。',local,plan,input.detail,false)).toBe(false)
  })

  describe('可预测 AI 替身', () => {
    beforeEach(() => {ai.AI_BASE_URL='https://synthetic-ai.invalid';ai.AI_API_KEY='synthetic-only';ai.AI_MODEL='synthetic-model';vi.spyOn(console,'warn').mockImplementation(() => {})})
    it('合规解释使用当前事实且不会让模型提供来源链接', async () => {
      const context=advisorLearningContext();const local=buildLocalAdvisorReply(context,'课程学什么？')
      const fetch=mockAnswer(local);vi.stubGlobal('fetch',fetch)
      const result=await generateAdvisorReply({context,message:'课程学什么？'})
      expect(result.mode).toBe('ai-adapted-skill');expect(result.evidenceRefs).toEqual(learningEvidenceRefs(context.majorDetail))
      const body=JSON.parse(fetch.mock.calls[0]![1].body)
      expect(body.messages[0].content).toContain('verifiedReply');expect(body.messages[0].content).not.toContain('factors')
    })
    it.each(['**课程介绍**','你更适合，放心保证就业','现在能确定：必修高等数学，毕业工资9000元\n现在还不能确定：无\n下一步只做：报考。','现在能确定：合成专业十二适合你\n现在还不能确定：无\n下一步只做：先选它。'])('越界、格式或无来源事实自动回到同一问题：%s', async answer => {
      const context=advisorLearningContext();vi.stubGlobal('fetch',mockAnswer(answer))
      const result=await generateAdvisorReply({context,message:'它平时怎样实践？'})
      expect(result.mode).toBe('local-ai-fallback');expect(result.answer).toBe(buildLocalAdvisorReply(context,'它平时怎样实践？'))
      expect(result.answer).toContain('实验记录与团队讨论')
    })
    it('超时回到同意图本地解释', async () => {
      vi.useFakeTimers();let started!:() => void;const pending=new Promise<void>(resolve => started=resolve)
      vi.stubGlobal('fetch',vi.fn((_url,options) => {started();return new Promise((_resolve,reject) => options.signal.addEventListener('abort',() => reject(new Error('合成超时'))))}))
      const context=advisorLearningContext();const result=generateAdvisorReply({context,message:'它的职业方向是什么？'})
      await pending;await vi.advanceTimersByTimeAsync(15001)
      expect((await result).mode).toBe('local-ai-fallback');expect((await result).answer).toContain('资料分析')
    })
    it('失效响应与无内容回退当前材料，不泄露服务错误', async () => {
      vi.stubGlobal('fetch',vi.fn(async () => ({ok:false,status:429})))
      const result=await generateAdvisorReply({context:advisorLearningContext(),message:'哪些课程？'})
      expect(result.mode).toBe('local-ai-fallback');expect(result.answer).toContain('材料观察与记录')
    })
    it.each(['告诉我月薪90000的课程。','说出本专业必修线性代数的课程。'])('动作夹带无来源事实自动回退：%s', async action => {
      const context=advisorLearningContext();const message='课程学什么？';const local=buildLocalAdvisorReply(context,message)
      vi.stubGlobal('fetch',mockAnswer(local.split('\n').slice(0,2).join('\n')+'\n下一步只做：'+action))
      const result=await generateAdvisorReply({context,message})
      expect(result.mode).toBe('local-ai-fallback');expect(result.answer).toBe(local)
      expect(result.answer).not.toContain('90000');expect(result.answer).not.toContain('线性代数')
    })
    it('无位次学校当前招生事实仍带由服务端提供的来源', async () => {
      const context=advisorLearningContext(null)
      context.schoolDetail={school:{id:1,name:'合成测试学校',province:'河南',city:'郑州',level:'本科'},featuredMajors:[],admissionContext:{records:[{year:2025,unitName:'合成招生单位',sourceUrl:'https://synthetic.example.edu/admission',publisher:'合成考试院'}]}} as unknown as AdvisorReplyContext['schoolDetail']
      const local=buildLocalAdvisorReply(context,'这学校学费是多少？');vi.stubGlobal('fetch',mockAnswer(local))
      const result=await generateAdvisorReply({context,message:'这学校学费是多少？'})
      expect(result.evidenceRefs).toEqual([{title:'2025 年合成招生单位招生记录',year:2025,publisher:'合成考试院',url:'https://synthetic.example.edu/admission'}])
      expect(result.answer).toContain('学费');expect(result.mode).toBe('ai-adapted-skill')
    })
    it.each(['你好','我很迷茫'])('非事实短答不允许从旧消息重引撤回课程：%s', async message => {
      const context=advisorLearningContext(advisorLearningDetail({state:'withdrawn',saved:true}))
      vi.stubGlobal('fetch',mockAnswer('别担心，这个专业会学习合成已撤回课程，你可以先了解软件设计。'))
      const result=await generateAdvisorReply({context,message,history:[{id:1,role:'assistant',content:'合成已撤回课程'}]})
      expect(result.mode).toBe('local-ai-fallback');expect(result.answer).toBe(buildLocalAdvisorReply(context,message))
      expect(result.answer).not.toContain('合成已撤回课程')
    })
  })
})
