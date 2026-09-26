import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Client } from 'pg'
import { commitLearningImport, LearningImportError, preflightLearningImport, prepareLearningImport } from '../server/learning-evidence-import.js'

async function run() {
  const args = process.argv.slice(2)
  const input = args.shift()
  if (!input || input.startsWith('--')) throw new LearningImportError('用法：data:learning-evidence -- <清单 JSON> --sha256 <输入 SHA-256> [--commit] [--previous-sha256 <原输入 SHA-256>]')
  let expectedSha256: string | undefined, previousSha256: string | undefined, commit = false
  while (args.length) {
    const arg = args.shift()
    if (arg === '--commit' && !commit) commit = true
    else if (arg === '--sha256' && !expectedSha256) expectedSha256 = args.shift()
    else if (arg === '--previous-sha256' && !previousSha256) previousSha256 = args.shift()
    else throw new LearningImportError('参数无效或重复；仅支持 --sha256、--commit 和 --previous-sha256')
  }
  if (!expectedSha256) throw new LearningImportError('必须明确提供输入文件 SHA-256')
  const connectionString = process.env.LEARNING_IMPORT_DATABASE_URL
  if (!connectionString) throw new LearningImportError('必须通过私密环境配置明确指定 LEARNING_IMPORT_DATABASE_URL；不读取 .env 或应用默认数据库')
  const inputPath = resolve(input)
  let bytes: Buffer
  try {
    const metadata = await stat(inputPath)
    if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) throw new LearningImportError('输入文件必须为不超过 2MB 的 JSON 文件')
    bytes = await readFile(inputPath)
  } catch (error) {
    if (error instanceof LearningImportError) throw error
    throw new LearningImportError('输入文件无法只读访问')
  }
  const prepared = await prepareLearningImport(bytes, expectedSha256, { baseDirectory: dirname(inputPath), previousSha256 })
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 30000, statement_timeout: 30000 })
  try {
    await client.connect()
    const preflight = await preflightLearningImport(client, prepared)
    const result = commit && !preflight.batchErrors.length && !preflight.sourceErrors.length && !preflight.report.missing && !preflight.report.anomalous
      ? await commitLearningImport(client, prepared) : preflight
    console.log(JSON.stringify({ batchId: result.batchId, payloadSha256: result.payloadSha256, mode: result.mode, status: result.status,
      report: result.report, batchErrors: result.batchErrors, sourceErrors: result.sourceErrors, coverage: result.coverage,
      rows: result.rows.map(row => ({ rowNumber: row.rowNumber, factKey: row.factKey, status: row.status, reason: row.reason,
        evidenceId: result.mode === 'committed' ? row.evidence?.id ?? null : null,
        artifactId: result.mode === 'committed' ? row.evidence?.source.artifactId ?? null : null })) }, null, 2))
    if (result.batchErrors.length || result.sourceErrors.length || result.report.missing || result.report.anomalous) process.exitCode = 1
  } finally { await client.end() }
}

run().catch(error => {
  console.error(error instanceof LearningImportError ? error.message : '学习证据导入未完成；请核对数据库连接、权限和输入，不会输出连接串或内部错误')
  process.exitCode = 1
})
