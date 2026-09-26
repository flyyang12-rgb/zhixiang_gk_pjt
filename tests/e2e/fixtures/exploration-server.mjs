import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { Client } from 'pg'
import { createServer } from 'node:http'

// This fixture never reads .env or adopts an existing application server.
const baseUrl = new URL(process.env.EXPLORATION_UI_TEST_DATABASE_URL ?? '')
assert(['127.0.0.1', 'localhost'].includes(baseUrl.hostname), '必须显式指定本机独立测试库')
assert.equal(baseUrl.pathname, '/zhixiang_exploration_test')
const runId = process.env.EXPLORATION_UI_RUN_ID
assert.match(runId ?? '', /^[a-f0-9-]{36}$/)
const databaseName = `zhixiang_exploration_test_ui_${runId.replaceAll('-', '')}`
assert.match(databaseName, /^zhixiang_exploration_test_ui_[a-f0-9]{32}$/)
const runtimePath = '.scratch/exploration-first/ui-test-runtime.json'
const emptyEnvPath = '.scratch/exploration-first/ui-test-empty.env'
const admin = new Client({ connectionString: baseUrl.toString() })
let created = false, setup, server, database
async function cleanup() {
  if (server) await new Promise(resolve => server.close(resolve))
  if (database) await database.end()
  if (setup) await setup.end()
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`)
  await admin.end()
  try {
    const runtime = JSON.parse(await readFile(runtimePath, 'utf8'))
    if (runtime.runId === runId) await unlink(runtimePath)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
try {
  await admin.connect()
  await admin.query(`CREATE DATABASE "${databaseName}"`)
  created = true
  const isolatedUrl = new URL(baseUrl); isolatedUrl.pathname = `/${databaseName}`
  setup = new Client({ connectionString: isolatedUrl.toString() }); await setup.connect()
  await setup.query(await readFile('database/schema.sql', 'utf8'))
  await setup.query(await readFile('database/employment-seed.sql', 'utf8'))
  await setup.query(`INSERT INTO job_sources(name,source_type,base_url,collection_policy,status,last_success_at)
    VALUES ('合成过期来源A','official','https://example.edu/test-jobs-a','仅供本次隔离测试，无外部抓取','healthy',NOW()-INTERVAL '10 days'),
           ('合成过期来源B','official','https://example.edu/test-jobs-b','仅供本次隔离测试，无外部抓取','healthy',NOW()-INTERVAL '10 days')`)
  const provinceId = (await setup.query("SELECT id FROM provinces WHERE name='河南'")).rows[0].id
  const schoolId = Number((await setup.query("INSERT INTO schools(name,province_id,city,level) VALUES ('合成探索学院',$1,'合成城市','本科') RETURNING id", [provinceId])).rows[0].id)
  const secondSchoolId = Number((await setup.query("INSERT INTO schools(name,province_id,city,level) VALUES ('合成比较学院',$1,'合成比较城市','本科') RETURNING id", [provinceId])).rows[0].id)
  const directionId = Number((await setup.query("SELECT id FROM job_directions WHERE code='software_dev'")).rows[0].id)
  const sourceId = (await setup.query("INSERT INTO data_sources(source_type,title,source_url,source_year,publisher) VALUES ('major','合成培养材料','https://example.edu/test-plan#courses',2025,'合成探索学院') RETURNING id")).rows[0].id
  const artifactId = randomUUID()
  await setup.query("INSERT INTO source_artifacts(id,source_id,official_page_url,sha256,local_path,byte_size) VALUES ($1,$2,'https://example.edu/test-plan#courses',$3,'tests/synthetic-plan.txt',10)", [artifactId, sourceId, 'a'.repeat(64)])
  const majors = []
  for (let index = 1; index <= 12; index++) {
    const suffix = String(index).padStart(2, '0')
    const majorId = Number((await setup.query("INSERT INTO majors(code,name,category) VALUES ($1,$2,'合成测试类别') RETURNING id", [`9900${suffix}`, `合成专业${suffix}`])).rows[0].id)
    await setup.query("INSERT INTO major_job_directions(major_id,job_direction_id,priority,review_status) VALUES ($1,$2,1,'approved')", [majorId, directionId])
    const batchId = randomUUID()
    await setup.query("INSERT INTO learning_content_batches(id,payload_sha256,status,activated_at) VALUES ($1,$2,'active',NOW())", [batchId, 'b'.repeat(64)])
    const facts = [['curriculum', `合成课程${suffix}：数据与系统`], ['learning_activity', `合成实践${suffix}：课程设计`], ['career_direction', `合成职业方向${suffix}：软件设计培养目标`]]
    if (index === 1) facts.push(['learning_prerequisite', '合成学习准备：大学课程需要数学基础'], ['admission_requirement', '合成学校的招生选科条件'])
    for (const [kind, content] of facts) {
      const admission = kind === 'admission_requirement'
      await setup.query(`INSERT INTO major_learning_evidence(id,batch_id,fact_key,major_id,artifact_id,kind,content,publisher_type,locator_kind,locator_value,scope_level,school_id,job_direction_id,province,subject_group,admission_year,condition,review_status,reviewer,reviewed_at,review_conclusion,review_reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'university','section','合成章节 > 培养安排','school',$8,$9,$10,$11,$12,$13,'verified','合成测试审核人',NOW(),'verified','仅用于隔离测试，不是正式事实')`,
        [randomUUID(), batchId, `${suffix}-${kind}`, majorId, artifactId, kind, content, schoolId, kind === 'career_direction' ? directionId : null,
          admission ? '河南' : null, admission ? '物理类' : null, admission ? 2026 : null,
          admission ? { type: 'subjects', mode: 'all', subjects: ['物理', '化学'] } : null])
    }
    majors.push({ id: majorId, name: `合成专业${suffix}`, batchId })
  }
  await mkdir('.scratch/exploration-first', { recursive: true })
  await writeFile(emptyEnvPath, '# independent UI test only\n')
  process.env.DOTENV_CONFIG_PATH = emptyEnvPath
  process.env.DATABASE_URL = isolatedUrl.toString(); process.env.DATABASE_SSL = 'false'; process.env.NODE_ENV = 'test'
  process.env.AI_BASE_URL = ''; process.env.AI_API_KEY = ''; process.env.AI_MODEL = ''
  const { app } = await import('../../../server-dist/app.js')
  ;({ database } = await import('../../../server-dist/database.js'))
  await writeFile(runtimePath, JSON.stringify({ runId, databaseName, schoolId, secondSchoolId, majors }))
  let finish
  const stopping = new Promise(resolve => { finish = resolve })
  server = await new Promise((resolve, reject) => {
    // Test-only shutdown lets Windows finish cleanup before Playwright kills its process.
    const instance = createServer((request, response) => {
      if (request.url === '/__exploration-test/shutdown' && request.method === 'POST' && request.headers['x-test-run-id'] === runId) {
        response.end('stopping'); finish(); return
      }
      app(request, response)
    }).listen(3104, '127.0.0.1', () => resolve(instance))
    instance.once('error', reject)
  })
  console.log('独立探索 UI 测试服务已启动；只含合成资料，外部 AI 关闭')
  process.once('SIGTERM', finish); process.once('SIGINT', finish)
  await stopping
} finally {
  await cleanup()
}
