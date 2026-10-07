import express from 'express'
import { ZodError } from 'zod'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { comparisonMajor, comparisonSchool, comparisonProfileId } from './fixtures/comparison'
import { renderMajorComparisonReport, renderSchoolComparisonReport, type SchoolReportDetail } from '../server/comparison-report-template'

const service = vi.hoisted(() => ({ profile: true, missingMajor: false, failPdf: false,
  context: vi.fn(), major: vi.fn(), school: vi.fn(), query: vi.fn(), pdf: vi.fn() }))
vi.mock('../server/database.js', () => ({ database: { query: service.query } }))
vi.mock('../server/major-exploration-routes.js', () => ({ loadExplorationProfile: service.context }))
vi.mock('../server/major-exploration.js', () => ({ loadExplorationDetail: service.major }))
vi.mock('../server/school-detail.js', () => ({ loadSchoolDetail: service.school,
  SchoolDetailLookupError: class extends Error { readonly status = 404 } }))
vi.mock('../server/pdf-renderer.js', () => ({ renderPdf: service.pdf }))
import { comparisonReportsRouter } from '../server/comparison-reports'
const app = express()
app.use(express.json())
app.use((_request, response, next) => { response.locals.requestId = 'comparison-test'; next() })
app.use('/api', comparisonReportsRouter)
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => response.status(error instanceof ZodError ? 422 : 500).json({ success: false, data: null, error: '输入错误', requestId: 'comparison-test' }))
const server = app.listen(0)
function endpoint(id = comparisonProfileId) { const address = server.address(); if (!address || typeof address === 'string') throw new Error('测试端口不可用'); return `http://127.0.0.1:${address.port}/api/profiles/${id}/comparison.pdf` }
const send = (body: unknown, id?: string) => fetch(endpoint(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
beforeEach(() => {
  vi.clearAllMocks(); service.profile = true; service.missingMajor = false; service.failPdf = false
  service.query.mockImplementation(async (sql: string) => [sql.includes('student_profiles') ? (service.profile ? [{ studentName: '合成导出家庭', province: '河南', subjectGroup: '物理类' }] : []) : [{ itemId: 1, note: '服务端原始备注' }], []])
  service.context.mockResolvedValue({ savedItems: [] })
  service.major.mockImplementation(async (_db, _context, id: number) => service.missingMajor ? null : comparisonMajor(id))
  service.school.mockImplementation(async (id: number) => comparisonSchool(id))
  service.pdf.mockImplementation(async () => { if (service.failPdf) throw new Error('secret connection and profile text'); return Buffer.from('%PDF-test') })
})
describe('对比 PDF 输入、当前读取与失败边界', () => {
  it.each([{ kind: 'major', ids: [1] }, { kind: 'major', ids: [1, 2, 3, 4] }, { kind: 'school', ids: [1, 2, 3, 4, 5] }, { kind: 'school', ids: [1, 1] }, { kind: 'major', ids: [-1, 2] }, { kind: 'major', ids: ['1', 2] }, { kind: 'other', ids: [1, 2] }, { kind: 'major', ids: [1, 2], html: '<script>' }])('拒绝无效选择 %j，未读资料或调用浏览器', async body => {
    expect((await send(body)).status).toBe(422); expect(service.query).not.toHaveBeenCalled(); expect(service.pdf).not.toHaveBeenCalled()
  })
  it('不存在档案与专业返回统一404，非法档案ID返回422', async () => {
    expect((await send({ kind: 'major', ids: [1, 2] }, 'bad-id')).status).toBe(422)
    service.profile = false; const missing = await send({ kind: 'major', ids: [1, 2] }); expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ success: false, data: null, requestId: 'comparison-test' })
    service.profile = true; service.missingMajor = true; expect((await send({ kind: 'major', ids: [1, 2] })).status).toBe(404); expect(service.pdf).not.toHaveBeenCalled()
  })
  it('每次按准确ID与选择顺序重新读取专业，输出PDF且不缓存', async () => {
    const response = await send({ kind: 'major', ids: [2, 1] }); expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('application/pdf'); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).toBe('%PDF-test')
    const html = service.pdf.mock.calls[0]![0] as string
    expect(html.indexOf('数学与应用数学')).toBeLessThan(html.indexOf('计算机科学与技术'))
    expect(html).toContain('想先核对课程安排'); expect(service.major.mock.calls.map(call => call[2])).toEqual([2, 1])
    await send({ kind: 'major', ids: [2, 1] }); expect(service.context).toHaveBeenCalledTimes(2); expect(service.major).toHaveBeenCalledTimes(4)
  })
  it('院校调用统一详情读取且只读取对应档案保存的备注，不调用AI', async () => {
    expect((await send({ kind: 'school', ids: [2, 1] })).status).toBe(200)
    expect(service.school).toHaveBeenCalledWith(2, comparisonProfileId); expect(service.school).toHaveBeenCalledWith(1, comparisonProfileId)
    expect(service.pdf.mock.calls[0]![0]).toContain('服务端原始备注')
    expect(service.query.mock.calls[1]![1]).toEqual([comparisonProfileId, 2, 1])
  })
  it('浏览器故障返回503中文且不泄漏内部诊断', async () => {
    service.failPdf = true; const response = await send({ kind: 'major', ids: [1, 2] }); expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('secret'); expect(service.pdf).toHaveBeenCalledOnce()
  })
})
describe('报告证据、范围与HTML边界', () => {
  it('每份专业事实和可重复院校表头保留准确对象名、招生粒度与未知条件', () => {
    const major = comparisonMajor(1)
    const html = renderMajorComparisonReport({ studentName: '合成', province: '河南', subjectGroup: '物理类' }, [major], '2026-10-07T00:00:00Z')
    expect(html).toContain('计算机科学与技术 · 课程与培养')
    expect(html).toContain('计算机科学与技术 · 职业准入门槛')
    const school: SchoolReportDetail = comparisonSchool(1)
    school.admissionContext = { provinceRank: null, records: [
      { year: 2025, unitName: '具体测试专业', unitType: 'exact_major', batch: '本科批', subjectRequirement: ' ', minRank: 30000, risk: null, confidence: '低', publisher: '合成测试招生办', sourceUrl: 'https://test.example.edu/admission', recommendationExclusionReason: null },
      { year: 2024, unitName: '学校参考线', unitType: 'school_line', batch: '本科批', subjectRequirement: null, minRank: 32000, risk: null, confidence: '低', publisher: '合成测试招生办', sourceUrl: 'https://test.example.edu/admission', recommendationExclusionReason: '只供浏览' },
    ] }
    const report = renderSchoolComparisonReport({ studentName: '合成', province: '河南', subjectGroup: '物理类' }, [school], new Map(), '2026-10-07T00:00:00Z')
    expect(report).toContain('<th colspan="5" class="record-owner">合成探索学院 / 招生记录</th>')
    expect(report).toContain('具体专业'); expect(report).toContain('学校线'); expect(report).toContain('待核验，未知不表示不限')
    expect(report).toContain('没有规划位次，不生成冲稳保'); expect(report).toContain('只供浏览')
  })
  it('待补充或失效对象不导出响应中残留的旧事实，保留原始备注及缺口', () => {
    const stale = comparisonMajor(1); stale.status = 'unavailable'; stale.facts.curriculum[0]!.content = '已撤回旧课程禁止展示'
    const html = renderMajorComparisonReport({ studentName: '<script>alert(1)</script>', province: '河南', subjectGroup: '物理类' }, [stale, comparisonMajor(2)], '2026-10-07T00:00:00Z')
    expect(html).not.toContain('已撤回旧课程禁止展示'); expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain('家庭原始备注'); expect(html).toContain('未知不表示不限'); expect(html).toContain('2025 年材料'); expect(html).toContain('合成课程章节'); expect(html).toContain('test.example.edu/plan#curriculum')
  })
  it('院校缺失优势与选科保持未知，不把推荐关注或首条招生风险概括为整校结论', () => {
    const school = comparisonSchool(1)
    school.school.officialUrl = 'javascript:alert(1)'
    const html = renderSchoolComparisonReport({ studentName: '合成', province: '河南', subjectGroup: '物理类' }, [school], new Map([[1, '<img src=x onerror=alert(1)>']]), '2026-10-07T00:00:00Z')
    expect(html).not.toContain('href="javascript:'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;img'); expect(html).toContain('暂无经核验数据'); expect(html).toContain('暂无可比招生记录')
  })
})
