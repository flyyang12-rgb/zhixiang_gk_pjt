import type { RowDataPacket } from 'mysql2'
import { database } from './database.js'
import { classifySchoolRisk, classifySingleYearRisk } from './profession-engine.js'

export type AdmissionUnitType = 'exact_major'|'major_group'|'school_line'
export type AdmissionEvidence = {
  years:number[]
  unitType:AdmissionUnitType|null
  confidence:'低'|'中'|'高'|'无'
  recordCount:number
  note:string
}
export type AdmissionCandidate = {
  schoolId:number
  schoolName:string
  province:string
  city:string
  level:string
  officialUrl:string
  admissionsUrl:string
  linksSourceUrl:string
  unitId:number
  unitName:string
  unitType:AdmissionUnitType
  subjectRequirement:string|null
  referenceRank:number
  risk:'冲'|'稳'|'保'
  confidence:'低'|'中'|'高'
  dataYears:number[]
  sourceUrl:string
}

export async function loadAdmissionCandidates(input:{province:string;subjectGroup:string;selectedSubjects:string[];rank:number}) {
  const [coverage] = await database.query<RowDataPacket[]>(
    `SELECT ap.unit_type unitType,COUNT(*) recordCount,GROUP_CONCAT(DISTINCT ap.year ORDER BY ap.year) years
     FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id
     WHERE p.name=? AND ap.subject_group=? AND ap.recommendation_eligible=1 AND ap.min_rank IS NOT NULL
     AND ap.year=(SELECT MAX(ap2.year) FROM admission_programs ap2 JOIN provinces p2 ON p2.id=ap2.province_id WHERE p2.name=? AND ap2.subject_group=? AND ap2.recommendation_eligible=1 AND ap2.min_rank IS NOT NULL)
     GROUP BY ap.unit_type ORDER BY recordCount DESC LIMIT 1`,
    [input.province,input.subjectGroup,input.province,input.subjectGroup],
  )
  const active = coverage[0]
  if (!active) return { candidates:[] as AdmissionCandidate[], evidence:{years:[],unitType:null,confidence:'无',recordCount:0,note:'当前科类没有可比招生记录'} satisfies AdmissionEvidence }
  const unitType = String(active.unitType) as AdmissionUnitType
  const candidates = unitType === 'major_group' ? await loadMajorGroupCandidates(input) : unitType === 'exact_major' ? await loadExactMajorCandidates(input) : []
  const dataYears = [...new Set(candidates.flatMap(candidate=>candidate.dataYears))].sort()
  const years = dataYears.length ? dataYears : String(active.years).split(',').map(Number)
  const confidence:AdmissionEvidence['confidence'] = years.length>=3?'高':years.length===2?'中':'低'
  const note = unitType==='major_group'
    ? `${years.join('、')} 年院校专业组投档记录；单年冲刺候选最多放宽至 15% 位次差并统一标记低置信度；未取得组内专业目录前，不建立具体专业交叉关系`
    : unitType==='exact_major' ? `${years.join('、')} 年专业投档记录` : '当前只有院校投档线，不能用于专业交叉匹配'
  return { candidates, evidence:{years,unitType,confidence,recordCount:Number(active.recordCount),note} satisfies AdmissionEvidence }
}

async function loadMajorGroupCandidates(input:{province:string;subjectGroup:string;selectedSubjects:string[];rank:number}) {
  const [rows] = await database.query<RowDataPacket[]>(
    `SELECT ap.id unitId,ap.major_name unitName,ap.subject_requirement subjectRequirement,ap.min_rank referenceRank,ap.year,
     s.id schoolId,s.name schoolName,hp.name province,s.city,s.level,s.official_url officialUrl,s.admissions_url admissionsUrl,s.links_source_url linksSourceUrl,
     ds.source_url sourceUrl
     FROM admission_programs ap JOIN schools s ON s.id=ap.school_id JOIN provinces ep ON ep.id=ap.province_id JOIN provinces hp ON hp.id=s.province_id
     LEFT JOIN data_sources ds ON ds.id=ap.source_id
     WHERE ep.name=? AND ap.subject_group=? AND ap.unit_type='major_group' AND ap.recommendation_eligible=1 AND ap.min_rank IS NOT NULL
     AND ap.year=(SELECT MAX(ap2.year) FROM admission_programs ap2 JOIN provinces p2 ON p2.id=ap2.province_id WHERE p2.name=? AND ap2.subject_group=? AND ap2.unit_type='major_group' AND ap2.recommendation_eligible=1 AND ap2.min_rank IS NOT NULL)
     AND s.official_url IS NOT NULL AND s.admissions_url IS NOT NULL AND s.links_source_url IS NOT NULL`,
    [input.province,input.subjectGroup,input.province,input.subjectGroup],
  )
  const candidates = rows.flatMap(row=>{
    if (!subjectRequirementSatisfied(row.subjectRequirement == null ? null : String(row.subjectRequirement),input.selectedSubjects)) return []
    const assessment = classifySingleYearRisk(input.rank,Number(row.referenceRank))
    if (!assessment) return []
    return [toCandidate(row,'major_group',[Number(row.year)],assessment)]
  })
  return balanceCandidates(candidates,input.rank)
}

async function loadExactMajorCandidates(input:{province:string;subjectGroup:string;selectedSubjects:string[];rank:number}) {
  const [rows] = await database.query<RowDataPacket[]>(
    `SELECT s.id schoolId,s.name schoolName,hp.name province,s.city,s.level,s.official_url officialUrl,s.admissions_url admissionsUrl,s.links_source_url linksSourceUrl,
     MAX(year_rank.unitId) unitId,'专业投档记录汇总' unitName,NULL subjectRequirement,ROUND(AVG(year_rank.referenceRank)) referenceRank,
     GROUP_CONCAT(year_rank.referenceRank ORDER BY year_rank.year) ranks,GROUP_CONCAT(year_rank.year ORDER BY year_rank.year) years,COUNT(*) yearCount,MAX(year_rank.sourceUrl) sourceUrl
     FROM (SELECT ap2.school_id,ap2.year,MAX(ap2.id) unitId,MAX(ap2.min_rank) referenceRank,MAX(ds2.source_url) sourceUrl FROM admission_programs ap2 JOIN provinces p2 ON p2.id=ap2.province_id LEFT JOIN data_sources ds2 ON ds2.id=ap2.source_id
       WHERE p2.name=? AND ap2.subject_group=? AND ap2.unit_type='exact_major' AND ap2.recommendation_eligible=1 AND ap2.min_rank IS NOT NULL
       AND ap2.year>=(SELECT MAX(ap3.year)-2 FROM admission_programs ap3 JOIN provinces p3 ON p3.id=ap3.province_id WHERE p3.name=? AND ap3.subject_group=? AND ap3.unit_type='exact_major' AND ap3.recommendation_eligible=1 AND ap3.min_rank IS NOT NULL)
       GROUP BY ap2.school_id,ap2.year) year_rank
     JOIN schools s ON s.id=year_rank.school_id JOIN provinces hp ON hp.id=s.province_id
     WHERE s.official_url IS NOT NULL AND s.admissions_url IS NOT NULL AND s.links_source_url IS NOT NULL
     GROUP BY s.id,s.name,hp.name,s.city,s.level,s.official_url,s.admissions_url,s.links_source_url`,
    [input.province,input.subjectGroup,input.province,input.subjectGroup],
  )
  const candidates = rows.flatMap(row=>{
    const years=String(row.years).split(',').map(Number)
    const ranks=String(row.ranks).split(',').map(Number)
    const assessment=years.length>=2?classifySchoolRisk(input.rank,ranks):classifySingleYearRisk(input.rank,Number(row.referenceRank))
    if(!assessment)return[]
    return [toCandidate(row,'exact_major',years,assessment)]
  })
  return balanceCandidates(candidates,input.rank)
}

function toCandidate(row:RowDataPacket,unitType:AdmissionUnitType,dataYears:number[],assessment:{risk:'冲'|'稳'|'保';confidence:'低'|'高'}) : AdmissionCandidate {
  return {schoolId:Number(row.schoolId),schoolName:String(row.schoolName),province:String(row.province),city:String(row.city),level:String(row.level),officialUrl:String(row.officialUrl),admissionsUrl:String(row.admissionsUrl),linksSourceUrl:String(row.linksSourceUrl),unitId:Number(row.unitId),unitName:String(row.unitName),unitType,subjectRequirement:row.subjectRequirement==null?null:String(row.subjectRequirement),referenceRank:Number(row.referenceRank),risk:assessment.risk,confidence:dataYears.length>=3?'高':dataYears.length===2?'中':'低',dataYears,sourceUrl:String(row.sourceUrl??row.linksSourceUrl)}
}

function balanceCandidates(candidates:AdmissionCandidate[],rank:number){
  const unique=new Map<number,AdmissionCandidate>()
  for(const candidate of candidates.sort((a,b)=>Math.abs(a.referenceRank-rank)-Math.abs(b.referenceRank-rank))){if(!unique.has(candidate.schoolId))unique.set(candidate.schoolId,candidate)}
  return (['冲','稳','保'] as const).flatMap(risk=>[...unique.values()].filter(candidate=>candidate.risk===risk).slice(0,2))
}

export function subjectRequirementSatisfied(requirement:string|null,selectedSubjects:string[]){
  if(!requirement||requirement==='不限')return true
  const required=['物理','历史','化学','生物','政治','地理'].filter(subject=>requirement.includes(subject))
  return required.every(subject=>selectedSubjects.includes(subject))
}
