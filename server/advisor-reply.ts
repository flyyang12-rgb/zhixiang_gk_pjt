import {readFile} from 'node:fs/promises'
import {config} from './config.js'
import type {buildProfessionDashboard} from './profession-dashboard.js'
import type {loadSchoolDetail} from './school-detail.js'
import {buildConversationMemory,buildModelMessages,isSafeAdvisorAnswer,isTransparentAdvisorAnswer,type AdvisorHistoryMessage} from './advisor-prompt.js'

export type AdvisorReplyContext={
  profile:{studentName:string;province:string;subjectGroup:string;score:number;provinceRank:number|null}
  dashboard:Awaited<ReturnType<typeof buildProfessionDashboard>>
  schoolDetail:Awaited<ReturnType<typeof loadSchoolDetail>>|null
  focusedMajor:Awaited<ReturnType<typeof buildProfessionDashboard>>['cards'][number]|null
}

export type AdvisorEvidenceRef={title:string;year:number|null;publisher:string;url:string}
type ReplyKind='general'|'greeting'|'thanks'|'remember'|'emotion'|'school-overview'|'school-fact'|'major-eligibility'|'major-interest'|'postgraduate'|'employment'|'school-vs-major'|'repair-repeat'|'identity'
type ReplyPlan={style:'full'|'concise';kind:ReplyKind;targetMajor?:string;localPlace?:string;transparent?:boolean;instruction:string}

function transparentAnswer(confirmed:string,unknown:string,nextStep:string,detail=''){
  return `现在能确定：${confirmed}\n现在还不能确定：${unknown}\n下一步只做：${nextStep}${detail?`\n\n${detail}`:''}`
}

function advisorPlanningCoordinate(context:AdvisorReplyContext){
  const coordinate=context.dashboard.planningCoordinate
  if(coordinate)return coordinate
  const rank=context.profile.provinceRank
  return {rank,sampleCount:rank?1:0,bestRank:rank,worstRank:rank,spreadRatio:0,stability:'single' as const}
}

export async function generateAdvisorReply(input:{
  context:AdvisorReplyContext
  message:string
  history?:AdvisorHistoryMessage[]
  existingSummary?:string|null
}){
  const memory=buildConversationMemory(input.existingSummary,input.history??[])
  const replyPlan=planReply(input.message,memory,input.context)
  const evidenceRefs=buildEvidenceRefs(input.context)
  const localAnswer=buildLocalAdvisorReply(input.context,input.message,memory,replyPlan)
  let answer=localAnswer
  let mode='local-adapted-skill'
  if(config.AI_BASE_URL&&config.AI_API_KEY&&config.AI_MODEL){
    try{
      answer=await askModel(input.context,input.message,memory,replyPlan)
      const requiredNames=[...requiredCurrentNames(replyPlan,input.context),...requiredContextTerms(input.message,memory)]
      const unrelatedMajor=replyPlan.targetMajor&&input.context.dashboard.cards.some(card=>!card.name.includes(replyPlan.targetMajor!)&&!replyPlan.targetMajor!.includes(card.name)&&answer.includes(card.name))
      const missedRepair=replyPlan.kind==='repair-repeat'&&!/(?:你说得对|是我没接住|刚才.*没回答|刚才.*答偏)/.test(answer)
      if(answer.length>2400||/https?:\/\//i.test(answer)||/www\./i.test(answer)||!isSafeAdvisorAnswer(answer,undefined,replyPlan.style)||(replyPlan.transparent&&!isTransparentAdvisorAnswer(answer))||requiredNames.some(name=>!answer.includes(name))||unrelatedMajor||missedRepair)throw new Error('AI 输出越过顾问边界或答非所问')
      mode='ai-adapted-skill'
    }catch(error){
      console.warn('AI 顾问调用失败，已切换本地解释：',error instanceof Error?error.message:'未知错误')
      answer=localAnswer
      mode='local-ai-fallback'
    }
  }
  return {answer,mode,evidenceRefs,memory}
}

function extractTargetMajor(message:string){
  return message.match(/(?:想学|喜欢|想报|考虑)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}?)(?:专业)?(?:[，。！？?\s]|$)/)?.[1]?.trim()
}

function planReply(message:string,memory?:ReturnType<typeof buildConversationMemory>,context?:AdvisorReplyContext):ReplyPlan{
  const normalized=message.trim()
  if(/^(?:你好|您好|嗨|哈喽|在吗|有人吗)[！!。,.，\s]*$/.test(normalized))return {style:'concise',kind:'greeting',instruction:'这是普通问候。像一位熟悉的班主任一样用2—3句回应，告诉用户可以直接说学校、专业或家里的顾虑。不要标题、不要介绍方法论、不要输出档案数据。'}
  if(/^(?:(?:谢谢|感谢)(?:你)?[！!。,.，\s]*(?:我)?(?:明白|知道|懂)了?|(?:我)?(?:明白|知道|懂)了|好的|行|好嘞)[！!。,.，\s]*$/.test(normalized))return {style:'concise',kind:'thanks',instruction:'用户在感谢或确认听懂。自然收口，最多2句；不要重新分析，不要复述档案和历史条件，不要标题。'}
  if(/你是谁|你能(?:帮我)?(?:做|干)什么|你是(?:真人|人|机器人|AI|人工智能)|你是不是(?:真人|人|机器人|AI|人工智能)/i.test(normalized))return {style:'concise',kind:'identity',instruction:'这是身份或能力确认。用2—4句自然说明你是知向里的 AI 规划顾问，不是真人；说明能做什么和不能做什么。不要标题，不要转去分析专业或学校，控制在180字内。'}
  if(/(?:先|帮我)?记住|别忘了|记一下/.test(normalized))return {style:'concise',kind:'remember',instruction:'用户在明确一个希望本会话记住的条件。用一句话确认已经记住，再用一句话说明后续会怎样使用；不要展开分析，不要标题，不要复述无关档案。'}
  if(/重复|答非所问|没回答|没听懂|老是一样|一直一样/.test(normalized)){
    const targetMajor=[...(memory?.recent??[])].reverse().filter(item=>item.role==='user').map(item=>extractTargetMajor(item.content)).find(Boolean)
    return {style:'concise',kind:'repair-repeat',targetMajor,instruction:`用户指出你在重复或答非所问。必须先说“你说得对”，承认刚才没有接住问题；${targetMajor?`然后回到用户想学的“${targetMajor}”，只说明当前学校是否有该专业的具体招生证据。`:'然后请用户用一句话重说最想确认的事。'}不要标题，不要重复上一份学校介绍，控制在100—250字。`}
  }
  const majorMatch=normalized.match(/(?:能不能|能否|可以|能)报(?:考)?\s*([^，。！？?]{2,12}?)(?:专业)?[吗么嘛？?]?$/)||normalized.match(/^\s*([^，。！？?]{2,12}?)(?:专业)?(?:能不能|能否|可以|能)报/)
  const targetMajor=majorMatch?.[1]?.replace(/^(?:我|我们|孩子|这个位次|现在)+/,'').replace(/[吗么嘛呢呀啊]$/,'').trim()
  if(targetMajor)return {style:'concise',kind:'major-eligibility',targetMajor,transparent:true,instruction:`这是单点短问题，用户问的是“${targetMajor}”。先直接回答“能不能把它列入备选”，再用日常语言区分“可以填报”和“能被录取”。只谈${targetMajor}，不要罗列其他专业，不要四段标题，不要逐字引用前文；说明当前证据缺口后最多追问一个学校范围，控制在100—250字。`}
  const interestedMajor=extractTargetMajor(normalized)
  if(interestedMajor)return {style:'concise',kind:'major-interest',targetMajor:interestedMajor,transparent:true,instruction:`用户表达想学“${interestedMajor}”。自然接住这个选择，只围绕当前学校是否有${interestedMajor}的具体招生证据回答；不要泛泛介绍学校，不要四段标题，控制在100—250字。`}
  if(/学费|住宿费|宿舍|寝室|在哪|地址|哪个城市|离家|远不远/.test(normalized))return {style:'concise',kind:'school-fact',transparent:true,instruction:'用户在问当前学校的一个具体事实。只回答这一项：本地事实有就直说，没有就明确说当前没有；不要重复学校整体介绍，不要四段标题，不要猜测学费、宿舍、距离或交通。控制在80—220字。'}
  if((context?.schoolDetail&&/(?:怎么样|咋样|值不值得|好不好)/.test(normalized))||/(?:学校|学院|大学).*(?:怎么样|咋样|值不值得|好不好)|(?:怎么样|咋样|值不值得|好不好).*(?:学校|学院|大学)/.test(normalized)){
    const localPlace=normalized.match(/我是(?:河南)?([\u4e00-\u9fa5]{2,6})(?:人|的)/)?.[1]
    return {style:'concise',kind:'school-overview',localPlace,transparent:true,instruction:`用户是在问当前院校整体值不值得看${localPlace?`，并主动说自己是${localPlace}人` :''}。第一句必须给鲜明判断，不能说“需要继续核对”。用自然口语讲清学校层次、地域便利、已核验优势专业和当前招生证据；地域近只能算生活成本和适应成本的优点，不能当成报考理由。不要扯无关专业。资料不足就直说，控制在180—350字。`}
  }
  if(/纠结|慌|焦虑|害怕|担心|不知道怎么办|拿不定主意|迷茫/.test(normalized))return {style:'concise',kind:'emotion',instruction:'用户是在表达焦虑或犹豫。先用一句话接住情绪，但不要空泛安慰；随后把问题缩小成眼下最值得决定的一件事，最多问两个关键问题。不要标题，不要立刻倾倒全部档案和清单，控制在120—260字。'}
  if(/考研|读研|研究生|深造/.test(normalized))return {style:'concise',kind:'postgraduate',transparent:true,instruction:'用户在问深造。明确回答是否需要把读研当成必要条件，再用本科出口、培养年限和家庭成本解释。不要把考研说成唯一出路，控制在180—350字。'}
  if(/就业|工作|毕业.*(?:干|做)|好找工作|前景|工资|薪资/.test(normalized))return {style:'concise',kind:'employment',transparent:true,instruction:'用户在问就业。说明当前本地招聘证据能证明什么、不能证明什么。重点讲普通毕业生的入口和门槛，不编薪资或就业率，控制在180—350字。'}
  if(/学校.*专业|专业.*学校|优先选学校|优先选专业|学校还是专业/.test(normalized))return {style:'concise',kind:'school-vs-major',transparent:true,instruction:'用户在问学校和专业怎么取舍。给当前档案下的倾向，不说“都重要”，再给一个可执行的选择规则，控制在180—350字。'}
  return {style:'full',kind:'general',transparent:true,instruction:'直接回应用户当前这句话，再给明确倾向和依据。自然分段，不输出万能三项检查清单。只有用户明确要求全面分析时才展开，通常200—500字。'}
}

function requiredCurrentNames(replyPlan:ReplyPlan,context:AdvisorReplyContext){
  if(replyPlan.kind==='school-overview')return context.schoolDetail?[context.schoolDetail.school.name]:[]
  if(replyPlan.kind==='major-interest'&&context.schoolDetail)return [replyPlan.targetMajor,context.schoolDetail.school.name].filter((value):value is string=>Boolean(value))
  if(replyPlan.kind==='major-interest'||replyPlan.kind==='major-eligibility')return replyPlan.targetMajor?[replyPlan.targetMajor]:[]
  return []
}

function requiredContextTerms(message:string,memory:ReturnType<typeof buildConversationMemory>){
  if(!/(?:这个条件|刚才(?:说|提)的|前面(?:说|提)的|还记得|按这个|照这个)/.test(message))return []
  const recentUserContext=memory.recent.filter(item=>item.role==='user').map(item=>item.content).join('\n')
  const userContext=recentUserContext||memory.summary
  return ['四年本科','不读研','必须读研','专升本','预算','学费','离家近','省内','省外'].filter(term=>userContext.includes(term)).slice(-2)
}

async function askModel(context:AdvisorReplyContext,message:string,memory:ReturnType<typeof buildConversationMemory>,replyPlan:ReplyPlan){
  const methodology=await readFile(new URL('../vendor/zhangxuefeng-skill/ADAPTED_METHODOLOGY.md',import.meta.url),'utf8')
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),15_000)
  try{
    const response=await fetch(`${config.AI_BASE_URL.replace(/\/$/,'')}/chat/completions`,{
      method:'POST',signal:controller.signal,
      headers:{Authorization:`Bearer ${config.AI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:config.AI_MODEL,temperature:.45,thinking:{type:'disabled'},messages:buildModelMessages({methodology,facts:context,memory,currentMessage:message,responseInstruction:replyPlan.transparent?`回答开头必须连续使用三行纯文本，顺序和标签一字不改：\n现在能确定：先给鲜明倾向，再写支撑这个倾向的当前本地事实。\n现在还不能确定：写清具体缺口以及为什么不能把话说死。\n下一步只做：只写一个家庭现在能完成的动作，不得出现编号清单或多个动作。\n三行后可补必要解释。可以有火气、反问和比喻，可以骂选择瞎、策略蠢、宣传扯淡，但不能骂学生或家长。禁止 Markdown 符号、内部评分术语和万能检查清单。\n${replyPlan.instruction}`:replyPlan.instruction})}),
    })
    if(!response.ok)throw new Error(`AI 服务返回 ${response.status}`)
    const body=await response.json() as {choices?:Array<{message?:{content?:string}}>}
    const result=body.choices?.[0]?.message?.content?.trim()
    if(!result)throw new Error('AI 服务没有返回有效内容')
    return result
  }finally{clearTimeout(timeout)}
}

function buildEvidenceRefs(context:AdvisorReplyContext):AdvisorEvidenceRef[]{
  if(!context.schoolDetail)return []
  const records=(context.schoolDetail.admissionContext?.records as Array<{year:number;unitName:string;sourceUrl:string|null;publisher:string|null}>|undefined)??[]
  const seen=new Set<string>(),refs:AdvisorEvidenceRef[]=[]
  for(const record of records){
    if(!record.sourceUrl||seen.has(record.sourceUrl))continue
    seen.add(record.sourceUrl)
    refs.push({title:`${record.year} 年${record.unitName}招生记录`,year:record.year,publisher:record.publisher||'招生数据发布方待核对',url:record.sourceUrl})
  }
  return refs.slice(0,5)
}

export function buildLocalAdvisorReply(context:AdvisorReplyContext,message:string,memory?:ReturnType<typeof buildConversationMemory>,plannedReply?:ReplyPlan){
  const replyPlan=plannedReply??planReply(message,memory,context)
  if(replyPlan.kind==='greeting')return '你好，我在。学校、专业、就业、考研，或者家里正争得拿不定主意的事，你直接说。别怕问得外行，我负责把绕人的话翻成大白话。'
  if(replyPlan.kind==='thanks')return '好，能听明白就行。后面哪一所学校、哪一个专业拿不准，接着问，我还按咱们刚才的条件往下说。'
  if(replyPlan.kind==='remember')return '记住了，这个条件后面会跟着当前会话走。等比较学校、专业或培养年限时，我会把它当成限制来用，不让你一遍遍重说。'
  if(replyPlan.kind==='identity')return '我是知向里的 AI 规划顾问，不是真人。你可以把我当成一个帮家里查资料、翻译志愿术语、把风险说明白的助手；我不会替你改专业档位，也不会保证录取。哪项数据没有，我会直接说没有。'
  if((replyPlan.kind==='major-interest'||replyPlan.kind==='repair-repeat')&&replyPlan.targetMajor&&context.schoolDetail)return buildSchoolMajorReply(context.schoolDetail,replyPlan.targetMajor,replyPlan.kind==='repair-repeat')
  if(replyPlan.kind==='repair-repeat')return `你说得对，我刚才确实没有接住你的问题，还在重复原来的说明。咱们重新来：你只用一句话告诉我现在最想确认什么，我这次只回答这一件事，不再套前面的模板。`
  if(replyPlan.kind==='major-eligibility'&&replyPlan.targetMajor)return buildDirectMajorReply(context,replyPlan.targetMajor,memory)
  const remembered=[buildNaturalMemoryBridge(memory),buildDiscussionNoteBridge(context)].filter(Boolean).join(' ')
  if(replyPlan.kind==='emotion')return buildEmotionalReply(context,remembered)
  if(replyPlan.kind==='postgraduate')return buildPostgraduateReply(context,remembered)
  if(replyPlan.kind==='employment')return buildEmploymentReply(context,message,remembered)
  if(replyPlan.kind==='school-vs-major')return buildSchoolVsMajorReply(context,remembered)
  if(replyPlan.kind==='school-fact'&&context.schoolDetail)return buildSchoolFactReply(context.schoolDetail,message)
  if(context.schoolDetail)return replyPlan.kind==='school-overview'
    ?buildConversationalSchoolReply(context.schoolDetail,replyPlan.localPlace,remembered)
    :buildLocalSchoolReply(context.schoolDetail,remembered)
  const profile=context.profile
  const cards=context.dashboard.cards
  const focus=context.focusedMajor?[context.focusedMajor]:cards.filter(item=>message.includes(item.name)).slice(0,2)
  const compared=focus.length?focus:cards.slice(0,3)
  const names=compared.map(item=>`${item.name}（${item.band}）`).join('、')
  const planningCoordinate=advisorPlanningCoordinate(context)
  const rank=planningCoordinate.rank?planningCoordinate.rank.toLocaleString():'还没有可靠数据'
  const facts=names?`当前工作台能拿来比较的是：${names}。这里的档位只是比较顺序，不是说这个专业“最适合”谁，我也不会在聊天里偷偷改顺序。`:'当前工作台没有足够的专业证据。我宁可明确说资料不够，也不会临时编一个专业给你。'
  const employment=context.dashboard.employment.usable?'最近30天的招聘样本当前达到使用门槛，但它只说明公开岗位样本，不等于就业率和工资保证。':'当前招聘来源数量或更新时间没有达到使用门槛，就业这一块不能硬下结论。'
  return transparentAnswer(`${profile.studentName}是${profile.province}${profile.subjectGroup}，最近 ${planningCoordinate.sampleCount} 次有效位次形成的综合规划位次约为第${rank}名；当前已有专业方向可供比较。`,`${employment}${planningCoordinate.stability==='volatile'?' 近期位次波动较大，不能把这个坐标当高考预测。':''}${names?' 这些档位只是比较顺序，不代表一定适合。':' 当前也没有足够的专业证据。'}`,'告诉我你现在最想先解决学校、专业还是就业。',`${facts}\n\n先守住能录取的范围，再挑孩子愿意学、普通毕业生也有出口的专业。只看校名或者追热门，都是拿四年时间碰运气。${remembered?` ${remembered}`:''}`)
}

function buildSchoolFactReply(detail:NonNullable<AdvisorReplyContext['schoolDetail']>,message:string){
  if(/在哪|地址|哪个城市/.test(message))return transparentAnswer(`${detail.school.name}在${detail.school.province}${detail.school.city}。`,'当前资料没有具体校区地址，也不能据此判断从你家过去要多久。','按目标专业对应的校区查一次实际路线。')
  if(/学费|住宿费/.test(message))return transparentAnswer(`当前本地资料只核验到${detail.school.name}的院校基础信息，没有收录收费标准。`,'该校当年的学费和住宿费具体是多少，现在不能张嘴报数。','打开当年招生章程或收费公示，查目标专业一年的总费用。','不同专业和培养项目可能收费不同，尤其校企合作、中外合作，不能拿普通专业的收费代替。')
  if(/宿舍|寝室/.test(message))return transparentAnswer(`当前本地院校资料没有收录${detail.school.name}的住宿条件。`,'具体校区、几人间和是否统一分配都不能确认。','查看学校当年的新生住宿通知。','旧帖子和宣传图可能对应别的校区，我不拿它们糊弄你。')
  return transparentAnswer(`${detail.school.name}在${detail.school.province}${detail.school.city}。`,'当前没有从你家出发的可靠路线和往返成本数据。','按你家出发地查一次实际车次和用时。','不能凭“省内”两个字就说近。')
}

function buildEmotionalReply(context:AdvisorReplyContext,remembered=''){
  const target=context.focusedMajor?`${context.focusedMajor.name}这个专业`:'学校和专业的取舍'
  return `纠结很正常，怕的不是纠结，怕的是一家人越聊越多，最后连在纠结什么都说不清。${remembered?` ${remembered}`:''}\n\n咱们先只拆${target}：你最怕的是录不上、毕业没工作，还是家里承担不起培养成本？挑最怕的一项说。先把最大的雷排掉，剩下的才有资格谈喜欢。`
}

function buildPostgraduateReply(context:AdvisorReplyContext,remembered=''){
  const major=context.focusedMajor
  const directScore=major?.factors.directEntry.value
  const confirmed=major?(directScore===100?`${major.name}当前核对到的岗位方向，本科毕业可以直接进入。`:`${major.name}目前只有部分岗位方向支持本科直接进入。`):'当前还没有锁定具体专业。'
  const unknown=major?'现有资料不能证明读研一定更好，还要看目标岗位的学历门槛。':'没有具体专业，无法判断本科就业出口和读研价值。'
  return transparentAnswer(confirmed,unknown,major?'查看目标岗位明确写出的学历要求。':'告诉我你正在考虑的一个专业。',`别把考研当成默认答案。只会劝孩子“以后考研”，却说不清本科毕业能干什么，这不是规划，是把问题往后拖。${remembered?` ${remembered}`:''}`)
}

function buildEmploymentReply(context:AdvisorReplyContext,message:string,remembered=''){
  const mentioned=context.dashboard.cards.find(card=>message.includes(card.name))??context.focusedMajor
  const employment=context.dashboard.employment
  if(!mentioned)return transparentAnswer('当前还没有锁定具体专业。','没有专业名称，就无法判断普通本科生能进入哪些岗位。','告诉我你正在考虑的一个专业。',`就业这事不能听“前景不错”四个字，那是最省事也最没用的回答。${remembered?` ${remembered}`:''}`)
  const confirmed=`${mentioned.name}有经过审核的就业方向，${mentioned.factors.directEntry.evidence.replace('三个审核岗位方向中，','其中')}。`
  const unknown=employment.usable?'招聘样本只能说明公开岗位情况，不能当成就业率或工资保证。':'当前招聘来源没有达到使用门槛，不能判断就业率和薪资。'
  return transparentAnswer(confirmed,unknown,'查看一个目标岗位的学历、证书和实习要求。',`有岗位，不等于普通本科生一定够得着。谁现在拍胸脯报就业率和工资，谁就是在编。${remembered?` ${remembered}`:''}`)
}

function buildSchoolVsMajorReply(context:AdvisorReplyContext,remembered=''){
  const rank=advisorPlanningCoordinate(context).rank?.toLocaleString()??'还没填可靠位次'
  return transparentAnswer(`你现在是${context.profile.province}${context.profile.subjectGroup}，综合规划位次大约排第${rank}名；有明确职业门槛的方向，优先保专业。`,'还不知道你家更不能接受学校层次低一点，还是专业以后难转行。','告诉我这两种风险里，你家更不能接受哪一种。',`专业出口差不多时，再选学校和城市。别一听校名就上头——毕业招聘时，人家问你会什么，不会因为学校名字好听就替你补技能。${remembered?` ${remembered}`:''}`)
}

function buildConversationalSchoolReply(detail:NonNullable<AdvisorReplyContext['schoolDetail']>,localPlace?:string,remembered=''){
  const school=detail.school
  const records=comparableAdmissionRecords(detail)
  const latestYear=records[0]?.year
  const risks=[...new Set(records.map(item=>item.risk).filter(Boolean))]
  const isNearby=Boolean(localPlace&&(school.city.includes(localPlace)||school.province.includes(localPlace)))
  const locationLine=isNearby
    ?`你是${localPlace}人，离家近确实省心：路费、回家和生活适应都轻松一些。可我得把话说重一点——离家近是加分项，不是报考理由。`
    :localPlace
      ?`你是${localPlace}人，地域和生活成本当然要算。可我得把话说重一点——离家近是加分项，不是报考理由，更不能替专业做决定。`
      :'地域可以算生活成本，不能替专业做决定。'
  const featured=detail.featuredMajors.length
    ?`目前有核验依据的优势专业包括${detail.featuredMajors.slice(0,3).map(item=>item.name).join('、')}。这才是看这所学校的抓手，别只看校名。`
    :`当前没有查到经核验的优势专业材料。宣传页说得再热闹，没有依据，我这里就不替它吹。`
  const admission=records.length
    ?`你这个档案能对上${latestYear}年等 ${new Set(records.map(item=>item.year)).size} 个年份的招生记录${risks.length?`，现有记录里出现${risks.join('、')}档参考`:''}。但学校线能过，不等于你想学的专业也能进。`
    :'你当前省份和科类还没有可直接比较的招生记录，所以现在谁要拍胸脯说“稳”，谁就是在拿你的志愿赌。'
  const confirmed=`${school.name}能看，但别急着报。它在${school.city}，是${school.level}${school.schoolType}院校；离家近不能代替专业选择。`
  const unknown=records.length?'现有学校或专业组记录不能证明你想学的专业一定在里面。':'当前没有你所在省份和科类的可比招生记录，也没有经核验的优势专业材料。'
  return transparentAnswer(confirmed,unknown,`告诉我你最想学什么专业。`,`${locationLine}${remembered?` ${remembered}`:''}\n\n${featured}${admission}\n\n专业对口、位次够，它可以认真比较；专业都没核对，只因为离家近或校名顺耳就往里冲，这叫瞎报，不叫规划。`)
}

function buildSchoolMajorReply(detail:NonNullable<AdvisorReplyContext['schoolDetail']>,targetMajor:string,isRepair:boolean){
  const records=(detail.admissionContext?.records as Array<{year:number;unitType:string;unitName:string;subjectRequirement:string|null;minRank:number|null;batch:string;recommendationEligible:boolean}>|undefined)??[]
  const exactRecords=records.filter(item=>item.unitType==='exact_major'&&item.unitName.includes(targetMajor))
  const profileProvince=String(detail.admissionContext?.profileProvince??'当前省份')
  const subjectGroup=String(detail.admissionContext?.subjectGroup??'当前科类')
  const opening=isRepair?`你说得对，我刚才确实在重复学校介绍，没有接住你想学${targetMajor}这件事。咱们重新说。`:`想学${targetMajor}没问题，咱们就只看${detail.school.name}的${targetMajor}，不绕去讲别的。`
  if(exactRecords.length){const latest=exactRecords[0],coordinate=latest.minRank?`，往年最低位次是 ${latest.minRank.toLocaleString()}`:'';return transparentAnswer(`${latest.year}年${detail.school.name}在${profileProvince}${subjectGroup}的${latest.batch}有“${latest.unitName}”${coordinate}。`,'往年记录不能保证今年继续招生或录取，特殊批次还要核对资格。',`查看该校今年${targetMajor}的招生计划。`,opening)}
  return transparentAnswer(`当前只查到${detail.school.name}的学校或专业组记录。`,`现有资料没有证明这个组里明确包含${targetMajor}，所以不能说你能报到这个专业。`,`查看该校当年招生专业目录里有没有${targetMajor}。`,`${opening}\n\n学校线能过，不等于想学的专业也能进，我不能拿学校线糊弄你。`)
}

function buildNaturalMemoryBridge(memory?:ReturnType<typeof buildConversationMemory>,targetMajor?:string){
  if(!memory)return ''
  const userContext=[memory.summary,...memory.recent.filter(item=>item.role==='user').map(item=>item.content)].join(' ')
  if(targetMajor&&userContext.includes(targetMajor)&&/(?:喜欢|想学|感兴趣|想报)/.test(userContext))return `我记得你更想看${targetMajor}，咱们就围绕它说。`
  const constraints=['四年本科','不读研','必须读研','预算','学费','离家近','省内','省外'].filter(term=>userContext.includes(term))
  return constraints.length?`你前面说的${constraints.slice(0,2).join('、')}，我还记着。`:''
}

function buildDiscussionNoteBridge(context:AdvisorReplyContext){
  const notes=(context.dashboard.savedItems??[]).filter(item=>item.note?.trim()).slice(0,2)
  if(!notes.length)return ''
  return `你们在家庭讨论备注里写了“${notes.map(item=>item.note!.trim()).join('；')}”，这是家里给的条件，不是官方事实，我会拿它继续追问，不会偷改排序。`
}

function buildDirectMajorReply(context:AdvisorReplyContext,targetMajor:string,memory?:ReturnType<typeof buildConversationMemory>){
  const card=context.dashboard.cards.find(item=>item.name.includes(targetMajor)||targetMajor.includes(item.name))
  const rank=advisorPlanningCoordinate(context).rank?.toLocaleString()??'还没填可靠位次'
  const bridge=buildNaturalMemoryBridge(memory,targetMajor)
  const currentEvidence=card
    ?`当前工作台里，${card.name}在“${card.band}”，说明它值得继续核对；但这个档位只是比较顺序，不等于哪所学校一定能录。`
    :`你现在是${context.profile.province}${context.profile.subjectGroup}，综合规划位次（最近多次全省位次的稳健中间位置）是${rank}。现有证据还没有确认具体学校的专业组里一定包含${targetMajor}。`
  const confirmed=card?`${card.name}已经在当前专业工作台中，可以继续作为备选。`:`你的档案满足继续了解${targetMajor}的基本条件。`
  const unknown=`现有资料没有确认具体学校的招生单元里一定包含${targetMajor}，所以不能判断哪所学校能录。`
  return transparentAnswer(confirmed,unknown,`告诉我一所你想报的学校。`,`${bridge?`${bridge} `:''}${currentEvidence}\n\n“能填这个专业”和“能被某所学校录取”是两回事，别把这两件事混在一起。`)
}

function buildLocalSchoolReply(detail:NonNullable<AdvisorReplyContext['schoolDetail']>,remembered=''){
  const records=comparableAdmissionRecords(detail)
  const recordSummary=records.slice(0,3).map(item=>`${item.year}年${item.unitName}往年最低位次 ${item.minRank.toLocaleString()}${item.risk?`，按往年位置暂放在${item.risk}档`:''}`).join('；')
  const evidence=recordSummary||'当前档案所在省份和科类，暂时没有这所学校可直接比较的招生记录。'
  const featured=detail.featuredMajors.length?`查到 ${detail.featuredMajors.length} 条经核验的优势专业记录。`:'还没有经核验的优势专业数据。'
  const confirmed=records.length?`${detail.school.name}能看，但别急着报；当前有${new Set(records.map(item=>item.year)).size}个年份的招生记录可以比较。`:`${detail.school.name}可以先看，暂时不能下报考结论；目前只核对了院校名称、层次和所在地。`
  const unknown=records.length?'这些记录不能自动证明专业组里一定有孩子想学的专业。':'当前档案所在省份和科类没有可比招生记录，不能判断报考位置。'
  return transparentAnswer(confirmed,unknown,'告诉我孩子最想学的一个专业。',`${featured}${evidence}\n\n学校线、专业组线和具体专业线不是一回事。专业组就是学校把几个专业绑在一起招生；组里没有目标专业，分数看着够也没用。${remembered?` ${remembered}`:''}`)
}

function comparableAdmissionRecords(detail:NonNullable<AdvisorReplyContext['schoolDetail']>){
  const records=(detail.admissionContext?.records as Array<{year:number;unitType:string;unitName:string;subjectRequirement:string|null;minRank:number|null;risk:string|null;confidence:string;sourceUrl:string|null;recommendationEligible:boolean}>|undefined)??[]
  return records.filter((record):record is typeof record & {minRank:number}=>record.recommendationEligible&&record.minRank!=null)
}
