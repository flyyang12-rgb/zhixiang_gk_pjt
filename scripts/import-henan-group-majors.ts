import 'dotenv/config'
import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { database } from '../server/database.js'
import { registerSourceArtifact } from '../server/admission-import.js'

const inputSchema=z.object({
  source:z.object({title:z.string().min(1),url:z.string().url(),year:z.number().int().min(2025),publisher:z.string().min(1),publishedAt:z.string().date().optional()}),
  records:z.array(z.object({schoolName:z.string().min(1),subjectGroup:z.enum(['物理类','历史类']),unitCode:z.string().min(1),majorName:z.string().min(1),majorCode:z.string().optional()})),
})

async function run(){
  const inputPath=resolve(process.argv[2]??'data/henan-group-majors.json')
  const inputBytes=await readFile(inputPath)
  const input=inputSchema.parse(JSON.parse(inputBytes.toString('utf8')))
  const [sourceResult]=await database.execute<import('mysql2').ResultSetHeader>(`INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,published_at) VALUES('admission',?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),publisher=VALUES(publisher),published_at=VALUES(published_at),id=LAST_INSERT_ID(id)`,[input.source.title,input.source.url,input.source.year,input.source.publisher,input.source.publishedAt??null])
  const sourceId=sourceResult.insertId
  const connection=await database.getConnection()
  await registerSourceArtifact(connection,{sourceId,officialPageUrl:input.source.url,publishedAt:input.source.publishedAt,bytes:inputBytes,localPath:inputPath})
  let verified=0,unmatchedUnits=0,unmatchedMajors=0
  const errors:string[]=[]
  await connection.beginTransaction()
  try{
  for(const record of input.records){
    const [units]=await connection.query<import('mysql2').RowDataPacket[]>(`SELECT ap.id FROM admission_programs ap JOIN schools s ON s.id=ap.school_id JOIN provinces p ON p.id=ap.province_id WHERE p.name='河南' AND ap.year=? AND ap.subject_group=? AND ap.unit_type='major_group' AND ap.unit_code=? AND s.name=? LIMIT 2`,[input.source.year,record.subjectGroup,record.unitCode,record.schoolName])
    if(units.length!==1){unmatchedUnits+=1;errors.push(`${record.schoolName}/${record.unitCode}：招生单元${units.length?'不唯一':'不存在'}`);continue}
    const [majors]=await connection.query<import('mysql2').RowDataPacket[]>(`SELECT id FROM majors WHERE (? IS NOT NULL AND code=?) OR name=? LIMIT 2`,[record.majorCode??null,record.majorCode??null,record.majorName])
    if(majors.length!==1){unmatchedMajors+=1;errors.push(`${record.majorName}：标准专业${majors.length?'不唯一':'不存在'}`);continue}
    await connection.execute(`INSERT INTO admission_unit_majors(admission_program_id,raw_major_name,major_id,source_id,verification_status,verified_at) VALUES(?,?,?,?, 'verified',NOW()) ON DUPLICATE KEY UPDATE major_id=VALUES(major_id),source_id=VALUES(source_id),verification_status='verified',verified_at=NOW()`,[units[0].id,record.majorName,majors[0].id,sourceId])
    verified+=1
  }
  await connection.commit()
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
  const report={generatedAt:new Date().toISOString(),total:input.records.length,verified,unmatchedUnits,unmatchedMajors,errors,sourceUrl:input.source.url}
  const reportPath=resolve('.scratch/henan-group-major-import-report.json');await mkdir(resolve('.scratch'),{recursive:true});await writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`,'utf8')
  console.log(JSON.stringify({...report,reportPath},null,2))
  await database.end()
}

run().catch(async error=>{console.error(error instanceof Error?error.message:error);await database.end();process.exitCode=1})
