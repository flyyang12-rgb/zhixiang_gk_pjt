import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { config } from '../server/config.js'
import { commitAdmissionPreflight, persistAdmissionPreflight, preflightAdmissionRows, registerSourceArtifact, type RawAdmissionImportRow } from '../server/admission-import.js'

type OcrRow={schoolCode:string;schoolName:string;planType:string;group:string;requirement:string;enrollmentCount:number|null;score:number;rank:number;confidence:number;subjectGroup:'物理类'|'历史类';image:string}
type LegacyRow={schoolCode:string;schoolName:string;score:number;rank:number;subjectGroup:'文科'|'理科'}
const sourceUrls={物理类:'https://datacenter.haeea.cn/PagePZQuery/ShowPZTDTJ.aspx?yearTip=2025&pc=1&kl=5',历史类:'https://datacenter.haeea.cn/PagePZQuery/ShowPZTDTJ.aspx?yearTip=2025&pc=1&kl=1'} as const
const mirrorUrl='https://wap.zhengguannews.cn/html/zgh/381206.html'
const rowUrl=new URL('../data/henan-2025-ocr.json',import.meta.url),legacy2024Url=new URL('../data/henan-2024-legacy.json',import.meta.url),legacy2023Url=new URL('../data/henan-2023-verified-sample.json',import.meta.url)
const rowBytes=await readFile(rowUrl),legacy2024Bytes=await readFile(legacy2024Url),legacy2023Bytes=await readFile(legacy2023Url)
const rows=JSON.parse(rowBytes.toString('utf8')) as OcrRow[],legacy2024Rows=JSON.parse(legacy2024Bytes.toString('utf8')) as LegacyRow[],legacy2023Rows=JSON.parse(legacy2023Bytes.toString('utf8')) as LegacyRow[]

const connection=await mysql.createConnection({host:config.DB_HOST,port:config.DB_PORT,database:config.DB_NAME,user:config.DB_USER,password:config.DB_PASSWORD})
try{
  const [provinceRows]=await connection.query<mysql.RowDataPacket[]>(`SELECT id FROM provinces WHERE name='河南'`)
  const provinceId=Number(provinceRows[0]?.id)
  if(!provinceId)throw new Error('河南省份数据不存在，请先执行 npm run db:init')
  const [schoolRows]=await connection.query<mysql.RowDataPacket[]>(`SELECT id,name FROM schools`)
  const schools=schoolRows.map(row=>({id:Number(row.id),name:String(row.name)})),schoolByName=new Map(schools.map(school=>[school.name,school]))
  const [aliasRows]=await connection.query<mysql.RowDataPacket[]>(`SELECT alias,school_id schoolId FROM school_aliases WHERE verification_status='verified'`)
  const verifiedAliases=aliasRows.map(row=>({alias:String(row.alias),schoolId:Number(row.schoolId)})),aliasToSchool=new Map(verifiedAliases.map(alias=>[alias.alias,schools.find(school=>school.id===alias.schoolId)!]).filter((entry):entry is [string,{id:number;name:string}]=>Boolean(entry[1])))
  const codeMatches=new Map<string,{id:number;name:string}>()
  for(const row of rows){const match=schoolByName.get(cleanAnnotation(row.schoolName))??aliasToSchool.get(cleanAnnotation(row.schoolName));if(match&&row.schoolCode)codeMatches.set(row.schoolCode,match)}

  const reports2025=[]
  for(const subjectGroup of ['物理类','历史类'] as const){
    const subjectRows=rows.filter(row=>row.subjectGroup===subjectGroup)
    const [sourceResult]=await connection.execute<mysql.ResultSetHeader>(
      `INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,published_at) VALUES('admission',?,?,2025,?,'2025-07-19') ON DUPLICATE KEY UPDATE title=VALUES(title),publisher=VALUES(publisher),id=LAST_INSERT_ID(id)`,
      [`河南省2025年本科批${subjectGroup}投档统计（官方查询链接，镜像图片采集）`,sourceUrls[subjectGroup],`河南省教育考试院；采集镜像：${mirrorUrl}`],
    )
    const sourceId=sourceResult.insertId
    const artifact=await registerSourceArtifact(connection,{sourceId,officialPageUrl:sourceUrls[subjectGroup],mirrorUrl,mirrorDisclosure:'官方查询页对应的公开镜像图片经 OCR 识别；低于 0.75 置信度的行不得入库。',publishedAt:'2025-07-19',bytes:rowBytes,localPath:'data/henan-2025-ocr.json'})
    const rawRows:RawAdmissionImportRow[]=subjectRows.map(row=>{
      const matched=codeMatches.get(row.schoolCode),requirement=cleanRequirement(row.requirement),planType=derivePlanType(row.planType),admissionCategory=/艺术/.test(row.planType)?'艺术类':'普通类'
      return {schoolName:row.schoolName,matchSchoolName:matched?.name??cleanAnnotation(row.schoolName),validationError:row.confidence<.75?`OCR 置信度 ${row.confidence.toFixed(4)} 低于 0.75，须人工复核`:null,unitName:`${row.subjectGroup} 第${row.group}组${requirement?`（${requirement}）`:''}`,unitCode:row.group,subjectRequirement:requirement||null,schoolCode:row.schoolCode||null,majorCode:row.group,admissionCategory,planType,eligibilityRequirement:planType==='普通计划'?null:`${planType}须核验报考资格`,minScore:row.score,minRank:row.rank,enrollmentCount:row.enrollmentCount}
    })
    const preflight=preflightAdmissionRows({source:{provinceId,province:'河南',year:2025,subjectGroup,educationLevel:'本科',admissionCategory:'普通类',batch:'普通本科批',planType:'普通计划',unitType:'major_group'},schools,verifiedAliases,rows:rawRows})
    const batchId=await persistAdmissionPreflight(connection,{sourceId,artifactId:artifact.id,preflight}),committed=await commitAdmissionPreflight(connection,batchId)
    reports2025.push({subjectGroup,artifactSha256:artifact.sha256,...preflight.report,...committed,unmatchedRows:detailRows(subjectRows,preflight.rows,'unmatched'),rejectedRows:detailRows(subjectRows,preflight.rows,'rejected')})
  }

  const legacyReports=[]
  for(const legacyConfig of [
    {year:2023,rows:legacy2023Rows,bytes:legacy2023Bytes,localPath:'data/henan-2023-verified-sample.json',sourceUrl:'https://gaokao.haedu.cn/501/552/2023/0720/132328.html',title:'河南省2023年本科一批改革前文理科投档线（已核验重点院校样本）',publisher:'河南省教育考试院；位次核验：中国教育在线公开资料',publishedAt:'2023-07-20',disclosure:'当前文件仅为已核验重点院校样本，不代表完整本科一批。'},
    {year:2024,rows:legacy2024Rows,bytes:legacy2024Bytes,localPath:'data/henan-2024-legacy.json',sourceUrl:'https://www.zizzs.com/gk/gaokao/171098.html',title:'河南省2024年本科一批改革前文理科投档线（考试院数据公开镜像）',publisher:'河南省教育考试院；采集镜像：自主选拔在线',publishedAt:'2024-07-22',disclosure:'公开镜像明确标注河南省教育考试院投档数据，关键记录须回到考试院核验。'},
  ] as const){
    const [sourceResult]=await connection.execute<mysql.ResultSetHeader>(`INSERT INTO data_sources(source_type,title,source_url,source_year,publisher,published_at) VALUES('admission',?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),publisher=VALUES(publisher),published_at=VALUES(published_at),id=LAST_INSERT_ID(id)`,[legacyConfig.title,legacyConfig.sourceUrl,legacyConfig.year,legacyConfig.publisher,legacyConfig.publishedAt])
    const sourceId=sourceResult.insertId,artifact=await registerSourceArtifact(connection,{sourceId,officialPageUrl:legacyConfig.sourceUrl,mirrorUrl:legacyConfig.year===2024?legacyConfig.sourceUrl:null,mirrorDisclosure:legacyConfig.disclosure,publishedAt:legacyConfig.publishedAt,bytes:legacyConfig.bytes,localPath:legacyConfig.localPath})
    for(const subjectGroup of ['文科','理科'] as const){
      const subjectRows=legacyConfig.rows.filter(row=>row.subjectGroup===subjectGroup)
      const rawRows:RawAdmissionImportRow[]=subjectRows.map(row=>({schoolName:row.schoolName,matchSchoolName:cleanAnnotation(row.schoolName),unitName:`改革前${subjectGroup}本科一批院校投档线（不含专业）`,schoolCode:row.schoolCode||null,minScore:row.score,minRank:row.rank}))
      const preflight=preflightAdmissionRows({source:{provinceId,province:'河南',year:legacyConfig.year,subjectGroup,educationLevel:'本科',admissionCategory:'普通类',batch:'本科一批',planType:'普通计划',unitType:'school_line'},schools,verifiedAliases,rows:rawRows})
      const batchId=await persistAdmissionPreflight(connection,{sourceId,artifactId:artifact.id,preflight}),committed=await commitAdmissionPreflight(connection,batchId)
      legacyReports.push({year:legacyConfig.year,subjectGroup,artifactSha256:artifact.sha256,...preflight.report,...committed,unmatchedRows:detailRows(subjectRows,preflight.rows,'unmatched'),rejectedRows:detailRows(subjectRows,preflight.rows,'rejected')})
    }
  }
  const report2025={year:2025,mirrorUrl,officialUrls:sourceUrls,files:reports2025,raw:reports2025.reduce((sum,item)=>sum+item.raw,0),valid:reports2025.reduce((sum,item)=>sum+item.valid,0),unmatched:reports2025.reduce((sum,item)=>sum+item.unmatched,0),rejected:reports2025.reduce((sum,item)=>sum+item.rejected,0),verifiedGroupMajorMembers:0}
  await writeFile(new URL('../data/henan-2025-import-report.json',import.meta.url),JSON.stringify(report2025,null,2),'utf8')
  await writeFile(new URL('../data/henan-legacy-import-report.json',import.meta.url),JSON.stringify({warning:'2023—2024 为改革前文理科历史参考，不与 2025 物理/历史类混算；2023 当前仍为已核验样本。',years:legacyReports},null,2),'utf8')
  console.log(JSON.stringify({henan2025:report2025,legacy:legacyReports.map(({unmatchedRows,rejectedRows,...item})=>item)},null,2))
}finally{await connection.end()}

function cleanAnnotation(value:string){return value.replace(/[（(](?:较高收费|其他单列|特殊类|医护类|农林矿|中外合作办学)[）)]?/g,'').trim().replaceAll('(','（').replaceAll(')','）')}
function cleanRequirement(value:string){if(/不限/.test(value))return'不限';if(/化学.*生物|生物.*化学/.test(value))return'化学和生物';if(/化学/.test(value))return'化学';if(/政治/.test(value))return'政治';if(/地理/.test(value))return'地理';if(/生物/.test(value))return'生物';return value.trim().slice(0,20)}
function derivePlanType(value:string){if(/国家专项/.test(value))return'国家专项';if(/地方专项/.test(value))return'地方专项';if(/定向/.test(value))return'定向计划';if(/预科/.test(value))return'预科计划';if(/中外合作|合作项目/.test(value))return'中外合作办学';if(/艺术/.test(value))return'艺术计划';return'普通计划'}
function detailRows<T>(source:T[],rows:Array<{status:string;reason:string|null}>,status:string){return rows.flatMap((row,index)=>row.status===status?[{...source[index],reason:row.reason}]:[])}
