import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { DatabaseResult, DatabaseRow as RowDataPacket } from './database.js'
import { z } from 'zod'
import { config } from './config.js'
import { database } from './database.js'
import { buildProfessionDashboard } from './profession-dashboard.js'
import { loadSchoolDetail, SchoolDetailLookupError } from './school-detail.js'
import {generateAdvisorReply,type AdvisorReplyContext} from './advisor-reply.js'
export {isSafeAdvisorAnswer} from './advisor-prompt.js'

export const advisorRouter = Router()
const advisorFocusSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('school'),schoolId:z.number().int().positive()}),
  z.object({type:z.literal('major'),majorId:z.number().int().positive()}),
])
const messageSchema = z.object({ message: z.string().trim().min(2).max(2000),focus:advisorFocusSchema.optional() })
const conversationSchema=z.object({focus:advisorFocusSchema.optional(),initialMessage:z.string().trim().min(2).max(2000),clientMessageId:z.string().uuid()})
const conversationMessageSchema=z.object({message:z.string().trim().min(2).max(2000),clientMessageId:z.string().uuid()})
const conversationPageSchema=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20)})
const messagePageSchema=z.object({beforeId:z.coerce.number().int().positive().optional(),pageSize:z.coerce.number().int().min(1).max(50).default(50)})
const comparisonSchema=z.object({schoolIds:z.array(z.number().int().positive()).min(2).max(4).refine(ids=>new Set(ids).size===ids.length,'院校不能重复')})

advisorRouter.get('/profiles/:id/advisor/messages', async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id)
    const [rows] = await database.execute<RowDataPacket[]>(`SELECT role,content,created_at createdAt FROM advisor_messages WHERE profile_id=? ORDER BY id`, [id])
    response.json({ success: true, data: rows, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

advisorRouter.post('/profiles/:id/advisor/messages', async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id)
    const { message,focus } = messageSchema.parse(request.body)
    const context = await loadContext(id,focus,message)
    const [insertedUser] = await database.execute<DatabaseResult>(`INSERT INTO advisor_messages(profile_id,role,content) VALUES (?,'user',?) RETURNING id`, [id, message])
    const publicFocus=context.schoolDetail?{type:'school' as const,schoolId:context.schoolDetail.school.id,schoolName:context.schoolDetail.school.name}:undefined
    const [oldRows]=await database.execute<RowDataPacket[]>(`SELECT id,role,content FROM advisor_messages WHERE profile_id=? AND id<? ORDER BY id DESC LIMIT 16`,[id,insertedUser.insertId])
    const generated=await generateAdvisorReply({context,message,history:oldRows.reverse().map(row=>({id:Number(row.id),role:row.role,content:String(row.content)}))})
    await database.execute(`INSERT INTO advisor_messages(profile_id,role,content) VALUES (?,'assistant',?)`, [id, generated.answer])
    response.setHeader('Deprecation','true')
    response.json({ success: true, data: { role: 'assistant', content: generated.answer, createdAt: new Date().toISOString(), mode:generated.mode, focus:publicFocus,evidenceRefs:generated.evidenceRefs }, error: null, requestId: response.locals.requestId })
  } catch (error) {
    if(error instanceof SchoolDetailLookupError){response.status(error.status).json({success:false,data:null,error:error.message,requestId:response.locals.requestId});return}
    next(error)
  }
})

advisorRouter.post('/profiles/:id/advisor/conversations',async(request,response,next)=>{
  try{
    const profileId=z.string().uuid().parse(request.params.id)
    const {focus,initialMessage,clientMessageId}=conversationSchema.parse(request.body??{})
    const existing=await findClientMessage(profileId,clientMessageId)
    if(existing){const result=await completeConversationMessage(profileId,String(existing.conversationId),initialMessage,clientMessageId);response.status(201).json({success:true,data:{conversation:await getPublicConversation(profileId,String(existing.conversationId)),...result},error:null,requestId:response.locals.requestId});return}
    const context=await loadContext(profileId,focus,initialMessage)
    const resolvedFocus=context.schoolDetail
      ? {type:'school' as const,id:context.schoolDetail.school.id,name:context.schoolDetail.school.name}
      : context.focusedMajor
        ? {type:'major' as const,id:context.focusedMajor.id,name:context.focusedMajor.name}
        : null
    const id=randomUUID()
    const title=resolvedFocus?`讨论${resolvedFocus.name}`:'新的志愿讨论'
    const connection=await database.getConnection()
    try{await connection.beginTransaction();await connection.execute(`INSERT INTO advisor_conversations(id,profile_id,focus_type,focus_id,focus_name,title) VALUES (?,?,?,?,?,?)`,[id,profileId,resolvedFocus?.type??'general',resolvedFocus?.id??null,resolvedFocus?.name??null,title]);await connection.execute(`INSERT INTO advisor_conversation_messages(conversation_id,role,content,client_message_id,generation_status) VALUES (?,'user',?,?,'pending')`,[id,initialMessage,clientMessageId]);await connection.commit()}catch(error){await connection.rollback();throw error}finally{connection.release()}
    const result=await completeConversationMessage(profileId,id,initialMessage,clientMessageId,context)
    response.status(201).json({success:true,data:{conversation:await getPublicConversation(profileId,id),...result},error:null,requestId:response.locals.requestId})
  }catch(error){if(error instanceof SchoolDetailLookupError){response.status(error.status).json({success:false,data:null,error:error.message,requestId:response.locals.requestId});return}next(error)}
})

advisorRouter.get('/profiles/:id/advisor/conversations',async(request,response,next)=>{
  try{
    const profileId=z.string().uuid().parse(request.params.id)
    const [profiles]=await database.execute<RowDataPacket[]>(`SELECT id FROM student_profiles WHERE id=?`,[profileId])
    if(!profiles[0]){response.status(404).json({success:false,data:null,error:'学生档案不存在',requestId:response.locals.requestId});return}
    const {page,pageSize}=conversationPageSchema.parse(request.query),offset=(page-1)*pageSize
    const [countRows]=await database.execute<RowDataPacket[]>(`SELECT COUNT(*) total FROM advisor_conversations c WHERE c.profile_id=? AND EXISTS(SELECT 1 FROM advisor_conversation_messages m WHERE m.conversation_id=c.id)`,[profileId])
    const [rows]=await database.query<RowDataPacket[]>(`SELECT c.id,c.title,c.focus_type focusType,c.focus_id focusId,c.focus_name focusName,c.created_at createdAt,c.updated_at updatedAt,(SELECT COUNT(*) FROM advisor_conversation_messages m WHERE m.conversation_id=c.id) messageCount,(SELECT LEFT(m.content,80) FROM advisor_conversation_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) lastMessagePreview FROM advisor_conversations c WHERE c.profile_id=? AND EXISTS(SELECT 1 FROM advisor_conversation_messages m WHERE m.conversation_id=c.id) ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?`,[profileId,pageSize,offset])
    response.json({success:true,data:{items:rows.map(toConversationListItem),total:Number(countRows[0]?.total??0),page,pageSize},error:null,requestId:response.locals.requestId})
  }catch(error){next(error)}
})

advisorRouter.get('/profiles/:id/advisor/conversations/:conversationId/messages',async(request,response,next)=>{
  try{
    const profileId=z.string().uuid().parse(request.params.id),conversationId=z.string().uuid().parse(request.params.conversationId)
    const conversation=await getConversation(profileId,conversationId)
    if(!conversation){response.status(404).json({success:false,data:null,error:'会话不存在',requestId:response.locals.requestId});return}
    const {beforeId,pageSize}=messagePageSchema.parse(request.query)
    const params:Array<string|number>=[conversationId],cursorSql=beforeId?' AND id<?':''
    if(beforeId)params.push(beforeId);params.push(pageSize+1)
    const [rows]=await database.query<RowDataPacket[]>(`SELECT id,role,content,client_message_id clientMessageId,reply_to_message_id replyToMessageId,generation_status status,created_at createdAt FROM advisor_conversation_messages WHERE conversation_id=?${cursorSql} ORDER BY id DESC LIMIT ?`,params)
    const hasMore=rows.length>pageSize,selected=rows.slice(0,pageSize),nextCursor=hasMore?Number(selected.at(-1)?.id):null
    response.json({success:true,data:{items:selected.reverse().map(toPublicMessage),nextCursor},error:null,requestId:response.locals.requestId})
  }catch(error){next(error)}
})

advisorRouter.post('/profiles/:id/advisor/conversations/:conversationId/messages',async(request,response,next)=>{
  try{
    const profileId=z.string().uuid().parse(request.params.id),conversationId=z.string().uuid().parse(request.params.conversationId)
    const {message,clientMessageId}=conversationMessageSchema.parse(request.body)
    const result=await completeConversationMessage(profileId,conversationId,message,clientMessageId)
    response.json({success:true,data:result,error:null,requestId:response.locals.requestId})
  }catch(error){if(error instanceof SchoolDetailLookupError){response.status(error.status).json({success:false,data:null,error:error.message,requestId:response.locals.requestId});return}next(error)}
})

advisorRouter.delete('/profiles/:id/advisor/conversations/:conversationId',async(request,response,next)=>{
  try{const profileId=z.string().uuid().parse(request.params.id),conversationId=z.string().uuid().parse(request.params.conversationId);const [result]=await database.execute<DatabaseResult>(`DELETE FROM advisor_conversations WHERE id=? AND profile_id=?`,[conversationId,profileId]);if(!result.affectedRows){response.status(404).json({success:false,data:null,error:'会话不存在',requestId:response.locals.requestId});return}response.status(204).end()}catch(error){next(error)}
})

async function getConversation(profileId:string,conversationId:string){
  const [rows]=await database.execute<RowDataPacket[]>(`SELECT id,focus_type,focus_id,focus_name,memory_summary,summarized_through_message_id FROM advisor_conversations WHERE id=? AND profile_id=?`,[conversationId,profileId])
  return rows[0]??null
}

function toPublicFocus(focus:{type:'school'|'major';id:number;name:string}){
  return focus.type==='school'?{type:'school' as const,schoolId:focus.id,schoolName:focus.name}:{type:'major' as const,majorId:focus.id,majorName:focus.name}
}

function toConversationListItem(row:RowDataPacket){return {...row,messageCount:Number(row.messageCount),focus:row.focusType==='school'?{type:'school',schoolId:Number(row.focusId),schoolName:String(row.focusName)}:row.focusType==='major'?{type:'major',majorId:Number(row.focusId),majorName:String(row.focusName)}:null}}
function toPublicMessage(row:RowDataPacket){return {id:Number(row.id),role:row.role,content:String(row.content),clientMessageId:row.clientMessageId??undefined,replyToMessageId:row.replyToMessageId==null?undefined:Number(row.replyToMessageId),status:row.status??'complete',createdAt:new Date(row.createdAt).toISOString()}}

async function getPublicConversation(profileId:string,conversationId:string){const [rows]=await database.execute<RowDataPacket[]>(`SELECT id,title,focus_type focusType,focus_id focusId,focus_name focusName,created_at createdAt,updated_at updatedAt FROM advisor_conversations WHERE id=? AND profile_id=?`,[conversationId,profileId]);return rows[0]?toConversationListItem({...rows[0],messageCount:0,lastMessagePreview:''} as RowDataPacket):null}
async function findClientMessage(profileId:string,clientMessageId:string){const [rows]=await database.execute<RowDataPacket[]>(`SELECT m.id,m.conversation_id conversationId FROM advisor_conversation_messages m JOIN advisor_conversations c ON c.id=m.conversation_id WHERE c.profile_id=? AND m.client_message_id=? AND m.role='user' LIMIT 1`,[profileId,clientMessageId]);return rows[0]??null}

async function completeConversationMessage(profileId:string,conversationId:string,message:string,clientMessageId:string,loadedContext?:AdvisorReplyContext){
  const conversation=await getConversation(profileId,conversationId)
  if(!conversation)throw new SchoolDetailLookupError(404,'会话不存在')
  let [userRows]=await database.execute<RowDataPacket[]>(`SELECT id,role,content,client_message_id clientMessageId,generation_status status,created_at createdAt FROM advisor_conversation_messages WHERE conversation_id=? AND client_message_id=? AND role='user' LIMIT 1`,[conversationId,clientMessageId])
  if(!userRows[0]){await database.execute(`INSERT INTO advisor_conversation_messages(conversation_id,role,content,client_message_id,generation_status) VALUES (?,'user',?,?,'pending')`,[conversationId,message,clientMessageId]);[userRows]=await database.execute<RowDataPacket[]>(`SELECT id,role,content,client_message_id clientMessageId,generation_status status,created_at createdAt FROM advisor_conversation_messages WHERE conversation_id=? AND client_message_id=? LIMIT 1`,[conversationId,clientMessageId])}
  const user=userRows[0]
  const [replyRows]=await database.execute<RowDataPacket[]>(`SELECT id,role,content,reply_to_message_id replyToMessageId,generation_status status,created_at createdAt FROM advisor_conversation_messages WHERE conversation_id=? AND reply_to_message_id=? AND role='assistant' LIMIT 1`,[conversationId,user.id])
  const focus=conversation.focus_type==='school'?{type:'school' as const,schoolId:Number(conversation.focus_id)}:conversation.focus_type==='major'?{type:'major' as const,majorId:Number(conversation.focus_id)}:undefined
  if(replyRows[0])return {userMessage:toPublicMessage(user),assistantMessage:toPublicMessage(replyRows[0]),mode:'stored',focus:focus?toPublicFocus({type:focus.type,id:Number(conversation.focus_id),name:String(conversation.focus_name)}):null,evidenceRefs:[]}
  const context=loadedContext??await loadContext(profileId,focus,message)
  const resolvedTurnFocus=focus??(context.schoolDetail?{type:'school' as const,schoolId:context.schoolDetail.school.id}:context.focusedMajor?{type:'major' as const,majorId:context.focusedMajor.id}:undefined)
  if(!focus&&resolvedTurnFocus){const resolvedName=context.schoolDetail?.school.name??context.focusedMajor?.name??'当前讨论';await database.execute(`UPDATE advisor_conversations SET focus_type=?,focus_id=?,focus_name=?,title=? WHERE id=? AND profile_id=? AND focus_type='general'`,[resolvedTurnFocus.type,resolvedTurnFocus.type==='school'?resolvedTurnFocus.schoolId:resolvedTurnFocus.majorId,resolvedName,`讨论${resolvedName}`,conversationId,profileId])}
  const [historyRows]=await database.execute<RowDataPacket[]>(`SELECT id,role,content FROM advisor_conversation_messages WHERE conversation_id=? AND id<? AND id>? ORDER BY id`,[conversationId,user.id,Number(conversation.summarized_through_message_id??0)])
  const generated=await generateAdvisorReply({context,message:String(user.content),history:historyRows.map(row=>({id:Number(row.id),role:row.role,content:String(row.content)})),existingSummary:conversation.memory_summary})
  const [inserted]=await database.execute<DatabaseResult>(`INSERT INTO advisor_conversation_messages(conversation_id,role,content,reply_to_message_id,generation_status) VALUES (?,'assistant',?,?,'complete') RETURNING id`,[conversationId,generated.answer,user.id])
  await database.execute(`UPDATE advisor_conversation_messages SET generation_status='complete' WHERE id=?`,[user.id])
  await database.execute(`UPDATE advisor_conversations SET memory_summary=?,summarized_through_message_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[generated.memory.summary||null,generated.memory.summarizedThroughMessageId,conversationId])
  const [assistantRows]=await database.execute<RowDataPacket[]>(`SELECT id,role,content,reply_to_message_id replyToMessageId,generation_status status,created_at createdAt FROM advisor_conversation_messages WHERE id=?`,[inserted.insertId])
  const responseFocus=resolvedTurnFocus?(context.schoolDetail?{type:'school' as const,id:context.schoolDetail.school.id,name:context.schoolDetail.school.name}:{type:'major' as const,id:context.focusedMajor!.id,name:context.focusedMajor!.name}):null
  return {userMessage:toPublicMessage({...user,status:'complete'} as RowDataPacket),assistantMessage:toPublicMessage(assistantRows[0]),mode:generated.mode,focus:responseFocus?toPublicFocus(responseFocus):null,evidenceRefs:generated.evidenceRefs}
}

advisorRouter.post('/profiles/:id/advisor/comparison',async(request,response,next)=>{
  try{
    const profileId=z.string().uuid().parse(request.params.id)
    const {schoolIds}=comparisonSchema.parse(request.body)
    const context=await loadComparisonContext(profileId,schoolIds)
    let content=buildLocalComparisonAnalysis(context.details,context.targetMajor)
    let mode:'ai'|'local'='local'
    if(config.AI_BASE_URL&&config.AI_API_KEY&&config.AI_MODEL){
      try{
        const result=await askComparisonModel(context)
        if(!isSafeComparisonAnswer(result,context.details.map(item=>item.school.name)))throw new Error('AI 院校对比越过解释边界')
        content=result
        mode='ai'
      }catch(error){console.warn('AI 院校对比失败，已切换本地规则：',error instanceof Error?error.message:'未知错误')}
    }
    response.json({success:true,data:{content,mode},error:null,requestId:response.locals.requestId})
  }catch(error){
    if(error instanceof SchoolDetailLookupError){response.status(error.status).json({success:false,data:null,error:error.message,requestId:response.locals.requestId});return}
    next(error)
  }
})

async function loadComparisonContext(profileId:string,schoolIds:number[]){
  const [profiles]=await database.execute<RowDataPacket[]>(`SELECT sp.student_name studentName,p.name province,sp.subject_group subjectGroup,sp.province_rank provinceRank FROM student_profiles sp JOIN provinces p ON p.id=sp.province_id WHERE sp.id=?`,[profileId])
  if(!profiles[0])throw new SchoolDetailLookupError(404,'学生档案不存在')
  const [majorRows]=await database.execute<RowDataPacket[]>(`SELECT m.id,m.name FROM profile_saved_items psi JOIN majors m ON m.id=psi.item_id WHERE psi.profile_id=? AND psi.item_type='major' AND psi.state='saved' ORDER BY psi.updated_at DESC LIMIT 1`,[profileId])
  const details=await Promise.all(schoolIds.map(id=>loadSchoolDetail(id,profileId)))
  return {profile:profiles[0],details,targetMajor:majorRows[0]?{id:Number(majorRows[0].id),name:String(majorRows[0].name)}:null}
}

async function askComparisonModel(context:Awaited<ReturnType<typeof loadComparisonContext>>){
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),12_000)
  const promptContext={profile:context.profile,targetMajor:context.targetMajor,schools:context.details.map(detail=>{
    const records=((detail.admissionContext?.records as Array<{year:number;unitType:string;unitName:string;subjectRequirement:string|null;minRank:number|null;risk:string|null;confidence:string;recommendationEligible:boolean}>|undefined)??[]).filter(record=>record.recommendationEligible&&record.minRank!=null)
    const targetMajor=context.targetMajor?.name
    return {name:detail.school.name,city:detail.school.city,level:detail.school.level,admissionRecords:records.slice(0,3),verifiedFeaturedMajors:detail.featuredMajors.slice(0,3).map(item=>item.name),targetMajorEvidence:targetMajor?{exactAdmission:records.some(record=>record.unitType==='exact_major'&&record.unitName.includes(targetMajor)),verifiedFeatured:detail.featuredMajors.some(item=>item.name.includes(targetMajor)||targetMajor.includes(item.name))}:null,dataGaps:{admission:!records.length,featuredMajors:!detail.featuredMajors.length,officialWebsite:!detail.school.officialUrl,admissionsWebsite:!detail.school.admissionsUrl}}
  })}
  try{
    const response=await fetch(`${config.AI_BASE_URL.replace(/\/$/,'')}/chat/completions`,{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${config.AI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.AI_MODEL,temperature:.2,thinking:{type:'disabled'},messages:[
      {role:'system',content:`你是“知向院校对比助手”。只能引用输入 JSON 中的当前学生档案、招生记录、选科要求、已核验优势专业和数据缺口。硬条件通过后先看 targetMajor 的具体证据，再看位次风险和数据缺口，最后才看城市和学校名气。targetMajor 为空或各校都没有目标专业证据时，必须明确说现在硬选就是看校名瞎报，不得强行站队；证据能分出高下时必须明确说更建议哪所，也可以说另一所不划算或是在赌专业。不得改变冲稳保、声称录取概率或补造事实。必须点名每所院校。只输出四行，每行一句，总字数不超过 360 字：\n我的建议：…\n专业依据：…\n最大风险：…\n下一步只做：…`},
      {role:'user',content:JSON.stringify(promptContext)}
    ]})})
    if(!response.ok)throw new Error(`AI 服务返回 ${response.status}`)
    const body=await response.json() as {choices?:Array<{message?:{content?:string}}>}
    return body.choices?.[0]?.message?.content?.trim()||''
  }finally{clearTimeout(timeout)}
}

export function buildLocalComparisonAnalysis(details:Array<Awaited<ReturnType<typeof loadSchoolDetail>>>,targetMajor:{id:number;name:string}|null=null){
  const facts=details.map(detail=>{
    const records=((detail.admissionContext?.records as Array<{risk:string|null;confidence:string;year:number;minRank:number|null;recommendationEligible:boolean}>|undefined)??[]).filter((record):record is {risk:string|null;confidence:string;year:number;minRank:number;recommendationEligible:true}=>record.recommendationEligible&&record.minRank!=null)
    const record=records[0]
    const position=record?`${record.risk||'核验'}·${record.confidence}，${record.year}位次 ${record.minRank.toLocaleString()}`:'无可比位次'
    const majors=detail.featuredMajors.slice(0,2).map(item=>item.name).join('、')||'优势专业待核验'
    const exactTarget=targetMajor?((detail.admissionContext?.records as Array<{unitType:string;unitName:string;recommendationEligible:boolean}>|undefined)??[]).some(record=>record.recommendationEligible&&record.unitType==='exact_major'&&record.unitName.includes(targetMajor.name)):false
    const featuredTarget=targetMajor?detail.featuredMajors.some(item=>item.name.includes(targetMajor.name)||targetMajor.name.includes(item.name)):false
    return {name:detail.school.name,position,majors,targetEvidence:exactTarget?2:featuredTarget?1:0}
  })
  const missing=details.filter(detail=>!((detail.admissionContext?.records as unknown[]|undefined)?.length)||!detail.featuredMajors.length).map(detail=>detail.school.name)
  const bestEvidence=Math.max(...facts.map(item=>item.targetEvidence))
  const leaders=facts.filter(item=>item.targetEvidence===bestEvidence)
  const advice=!targetMajor
    ?`先不在${facts.map(item=>item.name).join('和')}里硬选；没定想学的专业，只按校名站队就是瞎报。`
    :bestEvidence===0
      ?`先不站队；${facts.map(item=>item.name).join('和')}都没有${targetMajor.name}的明确证据，现在硬选就是拿专业去赌。`
      :leaders.length===1
        ?`我更建议先看${leaders[0]!.name}；它的${targetMajor.name}证据更明确，其他学校暂时不值得排在前面。`
        :`先把${leaders.map(item=>item.name).join('和')}留在同一组；它们的${targetMajor.name}证据暂时分不出高下，不能为了装果断硬选。`
  return `我的建议：${advice}\n专业依据：${facts.map(item=>`${item.name}：${targetMajor?item.targetEvidence===2?`有${targetMajor.name}具体招生记录`:item.targetEvidence===1?`${targetMajor.name}有已核验优势证据`:`没有${targetMajor.name}明确证据`:item.majors}`).join('；')}。\n最大风险：${facts.map(item=>`${item.name}（${item.position}）`).join('；')}${missing.length?`；${missing.join('、')}还有数据缺口`:''}。\n下一步只做：${targetMajor?`核对这些学校今年${targetMajor.name}的招生专业目录。`:'先从收藏专业里定一个最想学的专业。'}`
}

export function isSafeComparisonAnswer(answer:string,schoolNames:string[]){
  const lines=answer.split(/\r?\n/).filter(Boolean)
  const required=['我的建议：','专业依据：','最大风险：','下一步只做：']
  const forbidden=[/录取概率/,/确保录取/,/一定能上/,/最佳院校/]
  return answer.length<=420&&lines.length===4&&required.every((title,index)=>lines[index]?.startsWith(title))&&schoolNames.every(name=>answer.includes(name))&&forbidden.every(pattern=>!pattern.test(answer))
}

async function loadContext(profileId: string,focus?:z.infer<typeof advisorFocusSchema>,message='') {
  const [profiles] = await database.execute<RowDataPacket[]>(`SELECT sp.student_name studentName,p.name province,sp.subject_group subjectGroup,sp.score,sp.province_rank provinceRank FROM student_profiles sp JOIN provinces p ON p.id=sp.province_id WHERE sp.id=?`, [profileId])
  if (!profiles[0]) throw new Error('学生档案不存在')
  const row=profiles[0]
  const profile={studentName:String(row.studentName),province:String(row.province),subjectGroup:String(row.subjectGroup),score:row.score==null?null:Number(row.score),provinceRank:row.provinceRank==null?null:Number(row.provinceRank)}
  const dashboard = await buildProfessionDashboard(profileId)
  const resolvedFocus=focus??await resolveSchoolFocusFromMessage(message)
  const schoolDetail=resolvedFocus?.type==='school'?await loadSchoolDetail(resolvedFocus.schoolId,profileId):null
  const focusedMajor=resolvedFocus?.type==='major'?dashboard.cards.find(card=>card.id===resolvedFocus.majorId)??null:null
  if(resolvedFocus?.type==='major'&&!focusedMajor)throw new SchoolDetailLookupError(404,'专业不存在或不在当前工作台')
  return { profile, dashboard, schoolDetail,focusedMajor }
}

async function resolveSchoolFocusFromMessage(message:string):Promise<z.infer<typeof advisorFocusSchema>|undefined>{
  const compact=message.replace(/[\s，。！？、,.!?：:；;（）()“”"']/g,'')
  if(compact.length<4)return undefined
  const baseExpression=`TRIM(REPLACE(REPLACE(REPLACE(name,'大学',''),'学院',''),'学校',''))`
  const [directRows]=await database.query<RowDataPacket[]>(`SELECT id,name FROM schools WHERE CHAR_LENGTH(${baseExpression})>=4 AND ? LIKE CONCAT('%',${baseExpression},'%') ORDER BY CHAR_LENGTH(${baseExpression}) DESC LIMIT 2`,[compact])
  if(directRows.length===1)return {type:'school',schoolId:Number(directRows[0].id)}
  const candidate=compact.replace(/^(?:请问|帮我看看|帮我查查|我想问|想问|这个)/,'').split(/怎么样|咋样|好不好|值不值得|能不能|的/)[0]
  if(candidate.length<4)return undefined
  const [partialRows]=await database.query<RowDataPacket[]>(`SELECT id,name FROM schools WHERE name LIKE ? ORDER BY CHAR_LENGTH(name),name LIMIT 2`,[`%${candidate}%`])
  return partialRows.length===1?{type:'school',schoolId:Number(partialRows[0].id)}:undefined
}
