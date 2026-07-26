import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import * as XLSX from 'xlsx'
import { config } from '../server/config.js'

type School = { id: number; name: string; normalizedName: string }
type RankRow = { score: number; physicsRank: number | null; historyRank: number | null }
type SubjectGroup = '物理类' | '历史类'

const years = [
  {
    year: 2023,
    publishedAt: '2023-07-24',
    rankSourceUrl: 'https://file.hebeea.edu.cn/files/article/2023/06/20230624203549_178.pdf',
    files: [
      { subjectGroup: '历史类' as const, path: new URL('../data/raw/hebei/2023/history.xlsx', import.meta.url), sourceUrl: 'https://gaokao.eol.cn/he_bei/dongtai/202307/W020230725339662979910.xlsx', publisher: '中国教育在线（河北省教育考试院数据镜像）' },
      { subjectGroup: '物理类' as const, path: new URL('../data/raw/hebei/2023/physics.xlsx', import.meta.url), sourceUrl: 'https://gaokao.eol.cn/he_bei/dongtai/202307/W020230725339662993067.xlsx', publisher: '中国教育在线（河北省教育考试院数据镜像）' },
    ],
  },
  {
    year: 2024,
    publishedAt: '2024-07-22',
    rankSourceUrl: 'https://file.hebeea.edu.cn/files/article/2024/06/20240624195327_41.pdf',
    files: [
      { subjectGroup: '历史类' as const, path: new URL('../data/raw/hebei/2024/history.xlsx', import.meta.url), sourceUrl: 'https://file.hebeea.edu.cn/files/article/2024/07/20240722163024_223.xlsx', publisher: '河北省教育考试院' },
      { subjectGroup: '物理类' as const, path: new URL('../data/raw/hebei/2024/physics.xlsx', import.meta.url), sourceUrl: 'https://file.hebeea.edu.cn/files/article/2024/07/20240722163024_933.xlsx', publisher: '河北省教育考试院' },
    ],
  },
  {
    year: 2025,
    publishedAt: '2025-07-22',
    rankSourceUrl: 'https://file.hebeea.edu.cn/files/article/2025/06/20250624193800_658.pdf',
    files: [
      { subjectGroup: '历史类' as const, path: new URL('../data/raw/hebei/2025/history.xlsx', import.meta.url), sourceUrl: 'https://file.hebeea.edu.cn/files/article/2025/07/20250722214851_332.xlsx', publisher: '河北省教育考试院' },
      { subjectGroup: '物理类' as const, path: new URL('../data/raw/hebei/2025/physics.xlsx', import.meta.url), sourceUrl: 'https://file.hebeea.edu.cn/files/article/2025/07/20250722214852_210.xlsx', publisher: '河北省教育考试院' },
    ],
  },
] as const

const connection = await mysql.createConnection({ host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME, user: config.DB_USER, password: config.DB_PASSWORD })

try {
  const [provinceRows] = await connection.query<mysql.RowDataPacket[]>(`SELECT id FROM provinces WHERE name='河北'`)
  const provinceId = Number(provinceRows[0]?.id)
  if (!provinceId) throw new Error('河北省份数据不存在，请先执行 npm run db:init')
  const [schoolRows] = await connection.query<mysql.RowDataPacket[]>('SELECT id,name FROM schools')
  const schools: School[] = schoolRows.map(row => ({ id: Number(row.id), name: String(row.name), normalizedName: normalize(String(row.name)) }))
  const exactSchools = new Map(schools.map(school => [school.normalizedName, school]))

  for (const yearConfig of years) {
    const rankRows = JSON.parse(await readFile(new URL(`../data/hebei-${yearConfig.year}-ranks.json`, import.meta.url), 'utf8')) as RankRow[]
    const rankMaps = {
      历史类: new Map(rankRows.filter(row => row.historyRank).map(row => [row.score, Number(row.historyRank)])),
      物理类: new Map(rankRows.filter(row => row.physicsRank).map(row => [row.score, Number(row.physicsRank)])),
    }
    const schoolCache = new Map<string, School | null>()
    const prepared: Array<Array<string | number | null>> = []
    const unmatched: Array<{ subjectGroup: string; schoolName: string; majorName: string; score: number }> = []
    const missingRanks: Array<{ subjectGroup: string; schoolName: string; majorName: string; score: number }> = []
    await connection.beginTransaction()
    for (const file of yearConfig.files) {
      const workbook = XLSX.read(await readFile(file.path))
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1, blankrows: false }).slice(5)
      const [sourceResult] = await connection.execute<mysql.ResultSetHeader>(
        `INSERT INTO data_sources (source_type,title,source_url,source_year,publisher,published_at)
         VALUES ('admission',?,?,?,?,?)
         ON DUPLICATE KEY UPDATE title=VALUES(title),publisher=VALUES(publisher),published_at=VALUES(published_at),id=LAST_INSERT_ID(id)`,
        [`河北省${yearConfig.year}年本科批${file.subjectGroup}平行志愿投档情况（位次映射：${yearConfig.rankSourceUrl}）`, file.sourceUrl, yearConfig.year, file.publisher, yearConfig.publishedAt],
      )
      for (const row of rows) {
        const schoolCode = String(row[0] ?? '').trim()
        const rawSchoolName = String(row[1] ?? '').trim()
        const majorCode = String(row[2] ?? '').trim()
        const rawMajorName = String(row[3] ?? '').trim()
        const minScore = Number(row[4])
        if (!rawSchoolName || !rawMajorName || !Number.isFinite(minScore) || minScore <= 0) continue
        const minRank = lookupRank(file.subjectGroup, minScore, rankRows, rankMaps)
        if (!minRank) { missingRanks.push({ subjectGroup: file.subjectGroup, schoolName: rawSchoolName, majorName: rawMajorName, score: minScore }); continue }
        const normalizedName = normalize(rawSchoolName)
        let school = schoolCache.get(normalizedName)
        if (!schoolCache.has(normalizedName)) {
          school = findSchool(rawSchoolName, schools, exactSchools)
          schoolCache.set(normalizedName, school ?? null)
        }
        if (!school) { unmatched.push({ subjectGroup: file.subjectGroup, schoolName: rawSchoolName, majorName: rawMajorName, score: minScore }); continue }
        const majorName = `${file.subjectGroup} ${cleanMajorName(rawMajorName)}`
        prepared.push([school.id, provinceId, yearConfig.year, file.subjectGroup, majorName, schoolCode || null, majorCode || null, minScore, minRank, sourceResult.insertId])
      }
    }
    for (let offset = 0; offset < prepared.length; offset += 500) {
      const batch = prepared.slice(offset, offset + 500)
      const placeholders = batch.map(() => "(?,?,?,?,'exact_major',?,?,?,?,?,?)").join(',')
      await connection.query(
        `INSERT INTO admission_programs (school_id,province_id,year,subject_group,unit_type,major_name,school_code,major_code,min_score,min_rank,source_id)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE unit_type=VALUES(unit_type),min_score=VALUES(min_score),min_rank=VALUES(min_rank),source_id=VALUES(source_id)`,
        batch.flat(),
      )
    }
    await connection.commit()
    const report = { year: yearConfig.year, imported: prepared.length, unmatched: unmatched.length, missingRanks: missingRanks.length, unmatchedRows: unmatched, missingRankRows: missingRanks, rankSourceUrl: yearConfig.rankSourceUrl }
    await writeFile(new URL(`../data/hebei-${yearConfig.year}-import-report.json`, import.meta.url), JSON.stringify(report, null, 2), 'utf8')
    console.log(`河北 ${yearConfig.year} 投档专业导入 ${prepared.length} 条，未匹配院校 ${unmatched.length} 条，缺少位次 ${missingRanks.length} 条。`)
  }
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}

function normalize(value: string) {
  const normalized = value.replace(/[（(](北京|华东)[）)]/g, '$1').replace(/[（(].*?[）)]/g, '').replace(/\[.*?]/g, '').replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
  const aliases: Record<string, string> = {
    北京大学医学部: '北京大学', 复旦大学医学院: '复旦大学', 上海交通大学医学院: '上海交通大学', 浙江大学医学院: '浙江大学',
    东北大学秦皇岛分校: '东北大学', 中国石油大学北京克拉玛依校区: '中国石油大学北京',
  }
  return aliases[normalized] ?? normalized.replace(/分校|校区$/, '')
}
function lookupRank(subjectGroup: SubjectGroup, score: number, rankRows: RankRow[], rankMaps: Record<SubjectGroup, Map<number, number>>) {
  const exact = rankMaps[subjectGroup].get(score)
  if (exact) return exact
  const key = subjectGroup === '物理类' ? 'physicsRank' : 'historyRank'
  return rankRows.find(row => row.score < score && row[key])?.[key] ?? undefined
}
function cleanMajorName(value: string) { return value.replace(/\s+/g, ' ').trim().slice(0, 220) }
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
function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) current[rightIndex] = Math.min(current[rightIndex - 1]! + 1, previous[rightIndex]! + 1, previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1))
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]!
}
