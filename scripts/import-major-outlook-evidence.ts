import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { database, type DatabaseRow as RowDataPacket } from '../server/database.js'

const recordSchema=z.object({
  majorCode:z.string().trim().min(4).max(16),
  signalType:z.enum(['digital_talent','industrial_transformation','public_service_demand','demographic_demand']),
  signalLevel:z.enum(['moderate','strong']),
  rationale:z.string().trim().min(20).max(1000),
  sourceTitle:z.string().trim().min(5).max(255),
  sourceUrl:z.string().url().refine(value=>value.startsWith('https://'),'来源必须使用 HTTPS'),
  sourceYear:z.number().int().min(2000).max(new Date().getFullYear()),
  publisher:z.string().trim().min(2).max(128),
  reviewedAt:z.string().date(),
  validUntil:z.string().date(),
}).refine(value=>value.validUntil>=value.reviewedAt,{message:'有效期不得早于核验日期'})

async function run(){
  const inputPath=resolve(process.argv[2]??'data/major-outlook-evidence.json')
  const records=z.array(recordSchema).parse(JSON.parse(await readFile(inputPath,'utf8')))
  let inserted=0,updated=0
  for(const record of records){
    const [majors]=await database.query<RowDataPacket[]>('SELECT id FROM majors WHERE code=? LIMIT 2',[record.majorCode])
    if(majors.length!==1)throw new Error(`专业代码无法唯一映射：${record.majorCode}`)
    const connection=await database.getConnection()
    try{
      await connection.beginTransaction()
      await connection.execute(`INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,collected_at) VALUES('major',?,?,?,?,?) ON CONFLICT (source_url,source_year) DO UPDATE SET title=EXCLUDED.title,publisher=EXCLUDED.publisher,collected_at=EXCLUDED.collected_at`,[record.sourceTitle,record.sourceUrl,record.sourceYear,record.publisher,new Date(record.reviewedAt)])
      const [sources]=await connection.query<RowDataPacket[]>('SELECT id FROM data_sources WHERE source_url=? AND source_year=? LIMIT 1',[record.sourceUrl,record.sourceYear])
      const [existing]=await connection.query<RowDataPacket[]>('SELECT id FROM major_outlook_evidence WHERE major_id=? AND source_id=? AND signal_type=?',[majors[0]!.id,sources[0]!.id,record.signalType])
      await connection.execute(`INSERT INTO major_outlook_evidence(major_id,source_id,signal_type,signal_level,rationale,reviewed_at,valid_until) VALUES(?,?,?,?,?,?,?) ON CONFLICT (major_id,source_id,signal_type) DO UPDATE SET signal_level=EXCLUDED.signal_level,rationale=EXCLUDED.rationale,reviewed_at=EXCLUDED.reviewed_at,valid_until=EXCLUDED.valid_until`,[majors[0]!.id,sources[0]!.id,record.signalType,record.signalLevel,record.rationale,record.reviewedAt,record.validUntil])
      await connection.commit()
      if(existing.length)updated+=1;else inserted+=1
    }catch(error){await connection.rollback();throw error}finally{connection.release()}
  }
  console.log(JSON.stringify({inputPath,total:records.length,inserted,updated},null,2))
}

run().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1}).finally(()=>database.end())
