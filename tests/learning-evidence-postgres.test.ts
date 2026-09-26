import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { expect, it } from 'vitest'

// Opt in explicitly. Never use DATABASE_URL, dotenv or the app's fallback.
const testUrl = process.env.EXPLORATION_TEST_DATABASE_URL
it.skipIf(!testUrl)('独立 PostgreSQL：幂等迁移、约束、撤回、旧数据与客户端权限', async () => {
  const url = new URL(testUrl!)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/zhixiang_exploration_test(?:_[a-z0-9]+)?$/.test(url.pathname)) {
    throw new Error('数据库验证仅允许本机专用 zhixiang_exploration_test 数据库')
  }
  const client = new Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 })
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
  const migration = await readFile(new URL('../database/migrations/001-learning-evidence.sql', import.meta.url), 'utf8')
  expect(schema).toContain(migration.trim())
  const profileId = randomUUID(), artifactId = randomUUID(), batchId = randomUUID(), secondBatchId = randomUUID(), factId = randomUUID()
  await client.connect()
  try {
    await client.query('BEGIN')
    // Simulate an existing installation, then migrate it twice and initialize
    // again. All synthetic rows and DDL roll back at the end of this test.
    await client.query(schema.replace(migration.trim(), ''))
    const major = (await client.query(`INSERT INTO majors(code,name,category) VALUES ($1,'合成测试专业','测试类别') RETURNING id`, [`TEST-${randomUUID()}`])).rows[0].id
    await client.query(`INSERT INTO student_profiles(id,student_name) VALUES ($1,'合成测试档案')`, [profileId])
    await client.query(`INSERT INTO profile_saved_items(profile_id,item_type,item_id,state,note) VALUES ($1,'major',$2,'saved','合成家庭原始备注')`, [profileId, major])
    await client.query(migration)
    await client.query(migration)
    await client.query(schema)
    expect((await client.query('SELECT note FROM profile_saved_items WHERE profile_id=$1', [profileId])).rows[0].note).toBe('合成家庭原始备注')
    const source = (await client.query(`INSERT INTO data_sources(source_type,title,source_url,source_year,publisher) VALUES ('major','合成材料',$1,2025,'合成发布方') RETURNING id`, [`https://test.example.edu/${randomUUID()}#plan`])).rows[0].id
    await client.query(`INSERT INTO source_artifacts(id,source_id,official_page_url,sha256,local_path,byte_size) VALUES ($1,$2,'https://test.example.edu/plan#chapter',$3,'tests/synthetic-only.txt',10)`, [artifactId, source, 'a'.repeat(64)])
    await client.query(`INSERT INTO learning_content_batches(id,payload_sha256,status,activated_at) VALUES ($1,$3,'active',NOW()),($2,$3,'active',NOW())`, [batchId, secondBatchId, 'b'.repeat(64)])
    await client.query(`INSERT INTO major_learning_evidence(id,batch_id,fact_key,major_id,artifact_id,kind,content,publisher_type,locator_kind,locator_value,scope_level,review_status,reviewer,reviewed_at,review_conclusion,review_reason)
      VALUES ($1,$2,'curriculum',$3,$4,'curriculum','合成课程事实','university','section','课程章节','major','verified','合成审核人',NOW(),'verified','合成审核理由')`, [factId, batchId, major, artifactId])
    await client.query(`INSERT INTO major_learning_evidence(id,batch_id,fact_key,major_id,artifact_id,kind,content,publisher_type,locator_kind,locator_value,scope_level)
      VALUES ($1,$2,'curriculum',$3,$4,'curriculum','另一批合成事实','university','page','2','major')`, [randomUUID(), secondBatchId, major, artifactId])
    // Savepoints isolate expected constraint failures inside the test transaction.
    async function rejects(sql: string, values: unknown[], code: string) {
      await client.query('SAVEPOINT invalid_row')
      try {
        await expect(client.query(sql, values)).rejects.toMatchObject({ code })
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT invalid_row')
      }
    }
    await rejects(`UPDATE major_learning_evidence SET review_reason=NULL WHERE id=$1`, [factId], '23514')
    await rejects(`UPDATE major_learning_evidence SET reviewer=' ' WHERE id=$1`, [factId], '23514')
    await rejects(`UPDATE major_learning_evidence SET locator_value='' WHERE id=$1`, [factId], '23514')
    await rejects(`UPDATE major_learning_evidence SET scope_level='school' WHERE id=$1`, [factId], '23514')
    await rejects(`UPDATE major_learning_evidence SET kind='admission_requirement' WHERE id=$1`, [factId], '23514')
    await rejects(`UPDATE major_learning_evidence SET condition='{"type":"subjects","mode":"all","subjects":["物理"]}' WHERE id=$1`, [factId], '23514')
    await rejects(`UPDATE major_learning_evidence SET kind='career_direction',job_direction_id=999999999 WHERE id=$1`, [factId], '23503')
    await rejects(`UPDATE major_learning_evidence SET artifact_id=$2 WHERE id=$1`, [factId, randomUUID()], '23503')
    await rejects(`DELETE FROM majors WHERE id=$1`, [major], '23503')
    await rejects(`DELETE FROM learning_content_batches WHERE id=$1`, [batchId], '23503')
    await rejects(`INSERT INTO major_learning_evidence(id,batch_id,fact_key,major_id,artifact_id,kind,content,publisher_type,locator_kind,locator_value,scope_level)
      VALUES ($1,$2,'curriculum',$3,$4,'curriculum','重复合成事实','university','section','章节','major')`, [randomUUID(), batchId, major, artifactId], '23505')
    await client.query(`UPDATE major_learning_evidence SET kind='admission_requirement',province='河南',subject_group='物理类',admission_year=2026,
      condition='{"type":"subjects","mode":"unrestricted","subjects":[]}' WHERE id=$1`, [factId])
    for (const condition of [{}, { type: 'subjects', mode: 'all', subjects: [] }, { type: 'subjects', mode: 'any', subjects: ['数学'] }, { type: 'subjects', mode: 'unrestricted' }]) {
      await rejects(`UPDATE major_learning_evidence SET condition=$2 WHERE id=$1`, [factId, JSON.stringify(condition)], '23514')
    }
    await client.query('UPDATE majors SET name=$2 WHERE id=$1', [major, '合成修订名称'])
    expect((await client.query(`SELECT m.id,m.name,s.note FROM majors m JOIN profile_saved_items s ON s.item_id=m.id AND s.item_type='major' WHERE s.profile_id=$1`, [profileId])).rows[0]).toMatchObject({ id: major, name: '合成修订名称', note: '合成家庭原始备注' })
    await client.query(`UPDATE learning_content_batches SET status='withdrawn',withdrawn_at=NOW(),withdrawal_reason='合成批次撤回' WHERE id=$1`, [batchId])
    await client.query(migration)
    expect((await client.query(`SELECT COUNT(*)::int count FROM major_learning_evidence e JOIN learning_content_batches b ON b.id=e.batch_id WHERE e.id=$1 AND b.status='active'`, [factId])).rows[0].count).toBe(0)
    expect((await client.query(`SELECT status FROM learning_content_batches WHERE id=$1`, [secondBatchId])).rows[0].status).toBe('active')
    expect((await client.query('SELECT note FROM profile_saved_items WHERE profile_id=$1', [profileId])).rows[0].note).toBe('合成家庭原始备注')
    const tables = ['major_learning_evidence', 'learning_content_batches']
    const protectedTables = await client.query('SELECT relname,relrowsecurity FROM pg_class WHERE relname=ANY($1)', [tables])
    expect(protectedTables.rows).toHaveLength(2)
    expect(protectedTables.rows.every(row => row.relrowsecurity)).toBe(true)
    for (const role of ['anon', 'authenticated']) {
      for (const table of tables) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          expect((await client.query('SELECT has_table_privilege($1,$2,$3) allowed', [role, `public.${table}`, privilege])).rows[0].allowed).toBe(false)
        }
      }
    }
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
}, 30000)
