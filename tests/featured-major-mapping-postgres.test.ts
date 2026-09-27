import { Client } from 'pg'
import { expect, it } from 'vitest'
import { findFeaturedMajorMatches } from '../scripts/featured-major-mapping.js'
import type { DatabaseConnection } from '../server/database.js'

const testUrl = process.env.EXPLORATION_TEST_DATABASE_URL
it.skipIf(!testUrl)('独立 PostgreSQL：优势专业无代码、代码匹配、未映射与歧义', async () => {
  const url = new URL(testUrl!)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/zhixiang_exploration_test(?:_[a-z0-9]+)?$/.test(url.pathname)) {
    throw new Error('仅允许显式本机探索测试库')
  }
  const client = new Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 })
  const db: Pick<DatabaseConnection, 'query'> = { query: async <T>(sql: string, values?: readonly unknown[]) => {
    let index = 0
    const result = await client.query(sql.replace(/\?/g, () => `$${++index}`), values ? [...values] : [])
    return [result.rows as T, result]
  } }
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE TEMP TABLE majors (id integer, code text, name text) ON COMMIT DROP')
    await client.query("INSERT INTO majors VALUES (1,'TEST-1','合成甲专业'),(2,'TEST-2','合成乙专业')")
    expect(await findFeaturedMajorMatches(db, null, '合成甲专业')).toEqual([{ id: 1, code: 'TEST-1', name: '合成甲专业' }])
    expect(await findFeaturedMajorMatches(db, 'TEST-2', '官方名称变体')).toEqual([{ id: 2, code: 'TEST-2', name: '合成乙专业' }])
    expect(await findFeaturedMajorMatches(db, null, '未映射专业')).toEqual([])
    expect(await findFeaturedMajorMatches(db, 'TEST-1', '合成乙专业')).toHaveLength(2)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    await client.end()
  }
})
