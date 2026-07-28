import 'dotenv/config'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import * as XLSX from 'xlsx'
import { config } from '../server/config.js'

const SOURCE_URL = 'https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/W020260618416094865984.xls'
const SOURCE_PAGE = 'https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/t20260618_1441074.html'
const SOURCE_YEAR = 2026

const provinceAliases: Record<string, string> = {
  北京市: '北京', 天津市: '天津', 上海市: '上海', 重庆市: '重庆',
  河北省: '河北', 山西省: '山西', 辽宁省: '辽宁', 吉林省: '吉林', 黑龙江省: '黑龙江',
  江苏省: '江苏', 浙江省: '浙江', 安徽省: '安徽', 福建省: '福建', 江西省: '江西',
  山东省: '山东', 河南省: '河南', 湖北省: '湖北', 湖南省: '湖南', 广东省: '广东',
  海南省: '海南', 四川省: '四川', 贵州省: '贵州', 云南省: '云南', 陕西省: '陕西',
  甘肃省: '甘肃', 青海省: '青海', 台湾省: '台湾',
  '内蒙古自治区': '内蒙古', '广西壮族自治区': '广西', '西藏自治区': '西藏',
  '宁夏回族自治区': '宁夏', '新疆维吾尔自治区': '新疆',
}

const project985 = new Set(`北京大学|清华大学|中国人民大学|北京航空航天大学|北京理工大学|中国农业大学|北京师范大学|中央民族大学|南开大学|天津大学|大连理工大学|东北大学|吉林大学|哈尔滨工业大学|复旦大学|同济大学|上海交通大学|华东师范大学|南京大学|东南大学|浙江大学|中国科学技术大学|厦门大学|山东大学|中国海洋大学|武汉大学|华中科技大学|湖南大学|中南大学|国防科技大学|中山大学|华南理工大学|四川大学|电子科技大学|重庆大学|西安交通大学|西北工业大学|西北农林科技大学|兰州大学`.split('|'))

const project211 = new Set(`北京交通大学|北京工业大学|北京科技大学|北京化工大学|北京邮电大学|北京林业大学|北京中医药大学|北京外国语大学|中国传媒大学|中央财经大学|对外经济贸易大学|北京体育大学|中央音乐学院|中国政法大学|华北电力大学|中国矿业大学（北京）|中国石油大学（北京）|中国地质大学（北京）|天津医科大学|河北工业大学|太原理工大学|内蒙古大学|辽宁大学|大连海事大学|延边大学|东北师范大学|哈尔滨工程大学|东北农业大学|东北林业大学|华东理工大学|东华大学|上海外国语大学|上海财经大学|上海大学|苏州大学|南京航空航天大学|南京理工大学|中国矿业大学|河海大学|江南大学|南京农业大学|中国药科大学|南京师范大学|安徽大学|合肥工业大学|福州大学|南昌大学|郑州大学|中国地质大学（武汉）|武汉理工大学|华中农业大学|华中师范大学|中南财经政法大学|湖南师范大学|暨南大学|华南师范大学|广西大学|海南大学|西南交通大学|四川农业大学|西南财经大学|西南大学|贵州大学|云南大学|西藏大学|西北大学|西安电子科技大学|长安大学|陕西师范大学|青海大学|宁夏大学|新疆大学|石河子大学`.split('|'))

type SchoolRow = { name: string; code: string; authority: string; city: string; educationLevel: string; remark: string; province: string }

const response = await fetch(SOURCE_URL,{signal:AbortSignal.timeout(30_000),redirect:'follow'})
if (!response.ok) throw new Error(`教育部名单下载失败：${response.status}`)
const sourceBytes=Buffer.from(await response.arrayBuffer())
if(sourceBytes.byteLength>30*1024*1024)throw new Error('教育部名单文件超过 30MB 安全上限')
const rawPath=resolve(`data/raw/moe/${SOURCE_YEAR}/schools.xls`)
await mkdir(resolve(`data/raw/moe/${SOURCE_YEAR}`),{recursive:true})
await writeFile(rawPath,sourceBytes,{flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error})
const workbook = XLSX.read(sourceBytes)
const sheet = workbook.Sheets[workbook.SheetNames[0]!]
const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })
const schools: SchoolRow[] = []
let currentProvince = ''

for (const row of rows) {
  if (row.length === 1 && typeof row[0] === 'string') {
    const provinceLabel = row[0].replace(/（.*$/, '').trim()
    currentProvince = provinceAliases[provinceLabel] ?? ''
    continue
  }
  if (typeof row[0] !== 'number' || !currentProvince) continue
  schools.push({
    name: String(row[1] ?? '').trim(),
    code: String(row[2] ?? '').trim(),
    authority: String(row[3] ?? '').trim(),
    city: String(row[4] ?? '').replace(/市$/, '').trim(),
    educationLevel: String(row[5] ?? '').trim(),
    remark: String(row[6] ?? '').trim(),
    province: currentProvince,
  })
}

const connection = await mysql.createConnection({
  host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME,
  user: config.DB_USER, password: config.DB_PASSWORD,
})
const batchId = randomUUID()

try {
  await connection.beginTransaction()
  const [sourceResult] = await connection.execute<mysql.ResultSetHeader>(
    `INSERT INTO data_sources (source_type, title, source_url, source_year, publisher, published_at)
     VALUES ('school_list', ?, ?, ?, '中华人民共和国教育部', '2026-06-18')
     ON DUPLICATE KEY UPDATE title = VALUES(title), publisher = VALUES(publisher), id = LAST_INSERT_ID(id)`,
    ['全国普通高等学校名单（截至2026年6月17日）', SOURCE_PAGE, SOURCE_YEAR],
  )
  const sourceId = sourceResult.insertId
  const artifactId=randomUUID()
  await connection.execute(
    `INSERT INTO source_artifacts(id,source_id,official_page_url,download_url,published_at,sha256,local_path,byte_size)
     VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [artifactId,sourceId,SOURCE_PAGE,SOURCE_URL,'2026-06-18',createHash('sha256').update(sourceBytes).digest('hex'),rawPath,sourceBytes.byteLength],
  )
  const [artifactRows]=await connection.execute<mysql.RowDataPacket[]>('SELECT id FROM source_artifacts WHERE source_id=? AND sha256=? LIMIT 1',[sourceId,createHash('sha256').update(sourceBytes).digest('hex')])
  await connection.execute(`INSERT INTO import_batches (id, source_id, artifact_id, status) VALUES (?, ?, ?, 'running')`, [batchId, sourceId,String(artifactRows[0]!.id)])

  const provinceIds = new Map<string, number>()
  for (const province of [...new Set(schools.map(school => school.province))]) {
    await connection.execute(`INSERT INTO provinces (name, exam_mode, max_score) VALUES (?, NULL, 750) ON DUPLICATE KEY UPDATE name = VALUES(name)`, [province])
    const [found] = await connection.execute<mysql.RowDataPacket[]>(`SELECT id FROM provinces WHERE name = ?`, [province])
    provinceIds.set(province, Number(found[0]!.id))
  }

  let inserted = 0
  for (const school of schools) {
    const provinceId = provinceIds.get(school.province)
    if (!provinceId) throw new Error(`未找到省份：${school.province}`)
    const level = project985.has(school.name) ? '985' : project211.has(school.name) ? '211' : school.educationLevel.includes('本科') ? '本科' : '专科'
    const features = JSON.stringify({ institutionCode: school.code, authority: school.authority, remark: school.remark, sourceYear: SOURCE_YEAR, tags: level === '985' ? ['985', '211'] : [level] })
    await connection.execute(
      `INSERT INTO schools (name, province_id, city, level, school_type, features)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE city = VALUES(city), level = VALUES(level), school_type = VALUES(school_type), features = VALUES(features)`,
      [school.name, provinceId, school.city, level, school.remark.includes('民办') ? '民办' : '公办', features],
    )
    const [schoolRows]=await connection.execute<mysql.RowDataPacket[]>('SELECT id FROM schools WHERE name=? LIMIT 1',[school.name])
    for(const factType of ['official_website','admissions_website','featured_major','admission_coverage']){
      await connection.execute(
        `INSERT IGNORE INTO school_fact_audits(school_id,fact_type,status,reason) VALUES (?,?,'pending','尚未完成逐项官方核验')`,
        [Number(schoolRows[0]!.id),factType],
      )
    }
    inserted += 1
  }

  await connection.execute(`UPDATE import_batches SET status = 'completed', inserted_count = ?, completed_at = NOW() WHERE id = ?`, [inserted, batchId])
  await connection.commit()
  console.log(`教育部全国普通高校导入完成：${inserted} 所。`)
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
