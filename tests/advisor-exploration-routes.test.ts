import express from 'express'
import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state=vi.hoisted(() => ({detail:null as unknown,profileExists:true,sql:[] as string[],
  conversations:new Map<string,Record<string,unknown>>(),messages:[] as Array<Record<string,any>>,sequence:0}))
const service=vi.hoisted(() => ({detail:vi.fn(),profile:vi.fn()}))
const db=vi.hoisted(() => ({ execute:vi.fn(),query:vi.fn(),getConnection:vi.fn() }))
vi.mock('../server/config.js', () => ({config:{AI_BASE_URL:'',AI_API_KEY:'',AI_MODEL:''}}))
vi.mock('../server/database.js', () => ({database:db}))
vi.mock('../server/profession-dashboard.js', () => ({buildProfessionDashboard:vi.fn(async () => ({mode:'exploration',cards:[],planningCoordinate:{rank:null},employment:{usable:false},savedItems:[]}))}))
vi.mock('../server/major-exploration-routes.js', () => ({loadExplorationProfile:service.profile}))
vi.mock('../server/major-exploration.js', async original => ({...await original<typeof import('../server/major-exploration.js')>(),loadExplorationDetail:service.detail}))
vi.mock('../server/school-detail.js', () => ({loadSchoolDetail:vi.fn(),SchoolDetailLookupError:class extends Error{constructor(readonly status:number,message:string){super(message)}}}))
import { advisorRouter } from '../server/advisor.js'
import { advisorLearningDetail } from './fixtures/advisor-exploration.js'

const profileId='40000000-0000-4000-8000-000000000001'
const app=express();app.use(express.json());app.use((_request,response,next) => {response.locals.requestId='advisor-learning-test';next()});app.use('/api',advisorRouter)
app.use((error:unknown,_request:express.Request,response:express.Response,_next:express.NextFunction) => response.status(error instanceof ZodError?422:500).json({success:false,error:'合成测试错误'}))
const server=app.listen(0)
function endpoint(path='') {const address=server.address();if(!address||typeof address==='string')throw new Error('测试端口无效');return `http://127.0.0.1:${address.port}/api/profiles/${profileId}/advisor/conversations${path}`}
const send=(path:string,body:unknown) => fetch(endpoint(path),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
const create=(id=12,clientMessageId=randomUUID()) => send('',{focus:{type:'major',majorId:id},initialMessage:'这个专业当前课程是什么？',clientMessageId})

function execute(sql:string,params:any[]=[]) {
  state.sql.push(sql)
  if(sql.includes('FROM student_profiles sp'))return [state.profileExists?[{studentName:'合成测试',province:'河南',subjectGroup:'物理类',score:null,provinceRank:null}]:[],[]]
  if(sql.includes('SELECT m.id,m.conversation_id'))return [state.messages.filter(m => m.role==='user'&&m.clientMessageId===params[1]).map(m => ({id:m.id,conversationId:m.conversationId})),[]]
  if(sql.startsWith('INSERT INTO advisor_conversations')){
    const [id,profile,focus_type,focus_id,focus_name,title]=params;state.conversations.set(id,{id,profile_id:profile,focus_type,focus_id,focus_name,title,memory_summary:null,summarized_through_message_id:null});return [{affectedRows:1,insertId:0},[]]
  }
  if(sql.includes('FROM advisor_conversations WHERE id=?')){
    const item=state.conversations.get(params[0]);if(!item)return [[],[]]
    return [[{...item,focusType:item.focus_type,focusId:item.focus_id,focusName:item.focus_name,createdAt:'2026-09-26T00:00:00Z',updatedAt:'2026-09-26T00:00:00Z'}],[]]
  }
  if(sql.startsWith('INSERT INTO advisor_conversation_messages')){
    const user=sql.includes("'user'");const id=++state.sequence
    state.messages.push({id,conversationId:params[0],role:user?'user':'assistant',content:params[1],clientMessageId:user?params[2]:undefined,replyToMessageId:user?undefined:params[2],status:user?'pending':'complete',createdAt:'2026-09-26T00:00:00Z'})
    return [{affectedRows:1,insertId:id},[]]
  }
  if(sql.includes('FROM advisor_conversation_messages')){
    let rows=state.messages
    if(sql.includes('WHERE id=?'))rows=rows.filter(m => m.id===params[0])
    else {rows=rows.filter(m => m.conversationId===params[0]);if(sql.includes('client_message_id=?'))rows=rows.filter(m => m.clientMessageId===params[1]);else if(sql.includes('reply_to_message_id=?'))rows=rows.filter(m => m.replyToMessageId===params[1]);else if(sql.includes('id<?'))rows=rows.filter(m => m.id<params[1]&&m.id>params[2])}
    return [rows,[]]
  }
  if(sql.startsWith('UPDATE advisor_conversation_messages')){const message=state.messages.find(m => m.id===params[0]);if(message)message.status='complete';return [{affectedRows:1},[]]}
  if(sql.startsWith('UPDATE advisor_conversations'))return [{affectedRows:1},[]]
  return [[],[]]
}

describe('专业顾问共享详情、焦点门禁与当前材料 HTTP', () => {
  beforeEach(() => {
    vi.clearAllMocks();state.detail=advisorLearningDetail();state.profileExists=true;state.sql=[];state.conversations.clear();state.messages=[];state.sequence=0
    db.execute.mockImplementation(async (sql,params) => execute(sql,params));db.query.mockImplementation(async (sql,params) => execute(sql,params))
    db.getConnection.mockResolvedValue({beginTransaction:vi.fn(),execute:db.execute,commit:vi.fn(),rollback:vi.fn(),release:vi.fn()})
    service.profile.mockImplementation(async () => state.profileExists?{province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','生物','地理'],admissionYear:2026}:null)
    service.detail.mockImplementation(async (_db,_profile,id) => id===12?state.detail:null)
  })
  afterAll(() => new Promise<void>((resolve,reject) => server.close(error => error?reject(error):resolve())))
  it('首屏 cards 之外的审核 ID 用共享详情创建准确焦点和标题', async () => {
    const response=await create();expect(response.status).toBe(201)
    const result=(await response.json()).data
    expect(result.focus).toEqual({type:'major',majorId:12,majorName:'合成专业十二'})
    expect(result.conversation.focus).toEqual(result.focus);expect(result.conversation.title).toBe('讨论合成专业十二')
    expect(result.assistantMessage.content).toContain('材料观察与记录')
    expect(service.detail).toHaveBeenCalledWith(db,expect.objectContaining({selectedSubjects:['物理','生物','地理'],admissionYear:new Date().getFullYear()}),12)
    expect(state.conversations.size).toBe(1);expect(state.messages).toHaveLength(2)
    expect(state.sql.some(sql => sql.includes('profile_assessments')||sql.includes('profile_preferences'))).toBe(false)
  })
  it('同一次发送重试幂等，只返回历史 stored、不生成第二份会话或证据', async () => {
    const key=randomUUID();const first=(await (await create(12,key)).json()).data
    const retry=(await (await create(12,key)).json()).data
    expect(retry.conversation.id).toBe(first.conversation.id);expect(retry.mode).toBe('stored');expect(retry.evidenceRefs).toEqual([])
    expect(state.conversations.size).toBe(1);expect(state.messages).toHaveLength(2);expect(service.detail).toHaveBeenCalledTimes(1)
  })
  it('不存在 ID 404，不创建会话、用户消息或助手消息', async () => {
    const response=await create(2147483647);expect(response.status).toBe(404);expect((await response.json()).error).toBe('专业不存在')
    expect(state.conversations.size).toBe(0);expect(state.messages).toHaveLength(0)
    expect(state.sql.some(sql => sql.startsWith('INSERT'))).toBe(false)
  })
  it.each([0,-1,9007199254740992])('非法专业 ID %s 422且不读取或写入', async id => {
    expect((await create(id)).status).toBe(422);expect(service.detail).not.toHaveBeenCalled();expect(state.sql).toEqual([])
  })
  it('有效但未审核、未收藏 ID 422说明待补，不建立事实会话', async () => {
    state.detail=advisorLearningDetail({state:'pending'})
    const response=await create();expect(response.status).toBe(422);expect((await response.json()).error).toContain('资料待补充')
    expect(state.conversations.size).toBe(0);expect(state.messages).toEqual([])
  })
  it.each(['pending','withdrawn'] as const)('已收藏 %s 允许身份焦点、原始备注和缺口，没有有效事实来源', async status => {
    state.detail=advisorLearningDetail({state:status,saved:true,note:'家庭原文：想先弄懂学习活动'})
    const response=await create();expect(response.status).toBe(201);const result=(await response.json()).data
    expect(result.focus.majorId).toBe(12);expect(result.assistantMessage.content).toContain('家庭原始备注')
    expect(result.assistantMessage.content).toContain(status==='withdrawn'?'撤回':'待補'.replace('補','补'))
    expect(result.assistantMessage.content).not.toContain('合成课程：');expect(result.evidenceRefs).toEqual([])
  })
  it('新 client 每轮重新读取修订材料，下一轮撤回保留收藏和原始备注、不引用历史课程', async () => {
    const first=(await (await create()).json()).data;const path=`/${first.conversation.id}/messages`
    state.detail=advisorLearningDetail({saved:true,curriculum:'当前修订合成课程',note:'  家庭原文\n待核验  '})
    const updated=(await (await send(path,{message:'它目前学什么课程？',clientMessageId:randomUUID()})).json()).data
    expect(updated.assistantMessage.content).toContain('当前修订合成课程');expect(updated.assistantMessage.content).not.toContain('材料观察与记录')
    state.detail=advisorLearningDetail({state:'withdrawn',saved:true,note:'  家庭原文\n待核验  '})
    const withdrawn=(await (await send(path,{message:'这些课程资料还可用吗？',clientMessageId:randomUUID()})).json()).data
    expect(withdrawn.assistantMessage.content).toContain('撤回');expect(withdrawn.assistantMessage.content).toContain('家庭原文')
    expect(withdrawn.assistantMessage.content).not.toContain('当前修订合成课程');expect(withdrawn.evidenceRefs).toEqual([])
    expect(service.detail).toHaveBeenCalledTimes(3);expect(state.messages).toHaveLength(6)
  })
  it('已有专业会话取消收藏且事实撤回后仍能解释缺口，焦点身份保留', async () => {
    const first=(await (await create()).json()).data
    state.detail=advisorLearningDetail({state:'withdrawn',saved:false})
    const response=await send(`/${first.conversation.id}/messages`,{message:'当前材料怎么样？',clientMessageId:randomUUID()})
    expect(response.status).toBe(200);const result=(await response.json()).data
    expect(result.focus.majorId).toBe(12);expect(result.assistantMessage.content).toContain('撤回')
    expect(result.assistantMessage.content).not.toContain('当前收藏记录');expect(result.evidenceRefs).toEqual([])
  })
  it('已有焦点 ID 不存在时下一轮404且不写新的用户消息', async () => {
    const first=(await (await create()).json()).data
    state.detail=null;const response=await send(`/${first.conversation.id}/messages`,{message:'当前材料怎么样？',clientMessageId:randomUUID()})
    expect(response.status).toBe(404);expect(state.messages).toHaveLength(2)
  })
  it('档案不存在404，不读事实、不落会话', async () => {
    state.profileExists=false;expect((await create()).status).toBe(404);expect(service.detail).not.toHaveBeenCalled();expect(state.messages).toEqual([])
  })
})
