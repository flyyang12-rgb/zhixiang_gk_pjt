import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { database } from '../server/database.js'
import { prepareLinkRecord,type LinkRecord } from './school-link-import-policy.js'
import type { RowDataPacket } from 'mysql2'

const inputPath = resolve(process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? 'data/school-links.json')
const trustedSnapshot = process.argv.includes('--trusted-snapshot')

async function run() {
  const records = JSON.parse(await readFile(inputPath, 'utf8')) as LinkRecord[]
  if (!Array.isArray(records)) throw new Error('学校链接文件必须是 JSON 数组')
  let updated = 0; let skipped = 0; const errors: string[] = []
  for (const [index, record] of records.entries()) {
    try {
      const prepared=await prepareLinkRecord(record,verifyReachable,trustedSnapshot)
      const [schoolRows]=await database.query<RowDataPacket[]>('SELECT id FROM schools WHERE name=? LIMIT 2',[prepared.schoolName])
      if(schoolRows.length!==1)throw new Error(schoolRows.length?'学校名称不唯一，请先修正院校映射':`未找到学校 ${record.schoolName}`)
      const schoolId=Number(schoolRows[0]!.id)
      const [result] = await database.execute(
        `UPDATE schools SET official_url=COALESCE(?,official_url),admissions_url=COALESCE(?,admissions_url),links_verified_at=?,links_source_url=? WHERE id=?`,
        [prepared.officialUrl,prepared.admissionsUrl,prepared.verifiedAt,prepared.sourceUrl,schoolId],
      )
      const affected = Number((result as { affectedRows?: number }).affectedRows ?? 0)
      if (!affected) throw new Error(`未更新学校 ${record.schoolName}`)
      for(const [factType,url] of [['official_website',prepared.officialUrl],['admissions_website',prepared.admissionsUrl]] as const){
        if(!url)continue
        await database.execute(
          `INSERT INTO school_fact_audits(school_id,fact_type,status,reason,source_url,checked_at)
           VALUES (?,?,'verified',NULL,?,?)
           ON DUPLICATE KEY UPDATE status='verified',reason=NULL,source_url=VALUES(source_url),checked_at=VALUES(checked_at)`,
          [schoolId,factType,prepared.sourceUrl,new Date(prepared.verifiedAt)],
        )
      }
      updated += 1
    } catch (error) { skipped += 1; errors.push(`第 ${index + 1} 条：${error instanceof Error ? error.message : '未知错误'}`) }
  }
  const report={generatedAt:new Date().toISOString(),inputPath,total:records.length,updated,skipped,errors}
  const reportPath=resolve('.scratch/school-link-import-report.json')
  await mkdir(resolve('.scratch'),{recursive:true})
  await writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`,'utf8')
  console.log(JSON.stringify({...report,reportPath}, null, 2))
  await database.end()
}

async function verifyReachable(url:string){
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15_000),headers:{'User-Agent':'ZhixiangLinkVerifier/1.0 (+link-check)'}})
  if(!response.ok)throw new Error(`链接核验失败 ${response.status}：${url}`)
  await response.body?.cancel()
}

run().catch(async error => { console.error(error instanceof Error ? error.message : error); await database.end(); process.exitCode = 1 })
