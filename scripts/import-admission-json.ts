import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { database, type DatabaseResult as ResultSetHeader, type DatabaseRow as RowDataPacket } from '../server/database.js'
import { commitAdmissionPreflight, persistAdmissionPreflight, preflightAdmissionRows, registerSourceArtifact } from '../server/admission-import.js'

const sourceSchema=z.object({
  title:z.string().min(1),officialPageUrl:z.string().url(),downloadUrl:z.string().url().nullable().optional(),mirrorUrl:z.string().url().nullable().optional(),
  mirrorDisclosure:z.string().min(1).nullable().optional(),year:z.number().int().min(2023).max(2025),publisher:z.string().min(1),publishedAt:z.string().date().nullable().optional(),
  province:z.enum(['河南','山东','河北']),subjectGroup:z.string().min(1),educationLevel:z.enum(['本科','专科']),admissionCategory:z.string().min(1),
  batch:z.string().min(1),planType:z.string().min(1),unitType:z.enum(['exact_major','major_group','school_line']),eligibilityRequirement:z.string().nullable().optional(),
  rawFile:z.string().min(1),
})
const rowSchema=z.object({
  schoolName:z.string().min(1),matchSchoolName:z.string().optional(),validationError:z.string().nullable().optional(),unitName:z.string().min(1),unitCode:z.string().nullable().optional(),
  schoolCode:z.string().nullable().optional(),majorCode:z.string().nullable().optional(),subjectRequirement:z.string().nullable().optional(),minScore:z.number().nonnegative().nullable().optional(),
  minRank:z.number().int().positive().nullable().optional(),enrollmentCount:z.number().int().nonnegative().nullable().optional(),eligibilityRequirement:z.string().nullable().optional(),
})
const inputSchema=z.object({source:sourceSchema,rows:z.array(rowSchema).min(1)})

async function run(){
  const argument=process.argv.slice(2).find(value=>!value.startsWith('--'))
  if(!argument)throw new Error('用法：npm run data:admissions -- <标准化 JSON> [--commit]')
  const inputPath=resolve(argument)
  const input=inputSchema.parse(JSON.parse(await readFile(inputPath,'utf8')))
  const rawPath=resolve(input.source.rawFile)
  const rawBytes=await readFile(rawPath)
  const [provinces]=await database.query<RowDataPacket[]>('SELECT id FROM provinces WHERE name=? LIMIT 1',[input.source.province])
  if(!provinces[0])throw new Error(`未找到省份：${input.source.province}`)
  const provinceId=Number(provinces[0].id)
  const [sourceResult]=await database.execute<ResultSetHeader>(
    `INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,published_at,collected_at)
     VALUES('admission',?,?,?,?,?,NOW()) ON CONFLICT (source_url,source_year) DO UPDATE SET title=EXCLUDED.title,publisher=EXCLUDED.publisher,published_at=EXCLUDED.published_at RETURNING id`,
    [input.source.title,input.source.officialPageUrl,input.source.year,input.source.publisher,input.source.publishedAt??null],
  )
  const sourceId=sourceResult.insertId
  const connection=await database.getConnection()
  try{
  const artifact=await registerSourceArtifact(connection,{
    sourceId,officialPageUrl:input.source.officialPageUrl,downloadUrl:input.source.downloadUrl,mirrorUrl:input.source.mirrorUrl,
    mirrorDisclosure:input.source.mirrorDisclosure,publishedAt:input.source.publishedAt,bytes:rawBytes,localPath:rawPath,
  })
  const [schools]=await database.query<RowDataPacket[]>('SELECT id,name FROM schools')
  const [aliases]=await database.query<RowDataPacket[]>(`SELECT alias,school_id schoolId FROM school_aliases WHERE verification_status='verified'`)
  const preflight=preflightAdmissionRows({
    source:{provinceId,province:input.source.province,year:input.source.year,subjectGroup:input.source.subjectGroup,educationLevel:input.source.educationLevel,
      admissionCategory:input.source.admissionCategory,batch:input.source.batch,planType:input.source.planType,unitType:input.source.unitType,
      eligibilityRequirement:input.source.eligibilityRequirement},
    schools:schools.map(row=>({id:Number(row.id),name:String(row.name)})),
    verifiedAliases:aliases.map(row=>({alias:String(row.alias),schoolId:Number(row.schoolId)})),rows:input.rows,
  })
  const batchId=await persistAdmissionPreflight(connection,{sourceId,artifactId:artifact.id,preflight})
  const lineBalance=preflight.report.valid+preflight.report.duplicate+preflight.report.unmatched+preflight.report.rejected===preflight.report.raw
  if(!lineBalance)throw new Error('导入预检行数不守恒')
  let commitResult:null|{batchId:string;inserted:number;updated:number}=null
  if(process.argv.includes('--commit'))commitResult=await commitAdmissionPreflight(connection,batchId)
  const closed=Boolean(commitResult)&&preflight.report.unmatched===0&&preflight.report.rejected===0
  await connection.execute(
    `INSERT INTO admission_scope_audits(province_id,year,education_level,admission_category,batch,subject_group,status,reason,source_id,checked_at)
     VALUES (?,?,?,?,?,?,?, ?,?,NOW())
     ON CONFLICT (province_id,year,education_level,admission_category,batch,subject_group) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason,source_id=EXCLUDED.source_id,checked_at=EXCLUDED.checked_at`,
    [provinceId,input.source.year,input.source.educationLevel,input.source.admissionCategory,input.source.batch,input.source.subjectGroup,
      closed?'verified':'pending',closed?null:commitResult?'仍有未匹配或拒绝记录，尚未闭环':'预检已生成，等待人工确认后提交',sourceId],
  )
  console.log(JSON.stringify({batchId,mode:commitResult?'committed':'preflight',artifact,report:preflight.report,commitResult},null,2))
  }finally{connection.release()}
}

run().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1}).finally(()=>database.end())
