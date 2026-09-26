import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import { expect, it } from 'vitest'
import { commitLearningImport, learningPayloadSha256, preflightLearningImport, prepareLearningImport, withdrawLearningBatch, type LearningImportManifest } from '../server/learning-evidence-import.js'

const testUrl = process.env.EXPLORATION_TEST_DATABASE_URL
it.skipIf(!testUrl)('独立 PostgreSQL：纯预检、幂等、staged显式更新、原文件复核、失败回滚及精确批次撤回', async () => {
  const url = new URL(testUrl!)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/zhixiang_exploration_test(?:_[a-z0-9]+)?$/.test(url.pathname)) throw new Error('只允许本机专用探索测试库')
  // Create exactly one fresh database. Never connect to the app/default target,
  // and never clean a previous run's database or another agent's database.
  const databaseName = `zhixiang_exploration_test_li${randomUUID().replaceAll('-', '')}`
  const admin = new Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 })
  const scoped = new URL(url); scoped.pathname = `/${databaseName}`
  const client = new Client({ connectionString: scoped.toString(), connectionTimeoutMillis: 5000 })
  const directory = await mkdtemp(join(tmpdir(), 'zhixiang-learning-pg-'))
  const now = new Date('2026-09-26T00:00:00Z')
  let created = false, connected = false
  const raw = Buffer.from('仅供本次独立测试库验证的合成材料，不是正式证据。')
  const pending = { status: 'pending' as const, reviewer: null, reviewedAt: null, conclusion: null, reason: null }
  const verified = { status: 'verified' as const, reviewer: '合成审核人', reviewedAt: '2026-09-20T00:00:00Z', conclusion: 'verified' as const, reason: '合成测试审核理由；不代表真实内容已审核' }
  const baseRecord = { majorCode: '080901', sourceKey: 'synthetic', locator: { kind: 'section', value: '合成章节' },
    scope: { level: 'school', schoolName: '合成学校', province: null, subjectGroup: null, admissionYear: null },
    review: pending, validUntil: null, jobDirectionCode: null, condition: null }
  function manifest(status: 'staged' | 'active' = 'staged'): LearningImportManifest {
    return { version: 1, batchId: randomUUID(), status,
      sources: [{ key: 'synthetic', title: '合成学习材料', url: 'https://test.example.edu/synthetic#learning', year: 2025,
        publisher: '合成学校', publisherType: 'university', collectedAt: '2026-09-19T00:00:00Z', localPath: 'raw.txt', sha256: learningPayloadSha256(raw) }],
      records: [{ ...baseRecord, factKey: 'curriculum', kind: 'curriculum', content: '合成课程' },
        { ...baseRecord, factKey: 'activity', kind: 'learning_activity', content: '合成实验活动' },
        { ...baseRecord, factKey: 'career', kind: 'career_direction', content: '合成职业方向', jobDirectionCode: 'synthetic-career' }] }
  }
  async function prepared(input: LearningImportManifest, previousSha256?: string) {
    const bytes = Buffer.from(JSON.stringify(input))
    return prepareLearningImport(bytes, learningPayloadSha256(bytes), { baseDirectory: directory, previousSha256 })
  }
  try {
    await admin.connect()
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true
    await client.connect(); connected = true
    await client.query(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'))
    await writeFile(join(directory, 'raw.txt'), raw)
    const majorId = (await client.query(`INSERT INTO majors(code,name,category) VALUES('080901','合成测试专业','合成类别') RETURNING id`)).rows[0].id
    const provinceId = (await client.query(`SELECT id FROM provinces WHERE name='山东'`)).rows[0].id
    await client.query(`INSERT INTO schools(name,province_id,city,level) VALUES('合成学校',$1,'合成城市','本科')`, [provinceId])
    const directionId = (await client.query(`INSERT INTO job_directions(code,employment_category,name,reviewed_at) VALUES('synthetic-career','合成类别','合成职业','2026-09-18T00:00:00Z') RETURNING id`)).rows[0].id
    await client.query(`INSERT INTO major_job_directions(major_id,job_direction_id,priority,review_status) VALUES($1,$2,1,'pending')`, [majorId, directionId])
    const profileId = randomUUID()
    await client.query(`INSERT INTO student_profiles(id,student_name) VALUES($1,'本次合成测试档案')`, [profileId])
    await client.query(`INSERT INTO profile_saved_items(profile_id,item_type,item_id,state,note) VALUES($1,'major',$2,'saved','本次合成原始备注')`, [profileId, majorId])

    const input = manifest(), first = await prepared(input)
    const preview = await preflightLearningImport(client, first, now)
    expect(preview.report.inserted).toBe(3)
    for (const table of ['data_sources', 'source_artifacts', 'learning_content_batches', 'major_learning_evidence']) expect((await client.query(`SELECT COUNT(*)::int count FROM ${table}`)).rows[0].count).toBe(0)
    const staged = await commitLearningImport(client, first, now)
    expect(staged.report).toMatchObject({ inserted: 3, updated: 0, skipped: 0 })
    expect(staged.coverage[0]!.complete).toBe(false)
    const originalIds = (await client.query('SELECT fact_key,id FROM major_learning_evidence WHERE batch_id=$1 ORDER BY fact_key', [input.batchId])).rows
    const repeatStaged = await commitLearningImport(client, first, now)
    expect(repeatStaged.report).toMatchObject({ inserted: 0, updated: 0, skipped: 3 })
    expect((await client.query('SELECT review_status FROM major_job_directions WHERE major_id=$1', [majorId])).rows[0].review_status).toBe('pending')
    await client.query(`UPDATE major_job_directions SET review_status='approved' WHERE major_id=$1 AND job_direction_id=$2`, [majorId, directionId])

    const approvedInput = { ...input, status: 'active' as const, records: input.records.map(record => ({ ...record as object, review: verified })) }
    await expect(commitLearningImport(client, await prepared(approvedInput), now)).rejects.toThrow('预检未通过')
    const activation = await prepared(approvedInput, first.sha256)
    const active = await commitLearningImport(client, activation, now)
    expect(active.report).toMatchObject({ inserted: 0, updated: 3, skipped: 0 })
    expect(active.coverage[0]!.complete).toBe(true)
    expect((await client.query('SELECT fact_key,id FROM major_learning_evidence WHERE batch_id=$1 ORDER BY fact_key', [input.batchId])).rows).toEqual(originalIds)
    const activatedAt = (await client.query('SELECT activated_at FROM learning_content_batches WHERE id=$1', [input.batchId])).rows[0].activated_at
    const repeatActive = await commitLearningImport(client, activation, new Date('2026-09-26T01:00:00Z'))
    expect(repeatActive.report).toMatchObject({ inserted: 0, updated: 0, skipped: 3 })
    expect((await client.query('SELECT activated_at FROM learning_content_batches WHERE id=$1', [input.batchId])).rows[0].activated_at).toEqual(activatedAt)
    expect((await client.query('SELECT COUNT(*)::int count FROM data_sources')).rows[0].count).toBe(1)
    expect((await client.query('SELECT COUNT(*)::int count FROM source_artifacts')).rows[0].count).toBe(1)

    const changedActive = { ...approvedInput, records: approvedInput.records.map(record => ({ ...record, content: '未授权修改有效批次' })) }
    await expect(commitLearningImport(client, await prepared(changedActive, activation.sha256), now)).rejects.toThrow('预检未通过')
    const another = { ...approvedInput, batchId: randomUUID() }
    await commitLearningImport(client, await prepared(another), now)
    const withdrawal = await withdrawLearningBatch(client, input.batchId, '本次合成批次撤回验证')
    expect(withdrawal).toMatchObject({ evidenceCount: 3, changed: true })
    expect((await withdrawLearningBatch(client, input.batchId, '重复撤回无需改历史理由')).changed).toBe(false)
    expect((await client.query('SELECT status FROM learning_content_batches WHERE id=$1', [another.batchId])).rows[0].status).toBe('active')
    expect((await client.query('SELECT state,note FROM profile_saved_items WHERE profile_id=$1 AND item_id=$2', [profileId, majorId])).rows[0]).toMatchObject({ state: 'saved', note: '本次合成原始备注' })
    await expect(commitLearningImport(client, activation, now)).rejects.toThrow('预检未通过')
    await expect(withdrawLearningBatch(client, randomUUID(), '不存在的准确批次')).rejects.toThrow('不存在')

    const staleInput = { ...approvedInput, batchId: randomUUID() }, stale = await prepared(staleInput)
    await writeFile(join(directory, 'raw.txt'), '预检后发生变更的合成文件')
    await expect(commitLearningImport(client, stale, now)).rejects.toThrow('预检未通过')
    expect((await client.query('SELECT COUNT(*)::int count FROM learning_content_batches WHERE id=$1', [staleInput.batchId])).rows[0].count).toBe(0)
    await writeFile(join(directory, 'raw.txt'), raw)

    const rollbackInput = { ...approvedInput, batchId: randomUUID(), sources: [{ ...approvedInput.sources[0]!, url: 'https://test.example.edu/rollback#test' }] }
    let inserts = 0
    const failsDuringWrite = { query: async (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT INTO major_learning_evidence') && ++inserts === 2) throw new Error('合成故障')
      return client.query(sql, values)
    } }
    await expect(commitLearningImport(failsDuringWrite, await prepared(rollbackInput), now)).rejects.toThrow('事务已回滚')
    expect((await client.query('SELECT COUNT(*)::int count FROM learning_content_batches WHERE id=$1', [rollbackInput.batchId])).rows[0].count).toBe(0)
    expect((await client.query('SELECT COUNT(*)::int count FROM data_sources WHERE source_url=$1', [rollbackInput.sources[0]!.url])).rows[0].count).toBe(0)
    expect((await client.query('SELECT COUNT(*)::int count FROM major_learning_evidence')).rows[0].count).toBe(6)

    const identityInput = manifest(), identityPrepared = await prepared(identityInput)
    await commitLearningImport(client, identityPrepared, now)
    const alteredIdentity = { ...identityInput, records: identityInput.records.map(record => ({ ...record as object, scope: { level: 'major', schoolName: null, province: null, subjectGroup: null, admissionYear: null } })) }
    const identityPreview = await preflightLearningImport(client, await prepared(alteredIdentity, identityPrepared.sha256), now)
    expect(identityPreview.report.anomalous).toBe(3)
    const incompleteSet = { ...identityInput, records: identityInput.records.slice(0, 2) }
    expect((await preflightLearningImport(client, await prepared(incompleteSet, identityPrepared.sha256), now)).batchErrors).toContain('替换待发布批次必须完整保留原事实键，不允许增删事实')
    const missingId = { ...approvedInput, batchId: randomUUID(), records: approvedInput.records.map(record => ({ ...record, majorCode: '不存在的专业代码' })) }
    await expect(commitLearningImport(client, await prepared(missingId), now)).rejects.toThrow('预检未通过')
    expect((await client.query('SELECT COUNT(*)::int count FROM learning_content_batches WHERE id=$1', [missingId.batchId])).rows[0].count).toBe(0)
  } finally {
    if (connected) await client.end()
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`)
    await admin.end()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
