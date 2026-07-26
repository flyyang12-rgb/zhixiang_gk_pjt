import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { database } from './database.js'
import { loadSchoolDetail, SchoolDetailLookupError } from './school-detail.js'

export const schoolsRouter = Router()

const querySchema = z.object({
  province: z.string().trim().max(32).optional(),
  level: z.string().trim().max(16).optional(),
  q: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
})

schoolsRouter.get('/schools', async (request, response, next) => {
  try {
    const query = querySchema.parse(request.query)
    const conditions: string[] = []
    const values: Array<string | number> = []
    if (query.province) { conditions.push('p.name = ?'); values.push(query.province) }
    if (query.level) { conditions.push('s.level = ?'); values.push(query.level) }
    if (query.q) { conditions.push('(s.name LIKE ? OR s.city LIKE ?)'); values.push(`%${query.q}%`, `%${query.q}%`) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const offset = (query.page - 1) * query.pageSize
    const [items] = await database.query<RowDataPacket[]>(
      `SELECT s.id, s.name, p.name province, s.city, s.level, s.school_type schoolType, s.features
       FROM schools s JOIN provinces p ON p.id = s.province_id ${where}
       ORDER BY FIELD(s.level, '985', '211', '双一流', '一本', '二本', '本科', '专科'), s.name LIMIT ? OFFSET ?`,
      [...values, query.pageSize, offset],
    )
    const [counts] = await database.query<RowDataPacket[]>(
      `SELECT COUNT(*) total FROM schools s JOIN provinces p ON p.id = s.province_id ${where}`,
      values,
    )
    response.json({ success: true, data: { items, total: Number(counts[0]?.total ?? 0), page: query.page, pageSize: query.pageSize }, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

const detailQuerySchema = z.object({ profileId: z.string().uuid().optional() })
const dataQualityQuerySchema=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(24),q:z.string().trim().max(64).optional()})

schoolsRouter.get('/schools/:id', async (request, response, next) => {
  try {
    const schoolId = z.coerce.number().int().positive().parse(request.params.id)
    const { profileId } = detailQuerySchema.parse(request.query)
    const detail=await loadSchoolDetail(schoolId,profileId)
    response.json({success:true,data:detail,error:null,requestId:response.locals.requestId})
  } catch (error) {
    if(error instanceof SchoolDetailLookupError){response.status(error.status).json({success:false,data:null,error:error.message,requestId:response.locals.requestId});return}
    next(error)
  }
})

schoolsRouter.get('/map/provinces', async (_request, response, next) => {
  try {
    const [rows] = await database.query<RowDataPacket[]>(
      `SELECT p.name, COUNT(s.id) schoolCount,
       SUM(s.level IN ('985','211','双一流')) keyUniversityCount,
       SUM(s.level = '专科') vocationalCount
       FROM provinces p LEFT JOIN schools s ON s.province_id = p.id
       GROUP BY p.id, p.name ORDER BY schoolCount DESC`,
    )
    response.json({ success: true, data: rows.map(row => ({ name: row.name, schoolCount: Number(row.schoolCount), keyUniversityCount: Number(row.keyUniversityCount), vocationalCount: Number(row.vocationalCount) })), error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

schoolsRouter.get('/admin/data-status', async (_request, response, next) => {
  try {
    const [counts] = await database.query<RowDataPacket[]>('SELECT COUNT(*) schoolCount, COUNT(DISTINCT province_id) provinceCount FROM schools')
    const [sources] = await database.query<RowDataPacket[]>('SELECT title, source_url sourceUrl, source_year sourceYear, publisher, published_at publishedAt FROM data_sources ORDER BY collected_at DESC')
    const [coverageRows] = await database.query<RowDataPacket[]>(
      `SELECT p.name province,ap.subject_group subjectGroup,GROUP_CONCAT(DISTINCT ap.year ORDER BY ap.year) years,COUNT(*) recordCount
       FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id
       WHERE p.name IN ('河南','山东','河北') GROUP BY p.name,ap.subject_group ORDER BY p.name,ap.subject_group`,
    )
    const [yearRows] = await database.query<RowDataPacket[]>(
      `SELECT p.name province,ap.year,COUNT(*) recordCount,GROUP_CONCAT(DISTINCT ap.subject_group ORDER BY ap.subject_group) subjectGroups,
       GROUP_CONCAT(DISTINCT ds.publisher SEPARATOR '；') publisher,MAX(ds.source_url) sourceUrl,MAX(ds.collected_at) updatedAt
       FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id LEFT JOIN data_sources ds ON ds.id=ap.source_id
       WHERE p.name IN ('河南','山东','河北') AND ap.year BETWEEN 2023 AND 2025
       GROUP BY p.name,ap.year ORDER BY FIELD(p.name,'河南','山东','河北'),ap.year`,
    )
    const coverage = coverageRows.map(row => ({ province: String(row.province), subjectGroup: String(row.subjectGroup), years: String(row.years).split(',').map(Number), recordCount: Number(row.recordCount) }))
    const yearStatus = yearRows.map(row => ({ province: String(row.province), year: Number(row.year), recordCount: Number(row.recordCount), subjectGroups: String(row.subjectGroups).split(','), publisher: String(row.publisher ?? ''), sourceUrl: String(row.sourceUrl ?? ''), updatedAt: row.updatedAt }))
    response.json({ success: true, data: { schoolCount: Number(counts[0]?.schoolCount ?? 0), provinceCount: Number(counts[0]?.provinceCount ?? 0), sources, coverage, yearStatus }, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

schoolsRouter.get('/admin/school-data-quality',async(request,response,next)=>{
  try{
    const query=dataQualityQuerySchema.parse(request.query)
    const [summaryRows]=await database.query<RowDataPacket[]>(
      `SELECT COUNT(*) totalSchools,
       SUM(s.official_url IS NOT NULL AND s.links_source_url IS NOT NULL) officialVerified,
       SUM(s.admissions_url IS NOT NULL AND s.links_source_url IS NOT NULL) admissionsVerified,
       SUM(EXISTS(SELECT 1 FROM school_featured_major_evidence fme WHERE fme.school_id=s.id AND fme.verified_at IS NOT NULL)) featuredVerified,
       SUM(EXISTS(SELECT 1 FROM admission_programs ap WHERE ap.school_id=s.id AND ap.year BETWEEN 2023 AND 2025)) admissionYearsVerified
       FROM schools s`,
    )
    const row=summaryRows[0]??{}
    const totalSchools=Number(row.totalSchools??0)
    const counts={officialWebsite:Number(row.officialVerified??0),admissionsWebsite:Number(row.admissionsVerified??0),featuredMajors:Number(row.featuredVerified??0),admissionYears:Number(row.admissionYearsVerified??0)}
    const q=query.q?`%${query.q}%`:null
    const pendingCondition=`(s.official_url IS NULL OR s.links_source_url IS NULL OR s.admissions_url IS NULL OR NOT EXISTS(SELECT 1 FROM school_featured_major_evidence fme WHERE fme.school_id=s.id AND fme.verified_at IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM admission_programs ap WHERE ap.school_id=s.id AND ap.year BETWEEN 2023 AND 2025))`
    const searchCondition=q?' AND (s.name LIKE ? OR s.city LIKE ?)':''
    const values=q?[q,q]:[]
    const [totalRows]=await database.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM schools s WHERE ${pendingCondition}${searchCondition}`,values)
    const [items]=await database.query<RowDataPacket[]>(
      `SELECT s.id,s.name,p.name province,s.city,s.level,s.links_verified_at linksVerifiedAt,
       (s.official_url IS NOT NULL AND s.links_source_url IS NOT NULL) hasOfficialWebsite,
       (s.admissions_url IS NOT NULL AND s.links_source_url IS NOT NULL) hasAdmissionsWebsite,
       EXISTS(SELECT 1 FROM school_featured_major_evidence fme WHERE fme.school_id=s.id AND fme.verified_at IS NOT NULL) hasFeaturedMajors,
       EXISTS(SELECT 1 FROM admission_programs ap WHERE ap.school_id=s.id AND ap.year BETWEEN 2023 AND 2025) hasAdmissionYears
       FROM schools s JOIN provinces p ON p.id=s.province_id WHERE ${pendingCondition}${searchCondition}
       ORDER BY (s.official_url IS NULL)+(s.admissions_url IS NULL)+(NOT EXISTS(SELECT 1 FROM school_featured_major_evidence fme WHERE fme.school_id=s.id AND fme.verified_at IS NOT NULL))+(NOT EXISTS(SELECT 1 FROM admission_programs ap WHERE ap.school_id=s.id AND ap.year BETWEEN 2023 AND 2025)) DESC,s.name LIMIT ? OFFSET ?`,
      [...values,query.pageSize,(query.page-1)*query.pageSize],
    )
    const mapped=items.map(item=>{const missing:string[]=[];if(!item.hasOfficialWebsite)missing.push('学校官网');if(!item.hasAdmissionsWebsite)missing.push('招生官网');if(!item.hasFeaturedMajors)missing.push('优势专业');if(!item.hasAdmissionYears)missing.push('招生年份');return{id:Number(item.id),name:String(item.name),province:String(item.province),city:String(item.city),level:String(item.level),linksVerifiedAt:item.linksVerifiedAt??null,missing}})
    response.json({success:true,data:{summary:{totalSchools,...Object.fromEntries(Object.entries(counts).map(([key,verified])=>[key,{verified,missing:totalSchools-verified}]))},items:mapped,totalPending:Number(totalRows[0]?.total??0),page:query.page,pageSize:query.pageSize},error:null,requestId:response.locals.requestId})
  }catch(error){next(error)}
})
