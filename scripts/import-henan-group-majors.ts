import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { database } from '../server/database.js'

const inputSchema=z.object({
  source:z.object({title:z.string().min(1),url:z.string().url(),year:z.number().int().min(2025),publisher:z.string().min(1),publishedAt:z.string().date().optional()}),
  records:z.array(z.object({schoolName:z.string().min(1),subjectGroup:z.enum(['物理类','历史类']),unitCode:z.string().min(1),majorName:z.string().min(1),majorCode:z.string().optional()})),
})

async function run(){
  const input=inputSchema.parse(JSON.parse(await readFile(resolve(process.argv[2]??'data/henan-group-majors.json'),'utf8')))
  const [sourceResult]=await database.execute<import('mysql2').ResultSetHeader>(`INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,published_at) VALUES('admission',?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),publisher=VALUES(publisher),published_at=VALUES(published_at),id=LAST_INSERT_ID(id)`,[input.source.title,input.source.url,input.source.year,input.source.publisher,input.source.publishedAt??null])
  let verified=0,unmatchedUnits=0,unmatchedMajors=0
  for(const record of input.records){
    const [units]=await database.query<import('mysql2').RowDataPacket[]>(`SELECT ap.id FROM admission_programs ap JOIN schools s ON s.id=ap.school_id JOIN provinces p ON p.id=ap.province_id WHERE p.name='河南' AND ap.year=? AND ap.subject_group=? AND ap.unit_type='major_group' AND ap.unit_code=? AND s.name=? LIMIT 1`,[input.source.year,record.subjectGroup,record.unitCode,record.schoolName])
    if(!units[0]){unmatchedUnits+=1;continue}
    const [majors]=await database.query<import('mysql2').RowDataPacket[]>(`SELECT id FROM majors WHERE (? IS NOT NULL AND code=?) OR name=? ORDER BY code IS NULL LIMIT 1`,[record.majorCode??null,record.majorCode??null,record.majorName])
    if(!majors[0]){unmatchedMajors+=1;continue}
    await database.execute(`INSERT INTO admission_unit_majors(admission_program_id,raw_major_name,major_id,source_id,verification_status,verified_at) VALUES(?,?,?,?, 'verified',NOW()) ON DUPLICATE KEY UPDATE major_id=VALUES(major_id),source_id=VALUES(source_id),verification_status='verified',verified_at=NOW()`,[units[0].id,record.majorName,majors[0].id,sourceResult.insertId])
    verified+=1
  }
  console.log(JSON.stringify({total:input.records.length,verified,unmatchedUnits,unmatchedMajors,sourceUrl:input.source.url},null,2))
  await database.end()
}

run().catch(async error=>{console.error(error instanceof Error?error.message:error);await database.end();process.exitCode=1})
