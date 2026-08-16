import { Router } from 'express'
import type { DatabaseRow as RowDataPacket } from './database.js'
import { z } from 'zod'
import { collectEmploymentData } from './job-collector.js'
import { database } from './database.js'

export const employmentRouter = Router()
let syncInFlight: Promise<Awaited<ReturnType<typeof collectEmploymentData>>> | null = null
const sourceSchema = z.object({ name: z.string().trim().min(2).max(100), sourceType: z.enum(['official','public_platform','employer']), baseUrl: z.string().url().refine(value => /^https?:\/\//.test(value), '只允许 HTTP(S) 地址'), termsUrl: z.string().url().nullable().optional(), collectionPolicy: z.string().trim().min(2).max(1000) })

employmentRouter.get('/admin/employment/sources', async (request, response, next) => {
  try {
    if (!isLoopback(request.ip)) { response.status(403).json({ success:false,data:null,error:'数据源管理仅允许在服务器本机执行',requestId:response.locals.requestId }); return }
    const [rows] = await database.query<RowDataPacket[]>(`SELECT id,name,source_type sourceType,base_url baseUrl,access_policy_url termsUrl,collection_policy collectionPolicy,status,last_success_at lastSuccessAt,last_failure_at lastFailureAt,failure_count failureCount FROM job_sources ORDER BY id`)
    response.json({success:true,data:rows,error:null,requestId:response.locals.requestId})
  } catch (error) { next(error) }
})

employmentRouter.put('/admin/employment/sources', async (request, response, next) => {
  try {
    if (!isLoopback(request.ip)) { response.status(403).json({ success:false,data:null,error:'数据源管理仅允许在服务器本机执行',requestId:response.locals.requestId }); return }
    const input=sourceSchema.parse(request.body)
    await database.execute(`INSERT INTO job_sources(name,source_type,base_url,access_policy_url,collection_policy,status) VALUES (?,?,?,?,?,'degraded') ON CONFLICT (base_url) DO UPDATE SET name=EXCLUDED.name,source_type=EXCLUDED.source_type,access_policy_url=EXCLUDED.access_policy_url,collection_policy=EXCLUDED.collection_policy,status='degraded'`,[input.name,input.sourceType,input.baseUrl,input.termsUrl??null,input.collectionPolicy])
    response.json({success:true,data:input,error:null,requestId:response.locals.requestId})
  } catch (error) { next(error) }
})

employmentRouter.get('/employment/status', async (_request, response, next) => {
  try {
    const [rows] = await database.query<RowDataPacket[]>(
      `SELECT COUNT(*) sourceCount,COUNT(*) FILTER (WHERE status='healthy' AND last_success_at>=NOW()-INTERVAL '7 days') healthySourceCount,MAX(last_success_at) lastSuccessAt,
       CURRENT_DATE-MAX(last_success_at)::date staleDays FROM job_sources`,
    )
    const status = rows[0]
    response.json({ success: true, data: { sourceCount: Number(status.sourceCount ?? 0), healthySourceCount: Number(status.healthySourceCount ?? 0), lastSuccessAt: status.lastSuccessAt ?? null, staleDays: status.staleDays == null ? null : Number(status.staleDays), usable: Number(status.healthySourceCount ?? 0) >= 2 && Number(status.staleDays ?? 99) <= 7 }, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

employmentRouter.post('/admin/employment/sync', async (request, response, next) => {
  try {
    if (!isLoopback(request.ip)) { response.status(403).json({ success: false, data: null, error: '就业数据同步仅允许在服务器本机执行', requestId: response.locals.requestId }); return }
    const result = await runEmploymentSync()
    response.json({ success: true, data: result, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

employmentRouter.post('/employment/sync-if-stale', (_request, response) => {
  response.json({
    success: true,
    data: { triggered: false, reason: 'manual-only' },
    error: null,
    requestId: response.locals.requestId,
  })
})

function runEmploymentSync() {
  if (syncInFlight) return syncInFlight
  syncInFlight=collectEmploymentData().finally(()=>{syncInFlight=null})
  return syncInFlight
}

function isLoopback(ip?: string) { return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' }
