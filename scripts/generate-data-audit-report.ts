import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { database, type DatabaseRow as RowDataPacket } from '../server/database.js'

async function rows(sql:string,values:unknown[]=[]){return (await database.query<RowDataPacket[]>(sql,values))[0]}
async function run(){
  const [admissionCoverage,scopeAudits,schoolFacts,importBatches,employmentSources,directionCoverage,groupMembers,outlookCoverage]=await Promise.all([
    rows(`SELECT p.name province,ap.year,ap.education_level educationLevel,ap.batch,ap.subject_group subjectGroup,ap.unit_type unitType,
      COUNT(*) recordCount,COUNT(*) FILTER (WHERE ap.recommendation_eligible=1) recommendationEligibleCount,COUNT(DISTINCT ap.school_id) schoolCount
      FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id
      WHERE p.name IN ('河南','山东','河北') AND ap.year BETWEEN 2023 AND 2025
      GROUP BY p.name,ap.year,ap.education_level,ap.batch,ap.subject_group,ap.unit_type
      ORDER BY CASE p.name WHEN '河南' THEN 1 WHEN '山东' THEN 2 WHEN '河北' THEN 3 ELSE 4 END,ap.year,ap.education_level,ap.batch,ap.subject_group`),
    rows(`SELECT p.name province,a.year,a.education_level educationLevel,a.admission_category admissionCategory,a.batch,a.subject_group subjectGroup,
      a.status,a.reason,ds.publisher,ds.source_url sourceUrl,a.checked_at checkedAt
      FROM admission_scope_audits a JOIN provinces p ON p.id=a.province_id LEFT JOIN data_sources ds ON ds.id=a.source_id
      ORDER BY CASE p.name WHEN '河南' THEN 1 WHEN '山东' THEN 2 WHEN '河北' THEN 3 ELSE 4 END,a.year,a.education_level,a.batch`),
    rows(`SELECT fact_type factType,status,COUNT(*) count FROM school_fact_audits GROUP BY fact_type,status ORDER BY fact_type,status`),
    rows(`SELECT id,status,inserted_count insertedCount,updated_count updatedCount,report,created_at createdAt,completed_at completedAt
      FROM import_batches ORDER BY created_at DESC LIMIT 100`),
    rows(`SELECT name,source_type sourceType,base_url baseUrl,access_policy_url accessPolicyUrl,collection_policy collectionPolicy,status,
      last_success_at lastSuccessAt,CURRENT_DATE-last_success_at::date staleDays,failure_count failureCount FROM job_sources ORDER BY name`),
    rows(`SELECT COUNT(*) participatingMajorCount,COUNT(*) FILTER (WHERE directionCount>=3) majorsWithThreeApprovedDirections
      FROM (SELECT m.id,COUNT(mjd.job_direction_id) directionCount FROM majors m
      LEFT JOIN major_job_directions mjd ON mjd.major_id=m.id AND mjd.review_status='approved'
      GROUP BY m.id) coverage`),
    rows(`SELECT COUNT(*) verifiedGroupMemberCount,COUNT(DISTINCT admission_program_id) coveredGroupCount
      FROM admission_unit_majors WHERE verification_status='verified'`),
    rows(`SELECT COUNT(DISTINCT CASE WHEN moe.valid_until>=CURRENT_DATE THEN moe.major_id END) majorsWithActiveEvidence,
      COUNT(DISTINCT CASE WHEN moe.valid_until<CURRENT_DATE THEN moe.major_id END) majorsWithExpiredEvidence,
      COUNT(DISTINCT CASE WHEN mjd.review_status='approved' THEN mjd.major_id END) reviewedMajorPoolCount
      FROM majors m LEFT JOIN major_job_directions mjd ON mjd.major_id=m.id
      LEFT JOIN major_outlook_evidence moe ON moe.major_id=m.id`),
  ])
  const pendingScopes=scopeAudits.filter(row=>String(row.status)==='pending').length
  const report={
    generatedAt:new Date().toISOString(),definition:'每项以 verified / unavailable / not_applicable / pending 闭环；pending 不等同于数据已补全。',
    admissions:{coverage:admissionCoverage,scopeAudits,pendingScopeCount:pendingScopes,groupMembers:groupMembers[0]??{}},
    schools:{factStatus:schoolFacts},employment:{sources:employmentSources,directionCoverage:directionCoverage[0]??{}},professionOutlook:outlookCoverage[0]??{},imports:{recentBatches:importBatches},
  }
  const output=resolve('.scratch/data-completion/audit-report.json')
  await mkdir(resolve('.scratch/data-completion'),{recursive:true})
  await writeFile(output,`${JSON.stringify(report,null,2)}\n`,'utf8')
  console.log(JSON.stringify({output,pendingScopeCount:pendingScopes,coverageRows:admissionCoverage.length,schoolFactRows:schoolFacts.length,employmentSources:employmentSources.length},null,2))
}
run().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1}).finally(()=>database.end())
