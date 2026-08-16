import { Router } from 'express'
import type { DatabaseRow as RowDataPacket } from './database.js'
import { z } from 'zod'
import { database } from './database.js'
import { defaultDecisionWeights, scoreCandidate } from './recommendation-scoring.js'
import { loadAdmissionCandidates, type AdmissionUnitType } from './admission-candidates.js'
import {loadPlanningCoordinate} from './planning-coordinate.js'

export const recommendationsRouter = Router()

type Candidate = { schoolId: number; schoolName: string; province: string; city: string; level: string; officialUrl: string; admissionsUrl: string; linksSourceUrl: string; unitId:number; unitName:string; unitType:AdmissionUnitType; subjectRequirement:string|null; sourceUrl:string; referenceRank: number; bestRank: number; programCount: number; dataYears: number[]; confidence: '低' | '中' | '高'; risk: '冲' | '稳' | '保'; ruleScore: number; majors: Array<{ name: string; minRank: number; fit: string }>; reasons: string[] }
type RecommendationSource = { title: string; sourceUrl: string; sourceYear: number; publisher: string }

recommendationsRouter.post('/profiles/:id/recommendations/generate', async (request, response, next) => {
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const [profiles] = await database.execute<RowDataPacket[]>(
      `SELECT sp.province_rank provinceRank, sp.subject_group subjectGroup,sp.selected_subjects selectedSubjects,p.name province
       FROM student_profiles sp JOIN provinces p ON p.id=sp.province_id WHERE sp.id=?`, [profileId],
    )
    const profile = profiles[0]
    if (!profile) { response.status(404).json({ success: false, data: null, error: '学生档案不存在', requestId: response.locals.requestId }); return }
    const planningCoordinate=await loadPlanningCoordinate(profileId,profile.provinceRank==null?null:Number(profile.provinceRank))
    if (!planningCoordinate.rank) { response.status(422).json({ success: false, data: null, error: '生成冲稳保清单需要填写全省位次', requestId: response.locals.requestId }); return }

    const [available] = await database.execute<RowDataPacket[]>(`SELECT COUNT(*) count,MAX(year) year,COUNT(DISTINCT year) yearCount,STRING_AGG(DISTINCT year::text, ',' ORDER BY year::text) years FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id WHERE p.name=? AND ap.subject_group=? AND ap.recommendation_eligible=1 AND ap.min_rank IS NOT NULL`, [profile.province, profile.subjectGroup])
    if (!Number(available[0]?.count)) {
      const result = { generatedAt: new Date().toISOString(), sourceYear: null, candidates: [], planningCoordinate, warning: `当前尚未导入${profile.province}官方投档数据，不能负责任地生成冲稳保；可先使用全国院校地图。` }
      await saveSnapshot(profileId, result)
      response.json({ success: true, data: result, error: null, requestId: response.locals.requestId }); return
    }

    const rank = planningCoordinate.rank
    const latestYear = Number(available[0].year)
    const admission = await loadAdmissionCandidates({province:String(profile.province),subjectGroup:String(profile.subjectGroup),selectedSubjects:json<string[]>(profile.selectedSubjects??'[]'),rank})
    const [sourceRows] = await database.execute<RowDataPacket[]>(
      `SELECT DISTINCT ds.title,ds.source_url sourceUrl,ds.source_year sourceYear,ds.publisher
       FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id JOIN data_sources ds ON ds.id=ap.source_id
       WHERE p.name=? AND ap.subject_group=? AND ap.recommendation_eligible=1 AND ap.year BETWEEN ? AND ? ORDER BY ds.source_year DESC`,
      [profile.province, profile.subjectGroup, latestYear - 2, latestYear],
    )
    const sources: RecommendationSource[] = sourceRows.map(row => ({ title: String(row.title), sourceUrl: String(row.sourceUrl), sourceYear: Number(row.sourceYear), publisher: String(row.publisher) }))
    const candidates: Candidate[] = []
    for (const row of admission.candidates) {
      const referenceRank = row.referenceRank
      const [programRows] = row.unitType==='major_group'
        ? await database.execute<RowDataPacket[]>(`SELECT aum.raw_major_name name,ap.min_rank minRank FROM admission_unit_majors aum JOIN admission_programs ap ON ap.id=aum.admission_program_id WHERE aum.admission_program_id=? AND aum.verification_status='verified' ORDER BY aum.raw_major_name LIMIT 6`,[row.unitId])
        : await database.execute<RowDataPacket[]>(`SELECT major_name name,min_rank minRank FROM admission_programs WHERE school_id=? AND province_id=(SELECT id FROM provinces WHERE name=?) AND subject_group=? AND year=? AND unit_type='exact_major' AND recommendation_eligible=1 AND min_rank IS NOT NULL ORDER BY ABS(min_rank-?) LIMIT 6`,[row.schoolId,profile.province,profile.subjectGroup,latestYear,rank])
      const majors = programRows.map(item => ({ name: String(item.name), minRank: Number(item.minRank), fit: '可进一步了解' }))
      const { ruleScore } = scoreCandidate({ level: String(row.level), hasMatchingMajor: majors.some(item => item.fit === '较匹配') }, defaultDecisionWeights)
      candidates.push({ ...row,bestRank:referenceRank,programCount:majors.length,ruleScore,majors,reasons:[`${row.dataYears.join('、')} 年${profile.province}${row.unitType==='major_group'?'专业组':'专业'}参考投档位次约 ${referenceRank.toLocaleString()}`,row.unitType==='major_group'&&majors.length===0?'当前只有专业组线，尚不能证明该组包含具体专业':'当前规则只使用已核验的学校层次与专业证据进行同风险层比较','城市、成本、就业与距离尚缺结构化指标，当前不用于区分学校'] })
    }
    const balanced = (['冲', '稳', '保'] as const).flatMap(level => candidates.filter(item => item.risk === level).sort((a, b) => b.ruleScore - a.ruleScore))
    const provenanceNote = profile.province === '河南'
      ? '河南数据由省考试院查询链接对应的公开镜像表识别导入，关键志愿须回到考试院原页复核。'
      : ''
    const coverageNote = admission.evidence.confidence==='低' ? `当前仅有 ${admission.evidence.years.join('、')} 年同制度数据，候选统一标记为低置信度。` : ''
    const coordinateNote=planningCoordinate.sampleCount===1?'当前只有 1 次有效全省位次，继续记录可减少单次偶然性。':planningCoordinate.stability==='volatile'?`最近 ${planningCoordinate.sampleCount} 次位次波动较大（${planningCoordinate.bestRank?.toLocaleString()}—${planningCoordinate.worstRank?.toLocaleString()}），当前候选仍要保守看待。`:`当前规划位次由最近 ${planningCoordinate.sampleCount} 次有效位次稳健生成。`
    const result = { generatedAt: new Date().toISOString(), sourceYear: latestYear, dataYears: admission.evidence.years, sources, candidates: balanced, admissionEvidence:admission.evidence, planningCoordinate, warning: `${provenanceNote}${coverageNote}${coordinateNote}规则评分只用于同风险层比较，不是录取概率。结果依据往年投档位次生成，不等于录取承诺；填报前须核对当年招生计划与选科要求。` }
    await saveSnapshot(profileId, result)
    response.json({ success: true, data: result, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

recommendationsRouter.get('/profiles/:id/recommendations', async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id)
    const [rows] = await database.execute<RowDataPacket[]>('SELECT result FROM recommendation_snapshots WHERE profile_id=?', [id])
    response.json({ success: true, data: rows[0] ? json(rows[0].result) : null, error: null, requestId: response.locals.requestId })
  } catch (error) { next(error) }
})

async function saveSnapshot(profileId: string, result: unknown) {
  await database.execute(`INSERT INTO recommendation_snapshots (profile_id,result) VALUES (?,?) ON CONFLICT (profile_id) DO UPDATE SET result=EXCLUDED.result,generated_at=NOW()`, [profileId, JSON.stringify(result)])
}
function json<T = unknown>(value: T | string): T { return typeof value === 'string' ? JSON.parse(value) as T : value }
