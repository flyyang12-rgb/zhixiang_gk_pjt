import type { RowDataPacket } from 'mysql2'
import { database } from './database.js'
import { classifySchoolRisk, classifySingleYearRisk } from './profession-engine.js'
import { orientationRecommendations } from './school-major-recommendations.js'

export class SchoolDetailLookupError extends Error {
  constructor(public readonly status: 404, message:string) { super(message) }
}

export async function loadSchoolDetail(schoolId:number,profileId?:string) {
  const [schoolRows] = await database.query<RowDataPacket[]>(
    `SELECT s.id,s.name,p.name province,s.city,s.level,s.school_type schoolType,s.features,
     s.official_url officialUrl,s.admissions_url admissionsUrl,s.links_verified_at linksVerifiedAt,s.links_source_url linksSourceUrl
     FROM schools s JOIN provinces p ON p.id=s.province_id WHERE s.id=?`, [schoolId],
  )
  if (!schoolRows[0]) throw new SchoolDetailLookupError(404,'院校不存在')
  const schoolRow=schoolRows[0]
  const [majorRows]=await database.query<RowDataPacket[]>(
    `SELECT fme.id evidenceId,m.id majorId,COALESCE(m.name,fme.major_name) name,m.category,fme.major_code majorCode,fme.recognition_type recognitionType,fme.recognition_year recognitionYear,
     ds.source_year sourceYear,ds.source_url sourceUrl,ds.publisher,fme.verified_at verifiedAt
     FROM school_featured_major_evidence fme LEFT JOIN majors m ON m.id=fme.major_id JOIN data_sources ds ON ds.id=fme.source_id
     WHERE fme.school_id=? AND fme.verified_at IS NOT NULL
     ORDER BY fme.recognition_year DESC,COALESCE(m.name,fme.major_name)`,[schoolId],
  )
  const [recommendedRows]=majorRows.length? [[]] as unknown as [RowDataPacket[]] : await database.query<RowDataPacket[]>(
    `SELECT ap.major_name name,MAX(ap.year) latestYear,COUNT(DISTINCT ap.year) yearCount,MAX(ds.source_url) sourceUrl
     FROM admission_programs ap LEFT JOIN data_sources ds ON ds.id=ap.source_id
     WHERE ap.school_id=? AND ap.unit_type='exact_major'
     GROUP BY ap.major_name ORDER BY yearCount DESC,latestYear DESC,ap.major_name LIMIT 18`,[schoolId],
  )
  let admissionContext:null|Record<string,unknown>=null
  let isSaved=false
  if(profileId){
    const [profileRows]=await database.query<RowDataPacket[]>(
      `SELECT p.name province,sp.subject_group subjectGroup,sp.province_rank provinceRank
       FROM student_profiles sp JOIN provinces p ON p.id=sp.province_id WHERE sp.id=?`,[profileId],
    )
    if(!profileRows[0])throw new SchoolDetailLookupError(404,'学生档案不存在')
    const profile=profileRows[0]
    const [savedRows]=await database.query<RowDataPacket[]>(`SELECT state FROM profile_saved_items WHERE profile_id=? AND item_type='school' AND item_id=? AND state='target' LIMIT 1`,[profileId,schoolId])
    isSaved=Boolean(savedRows[0])
    const [recordRows]=await database.query<RowDataPacket[]>(
      `SELECT ap.id,ap.year,ap.unit_type unitType,ap.major_name unitName,ap.unit_code unitCode,
       ap.subject_requirement subjectRequirement,ap.min_score minScore,ap.min_rank minRank,
       ds.source_url sourceUrl,ds.publisher
       FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id
       LEFT JOIN data_sources ds ON ds.id=ap.source_id
       WHERE ap.school_id=? AND p.name=? AND ap.subject_group=?
       AND ap.year>=(SELECT COALESCE(MAX(ap2.year)-2,0) FROM admission_programs ap2 JOIN provinces p2 ON p2.id=ap2.province_id WHERE ap2.school_id=? AND p2.name=? AND ap2.subject_group=?)
       ORDER BY ap.year DESC,ap.major_name LIMIT 36`,
      [schoolId,profile.province,profile.subjectGroup,schoolId,profile.province,profile.subjectGroup],
    )
    const groups=new Map<string,RowDataPacket[]>()
    for(const row of recordRows){const key=`${row.unitType}:${row.unitName}`;groups.set(key,[...(groups.get(key)??[]),row])}
    const provinceRank=profile.provinceRank==null?null:Number(profile.provinceRank)
    const records=recordRows.map(row=>{
      const group=groups.get(`${row.unitType}:${row.unitName}`)??[row]
      const assessment=provinceRank?(group.length>=2?classifySchoolRisk(provinceRank,group.map(item=>Number(item.minRank))):classifySingleYearRisk(provinceRank,Number(row.minRank))):null
      return {id:Number(row.id),year:Number(row.year),unitType:String(row.unitType),unitName:String(row.unitName),unitCode:row.unitCode==null?null:String(row.unitCode),subjectRequirement:row.subjectRequirement==null?null:String(row.subjectRequirement),minScore:row.minScore==null?null:Number(row.minScore),minRank:Number(row.minRank),risk:assessment?.risk??null,confidence:group.length>=3?'高':group.length===2?'中':'低',sourceUrl:row.sourceUrl==null?null:String(row.sourceUrl),publisher:row.publisher==null?null:String(row.publisher)}
    })
    admissionContext={profileProvince:String(profile.province),subjectGroup:String(profile.subjectGroup),provinceRank,years:[...new Set(records.map(item=>item.year))].sort((a,b)=>b-a),records}
  }
  const school={id:Number(schoolRow.id),name:String(schoolRow.name),province:String(schoolRow.province),city:String(schoolRow.city),level:String(schoolRow.level),schoolType:String(schoolRow.schoolType??'类型待核验'),features:parseJson(schoolRow.features),officialUrl:schoolRow.officialUrl??null,admissionsUrl:schoolRow.admissionsUrl??null,linksVerifiedAt:schoolRow.linksVerifiedAt??null,linksSourceUrl:schoolRow.linksSourceUrl??null}
  const location=school.province===school.city?school.city:`${school.province}${school.city}`
  const featuredMajors=majorRows.map(row=>({id:Number(row.evidenceId),majorId:row.majorId==null?null:Number(row.majorId),name:String(row.name),category:row.category==null?null:String(row.category),majorCode:row.majorCode==null?null:String(row.majorCode),recognitionType:String(row.recognitionType),recognitionYear:row.recognitionYear==null?null:Number(row.recognitionYear),sourceYear:Number(row.sourceYear),sourceUrl:String(row.sourceUrl),publisher:String(row.publisher),verifiedAt:new Date(row.verifiedAt).toISOString()}))
  const recommendationSource=schoolRow.admissionsUrl??schoolRow.officialUrl??null
  const admissionRecommendations=[...new Map(recommendedRows.map(row=>{
    const name=String(row.name).replace(/^(物理类|历史类|文科|理科)\s*/,'').trim()
    return [name,{name,basis:`该专业出现在该校 ${Number(row.yearCount)} 个年份的已导入招生记录中，最近为 ${Number(row.latestYear)} 年；这是关注建议，不是官方优势专业认定`,evidenceLevel:'admission' as const,sourceUrl:row.sourceUrl??recommendationSource}]
  })).values()].slice(0,6)
  const recommendedMajors=featuredMajors.length?[]:admissionRecommendations.length?admissionRecommendations:orientationRecommendations(String(schoolRow.name),recommendationSource)
  const contextRecords=(admissionContext?.records as Array<{year:number;risk:string|null}>|undefined)??[]
  const interpretation=[
    {label:'学校定位',text:`${school.name}位于${location}，当前院校层次标记为${school.level}，办学类型为${school.schoolType}。`},
    {label:'当前档案',text:!profileId?'建立学生档案后，可查看面向本省科类的招生单元与历史位次。':contextRecords.length?`当前档案可核对 ${new Set(contextRecords.map(item=>item.year)).size} 个年份、${contextRecords.length} 条招生记录；风险仅按历史位次规则解释。`:`当前档案所在省份与科类暂无该校可比招生记录。`},
    {label:'核验提醒',text:school.admissionsUrl?'正式填报前仍需到本科招生网核对当年招生计划、选科要求和院校章程。':'该校招生官网尚未完成核验，当前仅展示数据库中已有事实。'},
  ]
  return {school,featuredMajors,recommendedMajors,admissionContext,interpretation,isSaved}
}

function parseJson(value:unknown){if(typeof value!=='string')return value??{};try{return JSON.parse(value)}catch{return{}}}
