import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Client, types } from 'pg'
import { expect, it, vi } from 'vitest'
import { buildExplorationList, loadExplorationCatalog, loadExplorationDetail, type ExplorationContext } from '../server/major-exploration.js'
import { loadCurrentLearningEvidence, type LearningEvidenceDatabase } from '../server/learning-evidence-repository.js'
import { learningEvidenceSchema } from '../server/learning-evidence-contract.js'

vi.mock('../server/database.js', () => ({ database: { query: () => { throw new Error('测试禁止调用默认数据库') } } }))
// Explicitly separate from schema/route tests. Never load .env or DATABASE_URL.
const testUrl = process.env.EXPLORATION_SERVICE_TEST_DATABASE_URL
it.skipIf(!testUrl)('独立 PostgreSQL 探索服务：材料关联、分页、精确范围、重新生成与收藏保留', async () => {
  const url = new URL(testUrl!)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/zhixiang_exploration_test_service(?:_[a-z0-9]+)?$/.test(url.pathname)) {
    throw new Error('服务数据库验证仅允许本机专用 zhixiang_exploration_test_service 数据库')
  }
  types.setTypeParser(20, value => Number(value))
  const client = new Client({ connectionString: testUrl, connectionTimeoutMillis: 5000 })
  const db: LearningEvidenceDatabase = { query: async <T>(sql: string, values?: readonly unknown[]) => {
    let index = 0
    const result = await client.query(sql.replace(/\?/g, () => `$${++index}`), values ? [...values] : [])
    for (const row of result.rows) if (row.evidence) {
      const validation = learningEvidenceSchema.safeParse(row.evidence)
      if (!validation.success) throw new Error(JSON.stringify(validation.error.issues))
    }
    return [result.rows as T, result.fields]
  } }
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
  const nonce = randomUUID(), profileId = randomUUID(), batchId = randomUUID(), artifactId = randomUUID()
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(schema)
    const provinceId = (await client.query(`SELECT id FROM provinces WHERE name='河南'`)).rows[0].id
    const schoolId = (await client.query(`INSERT INTO schools(name,province_id,city,level) VALUES ($1,$2,'合成城市','本科') RETURNING id`, [`合成测试学校-${nonce}`, provinceId])).rows[0].id
    const directionId = (await client.query(`INSERT INTO job_directions(code,employment_category,name) VALUES ($1,'合成职业类','合成职业身份') RETURNING id`, [`TEST-${nonce}`])).rows[0].id
    const sourceId = (await client.query(`INSERT INTO data_sources(source_type,title,source_url,source_year,publisher) VALUES ('major','合成官方材料',$1,2025,'合成测试发布方') RETURNING id`, [`https://test.example.edu/${nonce}#plan`])).rows[0].id
    await client.query(`INSERT INTO source_artifacts(id,source_id,official_page_url,sha256,local_path,byte_size) VALUES ($1,$2,$3,$4,'tests/synthetic-only.txt',10)`, [artifactId, sourceId, `https://test.example.edu/${nonce}#curriculum`, 'a'.repeat(64)])
    await client.query(`INSERT INTO learning_content_batches(id,payload_sha256,status,activated_at) VALUES ($1,$2,'active',NOW())`, [batchId, 'b'.repeat(64)])
    const majorIds: number[] = []
    for (let index = 0; index < 11; index++) {
      const majorId = (await client.query(`INSERT INTO majors(code,name,category) VALUES ($1,$2,'合成专业类别') RETURNING id`, [`TEST-${String(index).padStart(2, '0')}-${nonce.slice(0, 8)}`, `合成服务专业${index}-${nonce}`])).rows[0].id
      majorIds.push(majorId)
      await client.query(`INSERT INTO major_job_directions(major_id,job_direction_id,priority,review_status) VALUES ($1,$2,1,'approved')`, [majorId, directionId])
      for (const kind of ['curriculum', 'learning_activity', 'career_direction']) {
        await client.query(`INSERT INTO major_learning_evidence(id,batch_id,fact_key,major_id,artifact_id,kind,content,publisher_type,
          locator_kind,locator_value,scope_level,school_id,job_direction_id,review_status,reviewer,reviewed_at,review_conclusion,review_reason)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'university','section','合成章节','school',$8,$9,'verified','合成审核人',NOW(),'verified','合成审核记录，不是正式事实')`,
        [randomUUID(), batchId, `${majorId}-${kind}`, majorId, artifactId, kind, `合成${kind}事实`, schoolId, kind === 'career_direction' ? directionId : null])
      }
    }
    const pendingId = (await client.query(`INSERT INTO majors(code,name,category) VALUES ($1,$2,'合成专业类别') RETURNING id`, [`TEST-pending-${nonce.slice(0, 8)}`, `合成待补专业-${nonce}`])).rows[0].id
    await client.query(`INSERT INTO major_learning_evidence(id,batch_id,fact_key,major_id,artifact_id,kind,content,publisher_type,locator_kind,locator_value,scope_level)
      VALUES ($1,$2,'pending',$3,$4,'curriculum','禁止发布的待审核事实','university','page','1','major')`, [randomUUID(), batchId, pendingId, artifactId])
    await client.query(`INSERT INTO student_profiles(id,student_name,province_id,subject_group,selected_subjects,planning_mode) VALUES ($1,'合成测试公开档案',$2,'物理类','["物理","生物","地理"]','exploration')`, [profileId, provinceId])
    await client.query(`INSERT INTO profile_saved_items(profile_id,item_type,item_id,state,note) VALUES ($1,'major',$2,'saved','  合成原始家庭备注  ')`, [profileId, majorIds[10]])
    const context: ExplorationContext = { province: '河南', subjectGroup: '物理类', selectedSubjects: ['物理', '生物', '地理'], admissionYear: 2026,
      savedItems: [{ itemType: 'major', itemId: majorIds[10]!, state: 'saved', note: '  合成原始家庭备注  ' }] }
    const current = await loadCurrentLearningEvidence(db)
    expect(current.facts).toHaveLength(33)
    expect(current.gaps).toHaveLength(1)
    expect(current.facts[0]!.source).toMatchObject({ artifactId, sha256: 'a'.repeat(64), year: 2025 })
    expect(current.facts[0]!.source.url).toContain('#curriculum')
    expect(current.facts[0]!.review.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const list = await buildExplorationList(db, context)
    expect(list.cards.map(card => card.id)).toEqual(majorIds.slice(0, 9))
    expect(list.coverage).toMatchObject({ reviewedMajorCount: 11, completeMajorCount: 11, incompleteMajorCount: 0, displayedCount: 9 })
    expect(list.cards[0]!.schoolExamples[0]!.id).toBe(schoolId)
    expect(list.cards[0]!.admission.status).toBe('unknown')
    const page = await loadExplorationCatalog(db, context, { page: 3, pageSize: 4 })
    expect(page.total).toBe(12)
    expect(page.items.map(card => card.id)).toEqual([...majorIds.slice(8), pendingId])
    expect((await loadExplorationCatalog(db, context, { search: `合成待补专业-${nonce}` })).items[0]!).toMatchObject({ id: pendingId, status: 'pending' })
    const outside = await loadExplorationDetail(db, context, majorIds[10]!)
    expect(outside).toMatchObject({ identity: { id: majorIds[10] }, savedState: 'saved', note: '  合成原始家庭备注  ', materialStatus: 'available' })
    expect(await loadExplorationDetail(db, context, Number.MAX_SAFE_INTEGER)).toBeNull()
    const missing = await loadExplorationDetail(db, context, majorIds[10]!, { schoolId, sourceYear: 2026 })
    expect(missing).toMatchObject({ materialStatus: 'missing', requestedScope: { schoolId, sourceYear: 2026 } })
    expect(missing!.facts.curriculum).toEqual([])
    expect(missing!.otherInstances).toHaveLength(3)
    expect(JSON.stringify(await loadExplorationDetail(db, context, pendingId))).not.toContain('禁止发布')
    await client.query(`UPDATE major_job_directions SET review_status='pending' WHERE major_id=$1`, [majorIds[10]])
    expect((await loadExplorationDetail(db, context, majorIds[10]!))!.careerDirections).toEqual([])
    await client.query(`UPDATE majors SET name='合成修订名称' WHERE id=$1`, [majorIds[10]])
    await client.query(`UPDATE learning_content_batches SET status='withdrawn',withdrawn_at=NOW(),withdrawal_reason='合成批次撤回' WHERE id=$1`, [batchId])
    const withdrawn = await loadExplorationDetail(db, context, majorIds[10]!)
    expect(withdrawn).toMatchObject({ identity: { id: majorIds[10], name: '合成修订名称' }, status: 'unavailable', savedState: 'saved', note: '  合成原始家庭备注  ' })
    expect(Object.values(withdrawn!.facts).flat()).toEqual([])
    expect(withdrawn!.unavailableEvidence).toHaveLength(3)
    expect((await buildExplorationList(db, context)).cards).toEqual([])
    expect((await client.query(`SELECT note FROM profile_saved_items WHERE profile_id=$1 AND item_type='major' AND item_id=$2`, [profileId, majorIds[10]])).rows[0].note).toBe('  合成原始家庭备注  ')
  } finally {
    await client.query('ROLLBACK')
    await client.end()
  }
}, 30000)
