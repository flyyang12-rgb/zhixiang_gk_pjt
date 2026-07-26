import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { database } from '../server/database.js'

const sourceSchema=z.object({
  name:z.string().trim().min(2).max(100),
  sourceType:z.enum(['official','public_platform','employer']),
  baseUrl:z.string().url().refine(value=>/^https?:\/\//.test(value)),
  termsUrl:z.string().url().nullable().optional(),
  collectionPolicy:z.string().trim().min(2).max(1000),
  enabled:z.boolean().default(false),
})

async function run(){
  const inputPath=resolve(process.argv[2]??'data/employment-sources.json')
  const records=z.array(sourceSchema).parse(JSON.parse(await readFile(inputPath,'utf8')))
  let imported=0
  for(const item of records){
    await database.execute(
      `INSERT INTO job_sources(name,source_type,base_url,access_policy_url,collection_policy,status)
       VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE source_type=VALUES(source_type),base_url=VALUES(base_url),access_policy_url=VALUES(access_policy_url),collection_policy=VALUES(collection_policy),status=VALUES(status)`,
      [item.name,item.sourceType,item.baseUrl,item.termsUrl??null,item.collectionPolicy,item.enabled?'degraded':'paused'],
    )
    imported+=1
  }
  console.log(JSON.stringify({inputPath,imported,enabled:records.filter(item=>item.enabled).length},null,2))
  await database.end()
}

run().catch(async error=>{console.error(error instanceof Error?error.message:error);await database.end();process.exitCode=1})
