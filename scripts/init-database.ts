import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { database } from '../server/database.js'

try {
  const schema=await readFile(new URL('../database/schema.sql',import.meta.url),'utf8')
  const employmentSeed=await readFile(new URL('../database/employment-seed.sql',import.meta.url),'utf8')
  await database.raw(schema)
  await database.raw(employmentSeed)
  console.log('知向 PostgreSQL 数据库初始化完成。')
} finally {
  await database.end()
}
