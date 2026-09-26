import { Client } from 'pg'
import { LearningImportError, withdrawLearningBatch } from '../server/learning-evidence-import.js'

async function run() {
  const args = process.argv.slice(2)
  const [batchId, flag, reason] = args
  if (args.length !== 3 || !batchId || flag !== '--reason' || !reason) throw new LearningImportError('用法：data:learning-evidence:withdraw -- <准确批次 UUID> --reason <撤回理由>')
  const connectionString = process.env.LEARNING_IMPORT_DATABASE_URL
  if (!connectionString) throw new LearningImportError('必须通过私密环境配置明确指定 LEARNING_IMPORT_DATABASE_URL；不读取 .env 或应用默认数据库')
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 30000, statement_timeout: 30000 })
  try {
    await client.connect()
    console.log(JSON.stringify(await withdrawLearningBatch(client, batchId, reason), null, 2))
  } finally { await client.end() }
}
run().catch(error => {
  console.error(error instanceof LearningImportError ? error.message : '学习证据撤回未完成；请核对数据库连接和权限，不会输出连接串或内部错误')
  process.exitCode = 1
})
