import { Client } from 'pg'
import { expect, it } from 'vitest'
import { loadRecommendationAvailability } from '../server/recommendation-data.js'
import type { DatabaseConnection } from '../server/database.js'

const testUrl = process.env.EXPLORATION_TEST_DATABASE_URL
it.skipIf(!testUrl)('独立 PostgreSQL：推荐生成的年份聚合、资格隔离和无资料', async () => {
  const url = new URL(testUrl!)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/zhixiang_exploration_test(?:_[a-z0-9]+)?$/.test(url.pathname)) {
    throw new Error('仅允许显式本机探索测试库')
  }
  const client = new Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 })
  const db: Pick<DatabaseConnection, 'execute'> = { execute: async <T>(sql: string, values?: readonly unknown[]) => {
    let index = 0
    const result = await client.query(sql.replace(/\?/g, () => `$${++index}`), values ? [...values] : [])
    return [result.rows as T, result]
  } }
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE TEMP TABLE provinces (id integer,name text) ON COMMIT DROP')
    await client.query('CREATE TEMP TABLE admission_programs (province_id integer,year integer,subject_group text,recommendation_eligible integer,min_rank integer) ON COMMIT DROP')
    await client.query("INSERT INTO provinces VALUES (1,'合成省份'),(2,'另一省份')")
    await client.query(`INSERT INTO admission_programs VALUES
      (1,2024,'物理类',1,10000),(1,2025,'物理类',1,11000),
      (1,2026,'物理类',0,12000),(1,2026,'物理类',1,NULL),
      (1,2026,'历史类',1,13000),(2,2026,'物理类',1,14000)`)
    const [available] = await loadRecommendationAvailability(db, '合成省份', '物理类')
    expect(Number(available!.count)).toBe(2)
    expect(Number(available!.yearCount)).toBe(2)
    expect(available).toMatchObject({year:2025,years:'2024,2025'})
    const [empty] = await loadRecommendationAvailability(db, '无资料省份', '物理类')
    expect(Number(empty!.count)).toBe(0)
    expect(empty!.year).toBeNull()
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  }
})
