import 'dotenv/config'
import mysql from 'mysql2/promise'
import * as XLSX from 'xlsx'
import { config } from '../server/config.js'

const sources = [
  {
    year: 2023,
    publishedAt: '2023-07-19',
    page: 'https://www.sdzk.cn/NewsInfo.aspx?NewsID=6279',
    file: 'https://www.sdzk.cn/Floadup/file/20230719/6382538122655052185031609.xls',
  },
  {
    year: 2024,
    publishedAt: '2024-07-19',
    page: 'https://www.sdzk.cn/NewsInfo.aspx?NewsID=6656',
    file: 'https://www.sdzk.cn/Floadup/file/20240719/6385700532268895241675882.xls',
  },
  {
    year: 2025,
    publishedAt: '2025-07-19',
    page: 'https://www.sdzk.cn/NewsInfo.aspx?BCID=20&CID=1204&NewsID=6996',
    file: 'https://www.sdzk.cn/Floadup/file/20250719/6388855130412530367357143.xls',
  },
] as const

const connection = await mysql.createConnection({ host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME, user: config.DB_USER, password: config.DB_PASSWORD })
try {
  await connection.beginTransaction()
  const [provinceRows] = await connection.query<mysql.RowDataPacket[]>(`SELECT id FROM provinces WHERE name = '山东'`)
  const provinceId = Number(provinceRows[0]?.id)
  if (!provinceId) throw new Error('山东省份数据不存在，请先导入全国高校')

  for (const source of sources) {
    const response = await fetch(source.file)
    if (!response.ok) throw new Error(`山东 ${source.year} 投档表下载失败：${response.status}`)
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()))
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1, blankrows: false }).slice(2)
    const [sourceResult] = await connection.execute<mysql.ResultSetHeader>(
      `INSERT INTO data_sources (source_type, title, source_url, source_year, publisher, published_at)
       VALUES ('admission', ?, ?, ?, '山东省教育招生考试院', ?)
       ON DUPLICATE KEY UPDATE title=VALUES(title), publisher=VALUES(publisher), published_at=VALUES(published_at), id=LAST_INSERT_ID(id)`,
      [`山东省${source.year}年普通类常规批第1次志愿投档情况表`, source.page, source.year, source.publishedAt],
    )
    let imported = 0
    let unmatched = 0
    for (const row of rows) {
      const majorRaw = String(row[0] ?? '').trim()
      const schoolRaw = String(row[1] ?? '').trim()
      const minRank = Number(row[3])
      if (!majorRaw || !schoolRaw || !Number.isFinite(minRank)) continue
      const schoolCode = schoolRaw.slice(0, 4)
      const schoolName = schoolRaw.slice(4).replace(/\(.*?校区\)$/g, '').trim()
      const majorCode = majorRaw.slice(0, 2)
      const majorName = majorRaw.slice(2).trim()
      const [schoolRows] = await connection.execute<mysql.RowDataPacket[]>(`SELECT id FROM schools WHERE name = ? LIMIT 1`, [schoolName])
      const schoolId = Number(schoolRows[0]?.id)
      if (!schoolId) { unmatched += 1; continue }
      await connection.execute(
        `INSERT INTO admission_programs (school_id, province_id, year, subject_group, unit_type, major_name, school_code, major_code, min_rank, enrollment_count, source_id)
         VALUES (?, ?, ?, '综合改革', 'exact_major', ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE unit_type=VALUES(unit_type),min_rank=VALUES(min_rank), enrollment_count=VALUES(enrollment_count), source_id=VALUES(source_id)`,
        [schoolId, provinceId, source.year, majorName, schoolCode, majorCode, minRank, Number(row[2]) || null, sourceResult.insertId],
      )
      imported += 1
    }
    console.log(`山东 ${source.year} 投档专业导入 ${imported} 条，未匹配院校 ${unmatched} 条。`)
  }
  await connection.commit()
} catch (error) { await connection.rollback(); throw error } finally { await connection.end() }
