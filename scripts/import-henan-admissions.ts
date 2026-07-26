import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { config } from '../server/config.js'

type OcrRow = {
  schoolCode: string
  schoolName: string
  planType: string
  group: string
  requirement: string
  enrollmentCount: number | null
  score: number
  rank: number
  confidence: number
  subjectGroup: '物理类' | '历史类'
  image: string
}

type School = { id: number; name: string; normalizedName: string }
type LegacyRow = { schoolCode: string; schoolName: string; score: number; rank: number; subjectGroup: '文科' | '理科' }

const sourceUrls = {
  物理类: 'https://datacenter.haeea.cn/PagePZQuery/ShowPZTDTJ.aspx?yearTip=2025&pc=1&kl=5',
  历史类: 'https://datacenter.haeea.cn/PagePZQuery/ShowPZTDTJ.aspx?yearTip=2025&pc=1&kl=1',
} as const
const mirrorUrl = 'https://wap.zhengguannews.cn/html/zgh/381206.html'
const rows = JSON.parse(await readFile(new URL('../data/henan-2025-ocr.json', import.meta.url), 'utf8')) as OcrRow[]
const legacy2024Rows = JSON.parse(await readFile(new URL('../data/henan-2024-legacy.json', import.meta.url), 'utf8')) as LegacyRow[]
const legacy2023Rows = JSON.parse(await readFile(new URL('../data/henan-2023-verified-sample.json', import.meta.url), 'utf8')) as LegacyRow[]
const connection = await mysql.createConnection({ host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME, user: config.DB_USER, password: config.DB_PASSWORD })

try {
  const [provinceRows] = await connection.query<mysql.RowDataPacket[]>(`SELECT id FROM provinces WHERE name='河南'`)
  const provinceId = Number(provinceRows[0]?.id)
  if (!provinceId) throw new Error('河南省份数据不存在，请先执行 npm run db:init')
  const [schoolRows] = await connection.query<mysql.RowDataPacket[]>('SELECT id,name FROM schools')
  const schools: School[] = schoolRows.map(row => ({ id: Number(row.id), name: String(row.name), normalizedName: normalize(String(row.name)) }))
  const exactSchools = new Map(schools.map(school => [school.normalizedName, school]))
  const codeMatches = new Map<string, School>()
  for (const row of rows) {
    const exact = exactSchools.get(normalize(row.schoolName))
    if (exact && row.schoolCode) codeMatches.set(row.schoolCode, exact)
  }

  await connection.beginTransaction()
  const sourceIds = new Map<OcrRow['subjectGroup'], number>()
  for (const subjectGroup of ['物理类', '历史类'] as const) {
    if (!rows.some(row => row.subjectGroup === subjectGroup)) continue
    const [result] = await connection.execute<mysql.ResultSetHeader>(
      `INSERT INTO data_sources (source_type,title,source_url,source_year,publisher,published_at)
       VALUES ('admission',?,?,2025,?,'2025-07-19')
       ON DUPLICATE KEY UPDATE title=VALUES(title),publisher=VALUES(publisher),id=LAST_INSERT_ID(id)`,
      [`河南省2025年本科批${subjectGroup}投档统计（官方查询链接，镜像图片采集）`, sourceUrls[subjectGroup], `河南省教育考试院；采集镜像：${mirrorUrl}`],
    )
    sourceIds.set(subjectGroup, result.insertId)
  }

  let imported = 0
  const unmatched: OcrRow[] = []
  for (const row of rows) {
    const school = codeMatches.get(row.schoolCode) ?? findSchool(row.schoolName, schools, exactSchools)
    if (!school) { unmatched.push(row); continue }
    if (row.schoolCode) codeMatches.set(row.schoolCode, school)
    const requirement = cleanRequirement(row.requirement)
    const groupName = `${row.subjectGroup} 第${row.group}组${requirement ? `（${requirement}）` : ''}`
    await connection.execute(
      `INSERT INTO admission_programs
       (school_id,province_id,year,subject_group,unit_type,major_name,unit_code,subject_requirement,school_code,major_code,min_score,min_rank,enrollment_count,source_id)
       VALUES (?,?,2025,?,'major_group',?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE unit_type=VALUES(unit_type),unit_code=VALUES(unit_code),subject_requirement=VALUES(subject_requirement),min_score=VALUES(min_score),min_rank=VALUES(min_rank),enrollment_count=VALUES(enrollment_count),source_id=VALUES(source_id)`,
      [school.id, provinceId, row.subjectGroup, groupName, row.group, requirement || null, row.schoolCode || null, row.group, row.score, row.rank, row.enrollmentCount ?? null, sourceIds.get(row.subjectGroup) ?? null],
    )
    imported += 1
  }
  const legacyReports = []
  await connection.execute(
    `DELETE FROM admission_programs WHERE province_id=? AND year IN (2023,2024) AND major_name='改革前本科一批院校投档线（不含专业）'`,
    [provinceId],
  )
  for (const legacyConfig of [
    { year: 2023, rows: legacy2023Rows, sourceUrl: 'https://gaokao.haedu.cn/501/552/2023/0720/132328.html', title: '河南省2023年本科一批改革前文理科投档线（已核验重点院校样本）', publisher: '河南省教育考试院；位次核验：中国教育在线公开资料', publishedAt: '2023-07-20' },
    { year: 2024, rows: legacy2024Rows, sourceUrl: 'https://www.zizzs.com/gk/gaokao/171098.html', title: '河南省2024年本科一批改革前文理科投档线（考试院数据公开镜像）', publisher: '河南省教育考试院；采集镜像：自主选拔在线', publishedAt: '2024-07-22' },
  ] as const) {
    const [sourceResult] = await connection.execute<mysql.ResultSetHeader>(
      `INSERT INTO data_sources (source_type,title,source_url,source_year,publisher,published_at)
       VALUES ('admission',?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title=VALUES(title),publisher=VALUES(publisher),published_at=VALUES(published_at),id=LAST_INSERT_ID(id)`,
      [legacyConfig.title, legacyConfig.sourceUrl, legacyConfig.year, legacyConfig.publisher, legacyConfig.publishedAt],
    )
    let legacyImported = 0
    const legacyUnmatched: LegacyRow[] = []
    for (const row of legacyConfig.rows) {
      const school = findSchool(row.schoolName, schools, exactSchools)
      if (!school) { legacyUnmatched.push(row); continue }
      await connection.execute(
        `INSERT INTO admission_programs
         (school_id,province_id,year,subject_group,unit_type,major_name,school_code,min_score,min_rank,source_id)
         VALUES (?,?,?,?,'school_line',?,?,?,?,?)
         ON DUPLICATE KEY UPDATE unit_type=VALUES(unit_type),min_score=VALUES(min_score),min_rank=VALUES(min_rank),source_id=VALUES(source_id)`,
        [school.id, provinceId, legacyConfig.year, row.subjectGroup, `改革前${row.subjectGroup}本科一批院校投档线（不含专业）`, row.schoolCode || null, row.score, row.rank, sourceResult.insertId],
      )
      legacyImported += 1
    }
    legacyReports.push({ year: legacyConfig.year, imported: legacyImported, unmatched: legacyUnmatched.length, total: legacyConfig.rows.length, unmatchedRows: legacyUnmatched })
    console.log(`河南 ${legacyConfig.year} 改革前投档数据导入 ${legacyImported} 条，未匹配院校 ${legacyUnmatched.length} 条。`)
  }
  await connection.commit()
  const report = { majorGroupRecords: imported, verifiedGroupMajorMembers: 0, unmatchedMajorMembers: 0, missingSourceRecords: rows.filter(row => !sourceIds.get(row.subjectGroup)).length, unmatchedSchools: unmatched.length, total: rows.length, mirrorUrl, officialUrls: sourceUrls, unmatchedRows: unmatched }
  await writeFile(new URL('../data/henan-2025-import-report.json', import.meta.url), JSON.stringify(report, null, 2), 'utf8')
  await writeFile(new URL('../data/henan-legacy-import-report.json', import.meta.url), JSON.stringify({ warning: '2023-2024 为改革前文理科历史参考，不与 2025 物理/历史类直接平均。2023 仅为已核验重点院校样本。', years: legacyReports }, null, 2), 'utf8')
  console.log(`河南 2025 投档专业组导入 ${imported} 条，未匹配院校 ${unmatched.length} 条。`)
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}

function normalize(value: string) {
  const normalized = value.replace(/[（(].*?[）)]?/g, '').replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '').replace(/人学/g, '大学').replace(/入民/g, '人民').replace(/复贝/g, '复旦').replace(/单庆/g, '重庆').replace(/天洋/g, '天津')
  const aliases: Record<string, string> = {
    北京大学医学部: '北京大学', 复旦大学医学院: '复旦大学', 上海交通大学医学院: '上海交通大学',
    浙江大学医学院: '浙江大学', 中国人民大学苏州校区: '中国人民大学', 电子科技大学沙河校区: '电子科技大学',
  }
  return aliases[normalized] ?? normalized.replace(/苏州校区|沙河校区$/, '')
}

function findSchool(rawName: string, schools: School[], exactSchools: Map<string, School>) {
  const name = normalize(rawName)
  const exact = exactSchools.get(name)
  if (exact) return exact
  let best: School | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const school of schools) {
    const distance = levenshtein(name, school.normalizedName)
    if (distance < bestDistance) { best = school; bestDistance = distance }
  }
  return bestDistance <= 2 ? best : undefined
}

function cleanRequirement(value: string) {
  if (/不限/.test(value)) return '不限'
  if (/化学.*生物|生物.*化学/.test(value)) return '化学和生物'
  if (/化学/.test(value)) return '化学'
  return value.trim().slice(0, 20)
}

function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]!
}
