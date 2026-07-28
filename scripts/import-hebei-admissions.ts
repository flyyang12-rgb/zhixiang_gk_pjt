import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import * as XLSX from 'xlsx'
import { config } from '../server/config.js'
import { commitAdmissionPreflight, persistAdmissionPreflight, preflightAdmissionRows, registerSourceArtifact, type RawAdmissionImportRow } from '../server/admission-import.js'

type RankRow={score:number;physicsRank:number|null;historyRank:number|null}
type SubjectGroup='物理类'|'历史类'

const years=[
  {year:2023,publishedAt:'2023-07-24',rankSourceUrl:'https://file.hebeea.edu.cn/files/article/2023/06/20230624203549_178.pdf',files:[
    {subjectGroup:'历史类' as const,path:new URL('../data/raw/hebei/2023/history.xlsx',import.meta.url),sourceUrl:'https://gaokao.eol.cn/he_bei/dongtai/202307/W020230725339662979910.xlsx',publisher:'中国教育在线（河北省教育考试院数据镜像）'},
    {subjectGroup:'物理类' as const,path:new URL('../data/raw/hebei/2023/physics.xlsx',import.meta.url),sourceUrl:'https://gaokao.eol.cn/he_bei/dongtai/202307/W020230725339662993067.xlsx',publisher:'中国教育在线（河北省教育考试院数据镜像）'},
  ]},
  {year:2024,publishedAt:'2024-07-22',rankSourceUrl:'https://file.hebeea.edu.cn/files/article/2024/06/20240624195327_41.pdf',files:[
    {subjectGroup:'历史类' as const,path:new URL('../data/raw/hebei/2024/history.xlsx',import.meta.url),sourceUrl:'https://file.hebeea.edu.cn/files/article/2024/07/20240722163024_223.xlsx',publisher:'河北省教育考试院'},
    {subjectGroup:'物理类' as const,path:new URL('../data/raw/hebei/2024/physics.xlsx',import.meta.url),sourceUrl:'https://file.hebeea.edu.cn/files/article/2024/07/20240722163024_933.xlsx',publisher:'河北省教育考试院'},
  ]},
  {year:2025,publishedAt:'2025-07-22',rankSourceUrl:'https://file.hebeea.edu.cn/files/article/2025/06/20250624193800_658.pdf',files:[
    {subjectGroup:'历史类' as const,path:new URL('../data/raw/hebei/2025/history.xlsx',import.meta.url),sourceUrl:'https://file.hebeea.edu.cn/files/article/2025/07/20250722214851_332.xlsx',publisher:'河北省教育考试院'},
    {subjectGroup:'物理类' as const,path:new URL('../data/raw/hebei/2025/physics.xlsx',import.meta.url),sourceUrl:'https://file.hebeea.edu.cn/files/article/2025/07/20250722214852_210.xlsx',publisher:'河北省教育考试院'},
  ]},
] as const

const connection=await mysql.createConnection({host:config.DB_HOST,port:config.DB_PORT,database:config.DB_NAME,user:config.DB_USER,password:config.DB_PASSWORD})
try{
  const [provinceRows]=await connection.query<mysql.RowDataPacket[]>(`SELECT id FROM provinces WHERE name='河北'`)
  const provinceId=Number(provinceRows[0]?.id)
  if(!provinceId)throw new Error('河北省份数据不存在，请先执行 npm run db:init')
  const [schoolRows]=await connection.query<mysql.RowDataPacket[]>(`SELECT id,name FROM schools`)
  const schools=schoolRows.map(row=>({id:Number(row.id),name:String(row.name)})),schoolNames=new Set(schools.map(school=>school.name))
  const [aliasRows]=await connection.query<mysql.RowDataPacket[]>(`SELECT alias,school_id schoolId FROM school_aliases WHERE verification_status='verified'`)
  const verifiedAliases=aliasRows.map(row=>({alias:String(row.alias),schoolId:Number(row.schoolId)})),aliasNames=new Set(verifiedAliases.map(alias=>alias.alias))

  for(const yearConfig of years){
    const rankRows=JSON.parse(await readFile(new URL(`../data/hebei-${yearConfig.year}-ranks.json`,import.meta.url),'utf8')) as RankRow[]
    const rankMaps={历史类:new Map(rankRows.filter(row=>row.historyRank).map(row=>[row.score,Number(row.historyRank)])),物理类:new Map(rankRows.filter(row=>row.physicsRank).map(row=>[row.score,Number(row.physicsRank)]))}
    const fileReports=[]
    for(const file of yearConfig.files){
      const bytes=await readFile(file.path)
      const workbook=XLSX.read(bytes)
      const rows=XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]!]!,{header:1,blankrows:false}).slice(5)
      const [sourceResult]=await connection.execute<mysql.ResultSetHeader>(
        `INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,published_at) VALUES('admission',?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),publisher=VALUES(publisher),published_at=VALUES(published_at),id=LAST_INSERT_ID(id)`,
        [`河北省${yearConfig.year}年本科批${file.subjectGroup}平行志愿投档情况（位次映射：${yearConfig.rankSourceUrl}）`,file.sourceUrl,yearConfig.year,file.publisher,yearConfig.publishedAt],
      )
      const sourceId=sourceResult.insertId
      const artifact=await registerSourceArtifact(connection,{sourceId,officialPageUrl:yearConfig.rankSourceUrl,downloadUrl:file.sourceUrl,mirrorUrl:yearConfig.year===2023?file.sourceUrl:null,mirrorDisclosure:yearConfig.year===2023?'投档表为明确标注河北省教育考试院数据的公开镜像；位次表来自考试院。':null,publishedAt:yearConfig.publishedAt,bytes,localPath:relative(process.cwd(),fileURLToPath(file.path)).replaceAll('\\','/')})
      const rawRows:RawAdmissionImportRow[]=rows.map(row=>{
        const schoolName=String(row[1]??'').trim(),minScore=numberOrNull(row[4])
        return {schoolName,matchSchoolName:matchableSchoolName(schoolName,schoolNames,aliasNames),unitName:`${file.subjectGroup} ${cleanMajorName(String(row[3]??''))}`,schoolCode:String(row[0]??'').trim()||null,majorCode:String(row[2]??'').trim()||null,minScore,minRank:minScore?lookupRank(file.subjectGroup,minScore,rankRows,rankMaps)??null:null}
      })
      const preflight=preflightAdmissionRows({source:{provinceId,province:'河北',year:yearConfig.year,subjectGroup:file.subjectGroup,educationLevel:'本科',admissionCategory:'普通类',batch:'本科批',planType:'普通计划',unitType:'exact_major'},schools,verifiedAliases,rows:rawRows})
      const batchId=await persistAdmissionPreflight(connection,{sourceId,artifactId:artifact.id,preflight})
      const committed=await commitAdmissionPreflight(connection,batchId)
      fileReports.push({subjectGroup:file.subjectGroup,artifactSha256:artifact.sha256,...preflight.report,...committed,missingRanks:rawRows.filter(row=>!row.minRank).length})
    }
    const report={year:yearConfig.year,rankSourceUrl:yearConfig.rankSourceUrl,files:fileReports,raw:fileReports.reduce((sum,item)=>sum+item.raw,0),valid:fileReports.reduce((sum,item)=>sum+item.valid,0),unmatched:fileReports.reduce((sum,item)=>sum+item.unmatched,0),rejected:fileReports.reduce((sum,item)=>sum+item.rejected,0)}
    await writeFile(new URL(`../data/hebei-${yearConfig.year}-import-report.json`,import.meta.url),JSON.stringify(report,null,2),'utf8')
    console.log(JSON.stringify(report,null,2))
  }
}finally{await connection.end()}

function matchableSchoolName(raw:string,schoolNames:Set<string>,aliasNames:Set<string>){
  const candidates=[raw,raw.replace(/\[[^\]]+]/g,'').trim(),raw.replace(/\([^)]*市\)/g,'').replace(/\[[^\]]+]/g,'').trim()].map(value=>value.replaceAll('(','（').replaceAll(')','）'))
  return candidates.find(candidate=>schoolNames.has(candidate)||aliasNames.has(candidate))??candidates[1]!
}
function lookupRank(subjectGroup:SubjectGroup,score:number,rankRows:RankRow[],rankMaps:Record<SubjectGroup,Map<number,number>>){const exact=rankMaps[subjectGroup].get(score);if(exact)return exact;const key=subjectGroup==='物理类'?'physicsRank':'historyRank';return rankRows.find(row=>row.score<score&&row[key])?.[key]??undefined}
function cleanMajorName(value:string){return value.replace(/\s+/g,' ').trim().slice(0,220)}
function numberOrNull(value:unknown){const number=Number(value);return Number.isFinite(number)&&number>0?number:null}
