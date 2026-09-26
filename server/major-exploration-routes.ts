import { Router } from 'express'
import { z } from 'zod'
import { database, type DatabaseRow } from './database.js'
import { buildExplorationList, loadExplorationCatalog, loadExplorationDetail, type ExplorationContext } from './major-exploration.js'

const positiveId = z.coerce.number().int().positive().safe()
const admissionYear = z.coerce.number().int().min(2000).max(2100).default(() => new Date().getFullYear())
const baseQuerySchema = z.object({ admissionYear }).strict()
const catalogQuerySchema = z.object({
  admissionYear,
  search: z.string().trim().max(100).default(''),
  category: z.string().trim().max(100).default(''),
  page: positiveId.max(10000).default(1),
  pageSize: positiveId.max(50).default(20),
}).strict()
const detailQuerySchema = z.object({
  admissionYear,
  schoolId: positiveId.optional(),
  sourceYear: z.coerce.number().int().min(2000).max(2100).optional(),
}).strict()

export async function loadExplorationProfile(profileId: string, year: number): Promise<ExplorationContext | null> {
  const [profiles] = await database.query<DatabaseRow[]>(`SELECT p.name province,sp.subject_group subjectGroup,
    sp.selected_subjects selectedSubjects FROM student_profiles sp JOIN provinces p ON p.id=sp.province_id WHERE sp.id=?`, [profileId])
  if (!profiles[0]) return null
  const profile = profiles[0]
  const [savedItems] = await database.query<DatabaseRow[]>(`SELECT item_type itemType,item_id itemId,state,note
    FROM profile_saved_items WHERE profile_id=? ORDER BY created_at,item_type,item_id`, [profileId])
  const selected = typeof profile.selectedSubjects === 'string' ? JSON.parse(profile.selectedSubjects) : profile.selectedSubjects
  return { province: String(profile.province), subjectGroup: String(profile.subjectGroup), admissionYear: year,
    selectedSubjects: Array.isArray(selected) ? selected.filter((value): value is string => typeof value === 'string') : [],
    savedItems: savedItems.map(item => ({ itemType: item.itemType, itemId: Number(item.itemId), state: item.state, note: item.note ?? null })) }
}

export const majorExplorationRouter = Router()

majorExplorationRouter.get('/profiles/:id/major-exploration', async (request, response, next) => {
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const query = baseQuerySchema.parse(request.query)
    const context = await loadExplorationProfile(profileId, query.admissionYear)
    if (!context) { response.status(404).json({ success: false, data: null, error: '学生档案不存在', requestId: response.locals.requestId }); return }
    const data = await buildExplorationList(database, context)
    response.json({ success: true, data, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

majorExplorationRouter.get('/profiles/:id/major-exploration/catalog', async (request, response, next) => {
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const query = catalogQuerySchema.parse(request.query)
    const context = await loadExplorationProfile(profileId, query.admissionYear)
    if (!context) { response.status(404).json({ success: false, data: null, error: '学生档案不存在', requestId: response.locals.requestId }); return }
    const { admissionYear: _year, ...catalogQuery } = query
    const data = await loadExplorationCatalog(database, context, catalogQuery)
    response.json({ success: true, data, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

majorExplorationRouter.get('/profiles/:id/major-exploration/:majorId', async (request, response, next) => {
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const majorId = positiveId.parse(request.params.majorId)
    const query = detailQuerySchema.parse(request.query)
    const context = await loadExplorationProfile(profileId, query.admissionYear)
    if (!context) { response.status(404).json({ success: false, data: null, error: '学生档案不存在', requestId: response.locals.requestId }); return }
    const data = await loadExplorationDetail(database, context, majorId, { schoolId: query.schoolId ?? null, sourceYear: query.sourceYear ?? null })
    if (!data) { response.status(404).json({ success: false, data: null, error: '专业不存在', requestId: response.locals.requestId }); return }
    response.json({ success: true, data, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})
