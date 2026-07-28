import 'dotenv/config'
import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { RowDataPacket } from 'mysql2'
import { database } from '../server/database.js'
import { prepareFeaturedMajorRecord,type FeaturedMajorInput } from './featured-major-import-policy.js'

const inputPath=resolve(process.argv[2]??'data/featured-majors.json')

async function run(){
  const raw=JSON.parse(await readFile(inputPath,'utf8')) as unknown
  if(!Array.isArray(raw))throw new Error('优势专业文件必须是 JSON 数组')
  const values=raw.flatMap(value=>{
    if(!value||typeof value!=='object'||!Array.isArray((value as {majors?:unknown}).majors))return [value]
    const {majors,...source}=value as Record<string,unknown>&{majors:Array<string|{name:string;code?:string}>}
    return majors.map(major=>({...source,majorName:typeof major==='string'?major:major.name,majorCode:typeof major==='string'?undefined:major.code}))
  })
  let inserted=0,updated=0,skipped=0;const errors:string[]=[],unmapped:string[]=[]
  for(const [index,value] of values.entries()){
    try{
      const record=prepareFeaturedMajorRecord(value as FeaturedMajorInput)
      const [schools]=await database.query<RowDataPacket[]>('SELECT id FROM schools WHERE name=? LIMIT 2',[record.schoolName])
      if(schools.length!==1)throw new Error(schools.length?'学校名称不唯一，请先修正院校映射':'未找到完全匹配的学校')
      const [majors]=await database.query<RowDataPacket[]>('SELECT id,name,code FROM majors WHERE (? IS NOT NULL AND code=?) OR name=? LIMIT 2',[record.majorCode??null,record.majorCode??null,record.majorName])
      if(majors.length>1)throw new Error('专业映射不唯一，请检查专业代码与名称')
      const majorId=majors[0]?.id??null
      if(!majorId)unmapped.push(`${record.schoolName}：${record.majorName}${record.majorCode?`（${record.majorCode}）`:''}`)
      const connection=await database.getConnection()
      try{
        await connection.beginTransaction()
        await connection.execute(`INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,published_at,collected_at) VALUES('major',?,?,?,?,NULL,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,[`${record.schoolName}${record.recognitionType}`,record.sourceUrl,record.sourceYear,record.publisher,new Date(record.verifiedAt)])
        const [sourceRows]=await connection.query<RowDataPacket[]>('SELECT id FROM data_sources WHERE source_url=? AND source_year=? LIMIT 1',[record.sourceUrl,record.sourceYear])
        const [existingRows]=await connection.query<RowDataPacket[]>('SELECT id FROM school_featured_major_evidence WHERE school_id=? AND major_name=? AND recognition_type=? AND recognition_year <=> ? LIMIT 1',[schools[0]!.id,record.majorName,record.recognitionType,record.recognitionYear??null])
        if(existingRows[0])await connection.execute('UPDATE school_featured_major_evidence SET major_id=?,major_code=?,education_level=?,source_id=?,verified_at=? WHERE id=?',[majorId,record.majorCode??majors[0]?.code??null,record.educationLevel,sourceRows[0]!.id,new Date(record.verifiedAt),existingRows[0].id])
        else await connection.execute(`INSERT INTO school_featured_major_evidence(school_id,major_id,major_name,major_code,education_level,recognition_type,recognition_year,source_id,verified_at) VALUES(?,?,?,?,?,?,?,?,?)`,[schools[0]!.id,majorId,record.majorName,record.majorCode??majors[0]?.code??null,record.educationLevel,record.recognitionType,record.recognitionYear??null,sourceRows[0]!.id,new Date(record.verifiedAt)])
        await connection.execute(
          `INSERT INTO school_fact_audits(school_id,fact_type,status,reason,source_url,checked_at)
           VALUES (?,'featured_major','verified',NULL,?,?)
           ON DUPLICATE KEY UPDATE status='verified',reason=NULL,source_url=VALUES(source_url),checked_at=VALUES(checked_at)`,
          [schools[0]!.id,record.sourceUrl,new Date(record.verifiedAt)],
        )
        await connection.commit();if(existingRows.length)updated+=1;else inserted+=1
      }catch(error){await connection.rollback();throw error}finally{connection.release()}
    }catch(error){skipped+=1;errors.push(`第 ${index+1} 条：${error instanceof Error?error.message:'未知错误'}`)}
  }
  const report={generatedAt:new Date().toISOString(),inputPath,total:values.length,inserted,updated,skipped,unmappedCount:unmapped.length,unmapped,errors}
  const reportPath=resolve('.scratch/featured-major-import-report.json');await mkdir(resolve('.scratch'),{recursive:true});await writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`,'utf8')
  console.log(JSON.stringify({...report,reportPath},null,2))
}
run().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1}).finally(()=>database.end())
