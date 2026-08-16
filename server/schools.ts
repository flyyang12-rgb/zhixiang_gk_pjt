import { Router } from 'express'
import type { DatabaseRow as RowDataPacket } from './database.js'
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
       ORDER BY CASE s.level WHEN '985' THEN 1 WHEN '211' THEN 2 WHEN '双一流' THEN 3 WHEN '一本' THEN 4 WHEN '二本' THEN 5 WHEN '本科' THEN 6 WHEN '专科' THEN 7 ELSE 8 END, s.name LIMIT ? OFFSET ?`,
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
const dataQualityQuerySchema=z.object({
  page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(24),q:z.string().trim().max(64).optional(),
  province:z.string().trim().max(32).optional(),level:z.string().trim().max(16).optional(),year:z.coerce.number().int().min(2023).max(2025).optional(),
  factType:z.enum(['official_website','admissions_website','featured_major','admission_coverage']).optional(),
  status:z.enum(['verified','unavailable','not_applicable','pending']).default('pending'),
})

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
    const [sourceRows]=await database.query<RowDataPacket[]>(
      `SELECT ds.title,ds.source_url sourceUrl,ds.publisher,ds.published_at publishedAt,ds.effective_at effectiveAt
       FROM data_sources ds
       WHERE ds.source_type='school_list'
         AND EXISTS(SELECT 1 FROM import_batches ib WHERE ib.source_id=ds.id AND ib.status='completed')
       ORDER BY ds.source_year DESC,ds.collected_at DESC LIMIT 1`,
    )
    const source=sourceRows[0]
    if(!source?.effectiveAt){
      response.status(503).json({success:false,data:null,error:'院校名单缺少可核验的截至日期，请重新导入教育部院校名单',requestId:response.locals.requestId})
      return
    }
    const [rows] = await database.query<RowDataPacket[]>(
      `SELECT p.name, COUNT(s.id) schoolCount,
       COUNT(s.id) FILTER (WHERE s.level IN ('985','211','双一流')) keyUniversityCount,
       COUNT(s.id) FILTER (WHERE s.level = '专科') vocationalCount
       FROM provinces p LEFT JOIN schools s ON s.province_id = p.id
       GROUP BY p.id, p.name ORDER BY schoolCount DESC`,
    )
    response.json({ success: true, data: {
      items:rows.map(row => ({ name: row.name, schoolCount: Number(row.schoolCount), keyUniversityCount: Number(row.keyUniversityCount), vocationalCount: Number(row.vocationalCount) })),
      source:{title:String(source.title),sourceUrl:String(source.sourceUrl),publisher:String(source.publisher),publishedAt:toDateOnly(source.publishedAt),effectiveAt:toDateOnly(source.effectiveAt)},
    }, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

function toDateOnly(value:unknown){
  if(value instanceof Date)return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`
  return String(value).slice(0,10)
}

schoolsRouter.get('/admin/data-status', async (_request, response, next) => {
  try {
    const [counts] = await database.query<RowDataPacket[]>('SELECT COUNT(*) schoolCount, COUNT(DISTINCT province_id) provinceCount FROM schools')
    const [sources] = await database.query<RowDataPacket[]>('SELECT title, source_url sourceUrl, source_year sourceYear, publisher, published_at publishedAt FROM data_sources ORDER BY collected_at DESC')
    const [coverageRows] = await database.query<RowDataPacket[]>(
      `SELECT p.name province,ap.subject_group subjectGroup,
       STRING_AGG(DISTINCT ap.year::text, ',' ORDER BY ap.year::text) FILTER (WHERE ap.recommendation_eligible=1) years,
       COUNT(*) totalRecordCount,COUNT(*) FILTER (WHERE ap.recommendation_eligible=1) recordCount
       FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id
       WHERE p.name IN ('河南','山东','河北') GROUP BY p.name,ap.subject_group ORDER BY p.name,ap.subject_group`,
    )
    const [coverageDetailRows] = await database.query<RowDataPacket[]>(
      `SELECT p.name province,ap.year,ap.subject_group subjectGroup,ap.education_level educationLevel,ap.admission_category admissionCategory,ap.batch,
       ap.unit_type unitType,COUNT(*) recordCount,COUNT(*) FILTER (WHERE ap.recommendation_eligible=1) recommendationEligibleCount,
       (SELECT COUNT(*) FROM admission_scope_audits asa WHERE asa.province_id=ap.province_id AND asa.year=ap.year
         AND asa.education_level=ap.education_level AND asa.status='pending'
         AND asa.admission_category IN ('*',ap.admission_category) AND asa.batch IN ('*',ap.batch)
         AND asa.subject_group IN ('*',ap.subject_group)) auditedGapCount,
       CASE WHEN EXISTS(SELECT 1 FROM admission_scope_audits asa WHERE asa.province_id=ap.province_id AND asa.year=ap.year
         AND asa.education_level=ap.education_level AND asa.status='pending'
         AND asa.admission_category IN ('*',ap.admission_category) AND asa.batch IN ('*',ap.batch)
         AND asa.subject_group IN ('*',ap.subject_group)) THEN 'pending' ELSE 'verified' END sourceStatus
       FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id
       WHERE p.name IN ('河南','山东','河北') AND ap.year BETWEEN 2023 AND 2025
       GROUP BY ap.province_id,p.name,ap.year,ap.subject_group,ap.education_level,ap.admission_category,ap.batch,ap.unit_type
       ORDER BY CASE p.name WHEN '河南' THEN 1 WHEN '山东' THEN 2 WHEN '河北' THEN 3 ELSE 4 END,ap.year,ap.education_level,ap.batch,ap.subject_group`,
    )
    const [yearRows] = await database.query<RowDataPacket[]>(
      `SELECT p.name province,ap.year,COUNT(*) recordCount,COUNT(*) FILTER (WHERE ap.recommendation_eligible=1) recommendationEligibleCount,
       STRING_AGG(DISTINCT ap.subject_group, ',' ORDER BY ap.subject_group) subjectGroups,
       STRING_AGG(DISTINCT ap.education_level, ',' ORDER BY ap.education_level) educationLevels,
       STRING_AGG(DISTINCT ap.batch, '｜' ORDER BY ap.batch) batches,
       STRING_AGG(DISTINCT ds.publisher, '；') publisher,MAX(ds.source_url) sourceUrl,MAX(ds.collected_at) updatedAt
       FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id LEFT JOIN data_sources ds ON ds.id=ap.source_id
       WHERE p.name IN ('河南','山东','河北') AND ap.year BETWEEN 2023 AND 2025
       GROUP BY p.name,ap.year ORDER BY CASE p.name WHEN '河南' THEN 1 WHEN '山东' THEN 2 WHEN '河北' THEN 3 ELSE 4 END,ap.year`,
    )
    const coverage = coverageRows.map(row => ({ province: String(row.province), subjectGroup: String(row.subjectGroup), years: row.years?String(row.years).split(',').map(Number):[], recordCount: Number(row.recordCount),totalRecordCount:Number(row.totalRecordCount) }))
    const coverageDetails=coverageDetailRows.map(row=>({province:String(row.province),year:Number(row.year),subjectGroup:String(row.subjectGroup),educationLevel:String(row.educationLevel),admissionCategory:String(row.admissionCategory),batch:String(row.batch),unitType:String(row.unitType),recordCount:Number(row.recordCount),recommendationEligibleCount:Number(row.recommendationEligibleCount),auditedGapCount:Number(row.auditedGapCount),sourceStatus:String(row.sourceStatus)}))
    const yearStatus = yearRows.map(row => ({ province: String(row.province), year: Number(row.year), recordCount: Number(row.recordCount),recommendationEligibleCount:Number(row.recommendationEligibleCount), subjectGroups: String(row.subjectGroups).split(','),educationLevels:String(row.educationLevels).split(','),batches:String(row.batches).split('｜'), publisher: String(row.publisher ?? ''), sourceUrl: String(row.sourceUrl ?? ''), updatedAt: row.updatedAt }))
    response.json({ success: true, data: { schoolCount: Number(counts[0]?.schoolCount ?? 0), provinceCount: Number(counts[0]?.provinceCount ?? 0), sources, coverage,coverageDetails, yearStatus }, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

schoolsRouter.get('/admin/school-data-quality',async(request,response,next)=>{
  try{
    const query=dataQualityQuerySchema.parse(request.query)
    const [schoolCountRows]=await database.query<RowDataPacket[]>(`SELECT COUNT(*) totalSchools FROM schools`)
    const totalSchools=Number(schoolCountRows[0]?.totalSchools??0)
    const [auditSummary]=await database.query<RowDataPacket[]>(`SELECT fact_type factType,status,COUNT(*) count FROM school_fact_audits GROUP BY fact_type,status`)
    const factNames={official_website:'officialWebsite',admissions_website:'admissionsWebsite',featured_major:'featuredMajors',admission_coverage:'admissionYears'} as const
    const emptyStatuses=()=>({verified:0,unavailable:0,notApplicable:0,pending:0})
    const summaryFacts:Record<string,ReturnType<typeof emptyStatuses>>={officialWebsite:emptyStatuses(),admissionsWebsite:emptyStatuses(),featuredMajors:emptyStatuses(),admissionYears:emptyStatuses()}
    for(const audit of auditSummary){const key=factNames[String(audit.factType) as keyof typeof factNames];if(!key)continue;const status=String(audit.status)==='not_applicable'?'notApplicable':String(audit.status) as keyof ReturnType<typeof emptyStatuses>;summaryFacts[key]![status]=Number(audit.count)}
    const conditions:string[]=[`EXISTS(SELECT 1 FROM school_fact_audits fa WHERE fa.school_id=s.id AND fa.status=?${query.factType?' AND fa.fact_type=?':''})`]
    const values:Array<string|number>=[query.status]
    if(query.factType)values.push(query.factType)
    if(query.q){conditions.push('(s.name LIKE ? OR s.city LIKE ?)');values.push(`%${query.q}%`,`%${query.q}%`)}
    if(query.province){conditions.push('p.name=?');values.push(query.province)}
    if(query.level){conditions.push('s.level=?');values.push(query.level)}
    if(query.year){conditions.push('EXISTS(SELECT 1 FROM admission_programs ap WHERE ap.school_id=s.id AND ap.year=?)');values.push(query.year)}
    const where=conditions.join(' AND ')
    const [totalRows]=await database.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM schools s JOIN provinces p ON p.id=s.province_id WHERE ${where}`,values)
    const [items]=await database.query<RowDataPacket[]>(`SELECT s.id,s.name,p.name province,s.city,s.level,s.links_verified_at linksVerifiedAt FROM schools s JOIN provinces p ON p.id=s.province_id WHERE ${where} ORDER BY s.name LIMIT ? OFFSET ?`,[...values,query.pageSize,(query.page-1)*query.pageSize])
    const itemIds=items.map(item=>Number(item.id))
    const audits=itemIds.length?(await database.query<RowDataPacket[]>(`SELECT school_id schoolId,fact_type factType,status,reason,source_url sourceUrl,checked_at checkedAt FROM school_fact_audits WHERE school_id IN (${itemIds.map(()=>'?').join(',')}) ORDER BY fact_type`,itemIds))[0]:[]
    const mapped=items.map(item=>{const facts=audits.filter(audit=>Number(audit.schoolId)===Number(item.id)).map(audit=>({factType:String(audit.factType),status:String(audit.status),reason:audit.reason==null?null:String(audit.reason),sourceUrl:audit.sourceUrl==null?null:String(audit.sourceUrl),checkedAt:audit.checkedAt??null}));const missing=facts.filter(fact=>fact.status==='pending').map(fact=>({official_website:'学校官网',admissions_website:'招生官网',featured_major:'优势专业',admission_coverage:'招生年份'}[fact.factType]??fact.factType));return{id:Number(item.id),name:String(item.name),province:String(item.province),city:String(item.city),level:String(item.level),linksVerifiedAt:item.linksVerifiedAt??null,missing,facts}})
    response.json({success:true,data:{summary:{totalSchools,...Object.fromEntries(Object.entries(summaryFacts).map(([key,statuses])=>[key,{...statuses,missing:statuses.pending}]))},items:mapped,totalPending:Number(totalRows[0]?.total??0),page:query.page,pageSize:query.pageSize},error:null,requestId:response.locals.requestId})
  }catch(error){next(error)}
})
