import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { database } from './database.js'
import { classifySchoolRisk, rankProfessions, type ProfessionInput } from './profession-engine.js'
import { loadAdmissionCandidates, type AdmissionEvidence } from './admission-candidates.js'
import {loadPlanningCoordinate} from './planning-coordinate.js'

export const professionDashboardRouter = Router()

const subjectRequirements: Record<string, string[]> = {
  '080901': ['物理'], '080601': ['物理'], '080202': ['物理'], '070101': ['物理'],
  '101101': ['化学'], '100201K': ['化学'],
}

professionDashboardRouter.get('/profiles/:id/profession-dashboard', async (request, response, next) => {
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const data = await buildProfessionDashboard(profileId)
    response.json({ success: true, data, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

export async function buildProfessionDashboard(profileId: string) {
    const [profiles] = await database.query<RowDataPacket[]>(
      `SELECT sp.student_name studentName,sp.planning_mode planningMode,sp.selected_subjects selectedSubjects,
       sp.score,sp.province_rank provinceRank,sp.subject_group subjectGroup,p.name province
       FROM student_profiles sp JOIN provinces p ON p.id=sp.province_id WHERE sp.id=?`, [profileId],
    )
    if (!profiles[0]) throw new Error('学生档案不存在')
    const profile = profiles[0]
    const planningCoordinate=await loadPlanningCoordinate(profileId,profile.provinceRank==null?null:Number(profile.provinceRank))
    const planningRank=planningCoordinate.rank
    const selectedSubjects = parseJson<string[]>(profile.selectedSubjects ?? '[]')
    const [majorRows] = await database.query<RowDataPacket[]>(`SELECT id,code,name,category FROM majors WHERE code IN ('080901','080601','080202','120203K','101101','100201K','030101K','050101','070101') ORDER BY code`)
    const employmentHealth = await loadEmploymentHealth()
    const admission = profile.planningMode === 'application' && planningRank
      ? await loadAdmissionCandidates({province:String(profile.province),subjectGroup:String(profile.subjectGroup),selectedSubjects,rank:planningRank})
      : {candidates:[],evidence:{years:[],unitType:null,confidence:'无',recordCount:0,note:'目标探索模式不计算冲稳保'} as AdmissionEvidence}
    const inputs: ProfessionInput[] = []
    const details = new Map<number, { jobs: unknown[]; schools: unknown[]; schoolMatchStatus:'verified'|'group_only'|'unavailable' }>()

    for (const major of majorRows) {
      const jobs = await loadJobDirections(Number(major.id))
      const employment = await loadEmploymentStats(Number(major.id))
      const schools = profile.planningMode === 'application' && planningRank
        ? await loadApplicationSchools({ majorName: String(major.name), province: String(profile.province), subjectGroup: String(profile.subjectGroup), rank: planningRank })
        : await loadExplorationSchools(String(major.name))
      const directEntryRatio = jobs.length ? jobs.filter(job => job.directEntry).length / jobs.length : 0
      inputs.push({ id: Number(major.id), code: String(major.code), name: String(major.name), category: String(major.category), requiredSubjects: subjectRequirements[String(major.code)] ?? [], selectedSubjects, jobCount: employment.jobCount, provinceCount: employment.provinceCount, sourceCount: employment.sourceCount, directEntryRatio, eligibleSchoolCount: schools.length, dailyJobCounts: employment.dailyCounts, employmentUsable: employmentHealth.usable && employment.sourceCount >= 2, mode: profile.planningMode })
      details.set(Number(major.id), { jobs, schools, schoolMatchStatus:schools.length?'verified':admission.evidence.unitType==='major_group'?'group_only':'unavailable' })
    }

    const cards = rankProfessions(inputs).map(item => ({ ...item, ...details.get(item.id) }))
    const [savedRows] = await database.query<RowDataPacket[]>(
      `SELECT psi.item_type itemType,psi.item_id itemId,psi.state,psi.note,
       CASE WHEN psi.item_type='major' THEN m.name ELSE s.name END itemName
       FROM profile_saved_items psi
       LEFT JOIN majors m ON psi.item_type='major' AND m.id=psi.item_id
       LEFT JOIN schools s ON psi.item_type='school' AND s.id=psi.item_id
       WHERE psi.profile_id=? ORDER BY psi.created_at`, [profileId],
    )
    const [snapshotRows]=await database.query<RowDataPacket[]>(`SELECT id,exam_name examName,DATE_FORMAT(exam_date,'%Y-%m-%d') examDate,score,province_rank provinceRank,note,is_current isCurrent FROM profile_score_snapshots WHERE profile_id=? ORDER BY exam_date,id`,[profileId])
    return {
      mode: profile.planningMode as 'exploration'|'application',
      profileSummary:{studentName:String(profile.studentName),planningMode:profile.planningMode,province:String(profile.province),subjectGroup:String(profile.subjectGroup),score:Number(profile.score),provinceRank:profile.provinceRank==null?null:Number(profile.provinceRank)},
      planningCoordinate,
      scoreSnapshots:snapshotRows.map(row=>({...row,id:Number(row.id),score:row.score==null?null:Number(row.score),provinceRank:row.provinceRank==null?null:Number(row.provinceRank),isCurrent:Boolean(row.isCurrent)})),
      employment: employmentHealth, schoolCandidates:admission.candidates, admissionEvidence:admission.evidence, cards, savedItems: savedRows,
    }
}

const savedItemSchema = z.object({ itemType: z.enum(['major','school']), itemId: z.number().int().positive(), state: z.enum(['saved','excluded','target']), note: z.string().trim().max(500).nullable().optional() })

professionDashboardRouter.put('/profiles/:id/saved-items', async (request, response, next) => {
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const input = savedItemSchema.parse(request.body)
    const [profiles] = await database.query<RowDataPacket[]>(`SELECT id FROM student_profiles WHERE id=?`, [profileId])
    if (!profiles[0]) { response.status(404).json({ success: false, data: null, error: '学生档案不存在', requestId: response.locals.requestId }); return }
    if(input.note===undefined){
      await database.execute(`INSERT INTO profile_saved_items (profile_id,item_type,item_id,state,note) VALUES (?,?,?,?,NULL) ON DUPLICATE KEY UPDATE state=VALUES(state)`, [profileId,input.itemType,input.itemId,input.state])
    }else{
      await database.execute(`INSERT INTO profile_saved_items (profile_id,item_type,item_id,state,note) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE state=VALUES(state),note=VALUES(note)`, [profileId,input.itemType,input.itemId,input.state,input.note])
    }
    response.json({ success: true, data: input, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

const savedItemNoteSchema=z.object({note:z.string().trim().max(500).nullable()})

professionDashboardRouter.patch('/profiles/:id/saved-items/:itemType/:itemId/note',async(request,response,next)=>{
  try{
    const profileId=z.string().uuid().parse(request.params.id)
    const itemType=z.enum(['major','school']).parse(request.params.itemType)
    const itemId=z.coerce.number().int().positive().parse(request.params.itemId)
    const {note}=savedItemNoteSchema.parse(request.body)
    const [result]=await database.execute<ResultSetHeader>(`UPDATE profile_saved_items SET note=? WHERE profile_id=? AND item_type=? AND item_id=?`,[note,profileId,itemType,itemId])
    if(result.affectedRows===0){response.status(404).json({success:false,data:null,error:'请先收藏这一项再添加备注',requestId:response.locals.requestId});return}
    response.json({success:true,data:{itemType,itemId,note},error:null,requestId:response.locals.requestId})
  }catch(error){next(error)}
})

professionDashboardRouter.delete('/profiles/:id/saved-items/:itemType/:itemId', async (request, response, next) => {
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const itemType = z.enum(['major','school']).parse(request.params.itemType)
    const itemId = z.coerce.number().int().positive().parse(request.params.itemId)
    await database.execute(`DELETE FROM profile_saved_items WHERE profile_id=? AND item_type=? AND item_id=?`, [profileId,itemType,itemId])
    response.json({ success: true, data: { itemType,itemId }, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

async function loadEmploymentHealth() {
  const [rows] = await database.query<RowDataPacket[]>(`SELECT SUM(status='healthy') healthySources,MAX(last_success_at) lastSuccessAt,DATEDIFF(NOW(),MAX(last_success_at)) staleDays FROM job_sources`)
  const row = rows[0]
  const healthySources = Number(row.healthySources ?? 0)
  const staleDays = row.staleDays == null ? null : Number(row.staleDays)
  return { healthySources, lastSuccessAt: row.lastSuccessAt ?? null, staleDays, usable: healthySources >= 2 && staleDays != null && staleDays <= 7, windowDays: 30 }
}

async function loadJobDirections(majorId: number) {
  const [rows] = await database.query<RowDataPacket[]>(`SELECT jd.id,jd.name,jd.employment_category employmentCategory,jd.requires_postgraduate requiresPostgraduate,jd.requires_certificate requiresCertificate,mjd.direct_entry directEntry FROM major_job_directions mjd JOIN job_directions jd ON jd.id=mjd.job_direction_id WHERE mjd.major_id=? AND mjd.review_status='approved' ORDER BY mjd.priority LIMIT 3`, [majorId])
  return rows.map(row => ({ id:Number(row.id),name:String(row.name),employmentCategory:String(row.employmentCategory),requiresPostgraduate:Boolean(row.requiresPostgraduate),requiresCertificate:Boolean(row.requiresCertificate),directEntry:Boolean(row.directEntry) }))
}

async function loadEmploymentStats(majorId: number) {
  const [totals] = await database.query<RowDataPacket[]>(`SELECT COUNT(DISTINCT jp.fingerprint) jobCount,COUNT(DISTINCT jp.province) provinceCount,COUNT(DISTINCT jp.source_id) sourceCount FROM job_postings jp JOIN major_job_directions mjd ON mjd.job_direction_id=jp.job_direction_id WHERE mjd.major_id=? AND mjd.review_status='approved' AND jp.published_at>=DATE_SUB(CURDATE(),INTERVAL 30 DAY) AND jp.expires_at>=CURDATE()`, [majorId])
  const [daily] = await database.query<RowDataPacket[]>(`SELECT stat_date statDate,SUM(job_count) jobCount FROM job_daily_stats WHERE major_id=? AND stat_date>=DATE_SUB(CURDATE(),INTERVAL 30 DAY) GROUP BY stat_date ORDER BY stat_date`, [majorId])
  return { jobCount:Number(totals[0]?.jobCount??0),provinceCount:Number(totals[0]?.provinceCount??0),sourceCount:Number(totals[0]?.sourceCount??0),dailyCounts:daily.map(row=>Number(row.jobCount)) }
}

async function loadApplicationSchools(input: { majorName:string;province:string;subjectGroup:string;rank:number }) {
  const [rows] = await database.query<RowDataPacket[]>(`SELECT s.id,s.name,s.level,s.city,s.official_url officialUrl,s.admissions_url admissionsUrl,s.links_verified_at linksVerifiedAt,s.links_source_url linksSourceUrl,ap.year,ap.min_rank minRank,ap.major_name programName FROM admission_programs ap JOIN schools s ON s.id=ap.school_id JOIN provinces p ON p.id=ap.province_id WHERE p.name=? AND ap.subject_group=? AND ap.recommendation_eligible=1 AND ap.min_rank IS NOT NULL AND ((ap.unit_type='exact_major' AND ap.major_name LIKE ?) OR (ap.unit_type='major_group' AND EXISTS (SELECT 1 FROM admission_unit_majors aum JOIN majors m ON m.id=aum.major_id WHERE aum.admission_program_id=ap.id AND aum.verification_status='verified' AND m.name=?))) AND ap.year>=(SELECT MAX(year)-2 FROM admission_programs WHERE recommendation_eligible=1) ORDER BY s.id,ap.year`, [input.province,input.subjectGroup,`%${input.majorName}%`,input.majorName])
  const grouped = new Map<number, RowDataPacket[]>()
  for (const row of rows) grouped.set(Number(row.id), [...(grouped.get(Number(row.id))??[]),row])
  const candidates = [...grouped.values()].flatMap(records => {
    const assessment = classifySchoolRisk(input.rank, records.map(row=>Number(row.minRank)))
    if (!assessment) return []
    const latest = records.sort((a,b)=>Number(b.year)-Number(a.year))[0]
    return [{ id:Number(latest.id),name:String(latest.name),level:String(latest.level),city:String(latest.city),officialUrl:latest.officialUrl??null,admissionsUrl:latest.admissionsUrl??null,linksVerifiedAt:latest.linksVerifiedAt??null,linksSourceUrl:latest.linksSourceUrl??null,programName:String(latest.programName),years:records.map(row=>Number(row.year)),...assessment }]
  })
  return (['冲','稳','保'] as const).flatMap(risk=>candidates.filter(item=>item.risk===risk).sort((a,b)=>Number(Boolean(b.officialUrl&&b.admissionsUrl&&b.linksSourceUrl))-Number(Boolean(a.officialUrl&&a.admissionsUrl&&a.linksSourceUrl))||Math.abs(a.medianRank-input.rank)-Math.abs(b.medianRank-input.rank)).slice(0,2))
}

async function loadExplorationSchools(majorName: string) {
  const [rows] = await database.query<RowDataPacket[]>(
    `SELECT s.id,s.name,s.level,s.city,s.official_url officialUrl,s.admissions_url admissionsUrl,
     s.links_verified_at linksVerifiedAt,s.links_source_url linksSourceUrl,
     COUNT(DISTINCT ap.year) evidenceYears,MAX(ap.year) latestYear
     FROM admission_programs ap JOIN schools s ON s.id=ap.school_id
     WHERE ap.major_name LIKE ? AND ap.recommendation_eligible=1
     GROUP BY s.id,s.name,s.level,s.city,s.official_url,s.admissions_url,s.links_verified_at,s.links_source_url
     HAVING evidenceYears>=2
     ORDER BY FIELD(s.level,'985','211','双一流','一本','本科','二本','专科'),
     (s.official_url IS NOT NULL AND s.admissions_url IS NOT NULL AND s.links_source_url IS NOT NULL) DESC,
     evidenceYears DESC,latestYear DESC,s.name
     LIMIT 6`,
    [`%${majorName}%`],
  )
  return rows.map(row=>({ id:Number(row.id),name:String(row.name),level:String(row.level),city:String(row.city),officialUrl:row.officialUrl??null,admissionsUrl:row.admissionsUrl??null,linksVerifiedAt:row.linksVerifiedAt??null,linksSourceUrl:row.linksSourceUrl??null,evidenceYears:Number(row.evidenceYears),latestYear:Number(row.latestYear) }))
}

function parseJson<T>(value:T|string):T { return typeof value==='string'?JSON.parse(value) as T:value }
