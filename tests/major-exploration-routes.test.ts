import express from 'express'
import { ZodError } from 'zod'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ profileExists: true, majorExists: true, detailExists: true,
  ranks: [] as number[], queries: [] as string[] }))
const service = vi.hoisted(() => ({ list: vi.fn(), catalog: vi.fn(), detail: vi.fn() }))
vi.mock('../server/major-exploration.js', () => ({ buildExplorationList: service.list,
  loadExplorationCatalog: service.catalog, loadExplorationDetail: service.detail }))
vi.mock('../server/database.js', () => ({ database: {
  query: vi.fn(async (sql: string) => {
    state.queries.push(sql)
    if (sql.includes('FROM student_profiles sp')) return [state.profileExists ? [{ studentName: '合成测试', planningMode: 'exploration',
      province: '河南', subjectGroup: '物理类', selectedSubjects: ['物理', '化学', '生物'], score: 550, provinceRank: null }] : [], []]
    if (sql.includes('SELECT id FROM student_profiles')) return [state.profileExists ? [{ id: 'test' }] : [], []]
    if (sql.includes('SELECT id FROM majors')) return [state.majorExists ? [{ id: 1 }] : [], []]
    if (sql.includes('province_rank provinceRank FROM profile_score_snapshots')) return [state.ranks.map(provinceRank => ({ provinceRank })), []]
    if (sql.includes('FROM profile_saved_items')) return [[{ itemType: 'major', itemId: 1, state: 'saved', note: '合成原始备注' }], []]
    if (sql.includes('FROM job_sources')) return [[{ healthySources: 0, lastSuccessAt: null, staleDays: null }], []]
    if (sql.includes('SELECT DISTINCT m.id')) return [[{ id: 1, code: '080901', name: '合成专业', category: '工学' }], []]
    if (sql.includes('COUNT(DISTINCT jp.fingerprint)')) return [[{ jobCount: 0, provinceCount: 0, sourceCount: 0 }], []]
    return [[], []]
  }),
  execute: vi.fn(async () => [{ affectedRows: 1, insertId: 0 }, []]),
} }))
vi.mock('../server/admission-candidates.js', () => ({ loadAdmissionCandidates: vi.fn(async () => ({ candidates: [],
  evidence: { years: [2025], unitType: 'major_group', confidence: '低', recordCount: 1, note: '合成记录' } })) }))
vi.mock('../server/profession-engine.js', async original => {
  const actual = await original<typeof import('../server/profession-engine.js')>()
  return { ...actual, rankProfessions: vi.fn(actual.rankProfessions) }
})

import { rankProfessions } from '../server/profession-engine.js'
import { loadAdmissionCandidates } from '../server/admission-candidates.js'
import { buildProfessionDashboard, professionDashboardRouter } from '../server/profession-dashboard.js'
import { majorExplorationRouter } from '../server/major-exploration-routes.js'
import { database } from '../server/database.js'

const profileId = '40000000-0000-4000-8000-000000000001'
const app = express()
app.use(express.json())
app.use((_request, response, next) => { response.locals.requestId = 'exploration-test'; next() })
app.use('/api', professionDashboardRouter, majorExplorationRouter)
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(error instanceof ZodError ? 422 : 500).json({ success: false, data: null, error: '合成测试错误', requestId: response.locals.requestId })
})
const server = app.listen(0)
function endpoint(path: string) {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试端口不可用')
  return `http://127.0.0.1:${address.port}/api/profiles/${profileId}/${path}`
}

describe('专业探索 HTTP 与规划位次分支', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.profileExists = true; state.majorExists = true; state.detailExists = true; state.ranks = []; state.queries = []
    service.list.mockResolvedValue({ mode: 'exploration', cards: [], coverage: { reviewedMajorCount: 0 }, dataGaps: ['学习材料待补充'] })
    service.catalog.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    service.detail.mockImplementation(async () => state.detailExists ? { status: 'pending', identity: { id: 1 }, facts: {}, dataGaps: ['资料待补充'] } : null)
  })
  afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  it('只有分数时不调用评分或招生候选，保留原模式、备注和探索材料', async () => {
    const dashboard = await buildProfessionDashboard(profileId)
    expect(dashboard.mode).toBe('exploration')
    expect(dashboard.profileSummary.planningMode).toBe('exploration')
    expect(dashboard.cards).toEqual([])
    expect(dashboard.exploration?.dataGaps).toContain('学习材料待补充')
    expect(dashboard.savedItems[0]?.note).toBe('合成原始备注')
    expect(rankProfessions).not.toHaveBeenCalled()
    expect(loadAdmissionCandidates).not.toHaveBeenCalled()
    expect(state.queries.some(sql => sql.includes('major_outlook_evidence') || sql.includes('job_postings'))).toBe(false)
  })
  it('原始探索档案新增有效全省位次后进入既有规则，不改原始模式或备注', async () => {
    state.ranks = [9000, 10000, 11000]
    const dashboard = await buildProfessionDashboard(profileId)
    expect(dashboard.mode).toBe('application')
    expect(dashboard.profileSummary.planningMode).toBe('exploration')
    expect(dashboard.planningCoordinate.rank).toBe(10000)
    expect(dashboard.exploration).toBeNull()
    expect(dashboard.savedItems[0]?.note).toBe('合成原始备注')
    expect(rankProfessions).toHaveBeenCalledOnce()
    expect(service.list).not.toHaveBeenCalled()
    expect(loadAdmissionCandidates).toHaveBeenCalledWith(expect.objectContaining({ rank: 10000, province: '河南', subjectGroup: '物理类' }))
    const input = vi.mocked(rankProfessions).mock.calls[0]![0][0]!
    expect(input.mode).toBe('application')
    expect(dashboard.cards[0]?.factors).toMatchObject({ coverage: { weight: 30 }, directEntry: { weight: 20 }, schoolAccess: { weight: 25 }, stability: { weight: 10 }, outlook: { weight: 15 } })
  })
  it('目录参数经过校验，保留搜索类别和当前资格范围', async () => {
    const response = await fetch(endpoint('major-exploration/catalog?search=合成&category=工学&page=2&pageSize=3&admissionYear=2027'))
    expect(response.status).toBe(200)
    expect((await response.json()).requestId).toBe('exploration-test')
    expect(service.catalog).toHaveBeenCalledWith(database, expect.objectContaining({ admissionYear: 2027, selectedSubjects: ['物理', '化学', '生物'] }),
      { search: '合成', category: '工学', page: 2, pageSize: 3 })
  })
  it.each(['catalog?pageSize=51', 'catalog?page=0', 'catalog?admissionYear=abc', 'catalog?surprise=1', '0', '9007199254740992', '1?schoolId=0', '1?sourceYear=1999'])('无效输入 %s 返回422且不查事实', async path => {
    const response = await fetch(endpoint(`major-exploration/${path}`))
    expect(response.status).toBe(422)
    expect(service.detail).not.toHaveBeenCalled()
    expect(service.catalog).not.toHaveBeenCalled()
  })
  it('身份存在但无审核资料为200待补；不存在为404', async () => {
    let response = await fetch(endpoint('major-exploration/1?schoolId=9&sourceYear=2026'))
    expect(response.status).toBe(200)
    expect((await response.json()).data.status).toBe('pending')
    expect(service.detail).toHaveBeenCalledWith(database, expect.anything(), 1, { schoolId: 9, sourceYear: 2026 })
    state.detailExists = false
    response = await fetch(endpoint('major-exploration/123'))
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('专业不存在')
  })
  it.each(['major-exploration', 'major-exploration/catalog', 'major-exploration/1', 'profession-dashboard'])('不存在档案 %s 返回404', async path => {
    state.profileExists = false
    const response = await fetch(endpoint(path))
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('学生档案不存在')
  })
  it('收藏不存在的专业不写入；状态切换不传备注保留原备注', async () => {
    state.majorExists = false
    const send = () => fetch(endpoint('saved-items'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemType: 'major', itemId: 1, state: 'excluded' }) })
    expect((await send()).status).toBe(404)
    expect(database.execute).not.toHaveBeenCalled()
    state.majorExists = true
    expect((await send()).status).toBe(200)
    expect(vi.mocked(database.execute).mock.calls[0]![0]).toContain('DO UPDATE SET state=EXCLUDED.state')
    expect(vi.mocked(database.execute).mock.calls[0]![0]).not.toContain('note=EXCLUDED.note')
  })
  it('收藏和备注更新均保留用户原始空格与换行，按原长度校验', async () => {
    const note = '  家庭原文\n还需核验课程安排。\n '
    const headers = { 'content-type': 'application/json' }
    let response = await fetch(endpoint('saved-items'), { method: 'PUT', headers,
      body: JSON.stringify({ itemType: 'major', itemId: 1, state: 'saved', note }) })
    expect(response.status).toBe(200)
    expect(vi.mocked(database.execute).mock.calls[0]![1]?.at(-1)).toBe(note)
    response = await fetch(endpoint('saved-items/major/1/note'), { method: 'PATCH', headers, body: JSON.stringify({ note }) })
    expect(response.status).toBe(200)
    expect((await response.json()).data.note).toBe(note)
    expect(vi.mocked(database.execute).mock.calls[1]![1]?.[0]).toBe(note)
    response = await fetch(endpoint('saved-items/major/1/note'), { method: 'PATCH', headers,
      body: JSON.stringify({ note: ` ${'字'.repeat(500)} ` }) })
    expect(response.status).toBe(422)
    expect(database.execute).toHaveBeenCalledTimes(2)
  })
})
