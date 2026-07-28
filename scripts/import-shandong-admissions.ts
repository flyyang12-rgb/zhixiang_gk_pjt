import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import * as XLSX from 'xlsx'
import { config } from '../server/config.js'
import { commitAdmissionPreflight, persistAdmissionPreflight, preflightAdmissionRows, registerSourceArtifact, type RawAdmissionImportRow } from '../server/admission-import.js'

const sources = [
  { year:2023,publishedAt:'2023-07-19',page:'https://www.sdzk.cn/NewsInfo.aspx?NewsID=6279',file:'https://www.sdzk.cn/Floadup/file/20230719/6382538122655052185031609.xls' },
  { year:2024,publishedAt:'2024-07-19',page:'https://www.sdzk.cn/NewsInfo.aspx?NewsID=6656',file:'https://www.sdzk.cn/Floadup/file/20240719/6385700532268895241675882.xls' },
  { year:2025,publishedAt:'2025-07-19',page:'https://www.sdzk.cn/NewsInfo.aspx?BCID=20&CID=1204&NewsID=6996',file:'https://www.sdzk.cn/Floadup/file/20250719/6388855130412530367357143.xls' },
] as const

const connection=await mysql.createConnection({host:config.DB_HOST,port:config.DB_PORT,database:config.DB_NAME,user:config.DB_USER,password:config.DB_PASSWORD})
try{
  const [provinceRows]=await connection.query<mysql.RowDataPacket[]>(`SELECT id FROM provinces WHERE name='山东'`)
  const provinceId=Number(provinceRows[0]?.id)
  if(!provinceId)throw new Error('山东省份数据不存在，请先执行 npm run db:init')
  const [schoolRows]=await connection.query<mysql.RowDataPacket[]>(`SELECT id,name FROM schools`)
  const schools=schoolRows.map(row=>({id:Number(row.id),name:String(row.name)}))
  const [aliasRows]=await connection.query<mysql.RowDataPacket[]>(`SELECT alias,school_id schoolId FROM school_aliases WHERE verification_status='verified'`)
  const verifiedAliases=aliasRows.map(row=>({alias:String(row.alias),schoolId:Number(row.schoolId)}))

  for(const source of sources){
    const response=await fetch(source.file,{signal:AbortSignal.timeout(30_000),redirect:'follow'})
    if(!response.ok)throw new Error(`山东 ${source.year} 投档表下载失败：${response.status}`)
    const buffer=Buffer.from(await response.arrayBuffer())
    if(buffer.byteLength>30*1024*1024)throw new Error(`山东 ${source.year} 投档表超过 30MB 安全上限`)
    const rawUrl=new URL(`../data/raw/shandong/${source.year}/regular-first.xls`,import.meta.url)
    await mkdir(dirname(fileURLToPath(rawUrl)),{recursive:true})
    await writeFile(rawUrl,buffer)
    const workbook=XLSX.read(buffer)
    const rows=XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]!]!,{header:1,blankrows:false}).slice(2)
    const [sourceResult]=await connection.execute<mysql.ResultSetHeader>(
      `INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,published_at) VALUES('admission',?,?,?,'山东省教育招生考试院',?) ON DUPLICATE KEY UPDATE title=VALUES(title),publisher=VALUES(publisher),published_at=VALUES(published_at),id=LAST_INSERT_ID(id)`,
      [`山东省${source.year}年普通类常规批第1次志愿投档情况表`,source.page,source.year,source.publishedAt],
    )
    const sourceId=sourceResult.insertId
    const artifact=await registerSourceArtifact(connection,{sourceId,officialPageUrl:source.page,downloadUrl:source.file,publishedAt:source.publishedAt,bytes:buffer,localPath:relative(process.cwd(),fileURLToPath(rawUrl)).replaceAll('\\','/')})
    const rawRows:RawAdmissionImportRow[]=rows.map(row=>{
      const majorRaw=String(row[0]??'').trim(),schoolRaw=String(row[1]??'').trim()
      const schoolName=schoolRaw.slice(4).trim()
      return {schoolName,matchSchoolName:schoolName.replace(/\(.*?校区\)$/g,'').trim(),unitName:majorRaw.slice(2).trim(),schoolCode:schoolRaw.slice(0,4)||null,majorCode:majorRaw.slice(0,2)||null,minRank:numberOrNull(row[3]),enrollmentCount:numberOrNull(row[2])}
    })
    const preflight=preflightAdmissionRows({source:{provinceId,province:'山东',year:source.year,subjectGroup:'综合改革',educationLevel:'本科',admissionCategory:'普通类',batch:'常规批第1次',planType:'普通计划',unitType:'exact_major'},schools,verifiedAliases,rows:rawRows})
    const batchId=await persistAdmissionPreflight(connection,{sourceId,artifactId:artifact.id,preflight})
    const committed=await commitAdmissionPreflight(connection,batchId)
    console.log(JSON.stringify({province:'山东',year:source.year,artifactSha256:artifact.sha256,...preflight.report,...committed},null,2))
  }
}finally{await connection.end()}

function numberOrNull(value:unknown){const number=Number(value);return Number.isFinite(number)&&number>0?number:null}
