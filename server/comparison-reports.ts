import { Router } from 'express'
import { z } from 'zod'
import { database, type DatabaseRow } from './database.js'
import { loadExplorationProfile } from './major-exploration-routes.js'
import { loadExplorationDetail } from './major-exploration.js'
import { loadSchoolDetail, SchoolDetailLookupError } from './school-detail.js'
import { renderMajorComparisonReport, renderSchoolComparisonReport, type ComparisonProfile } from './comparison-report-template.js'
import { renderPdf } from './pdf-renderer.js'

const ids = (maximum: number) => z.array(z.number().int().positive().safe()).min(2).max(maximum).refine(values => new Set(values).size === values.length, '不能重复选择同一对象')
export const comparisonReportInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('major'), ids: ids(3) }).strict(),
  z.object({ kind: z.literal('school'), ids: ids(4) }).strict(),
])
export const comparisonReportsRouter = Router()
comparisonReportsRouter.post('/profiles/:id/comparison.pdf', async (request, response, next) => {
  const fail = (status: number, error: string) => response.status(status).json({ success: false, data: null, error, requestId: response.locals.requestId })
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const input = comparisonReportInput.parse(request.body)
    const [rows] = await database.query<DatabaseRow[]>(`SELECT sp.student_name studentName,p.name province,sp.subject_group subjectGroup
      FROM student_profiles sp JOIN provinces p ON p.id=sp.province_id WHERE sp.id=?`, [profileId])
    if (!rows[0]) { fail(404, '学生档案不存在'); return }
    const profile: ComparisonProfile = { studentName: String(rows[0].studentName), province: String(rows[0].province), subjectGroup: String(rows[0].subjectGroup) }
    const generatedAt = new Date().toISOString()
    let html: string
    if (input.kind === 'major') {
      const context = await loadExplorationProfile(profileId, new Date().getFullYear())
      if (!context) { fail(404, '学生档案不存在'); return }
      const details = await Promise.all(input.ids.map(id => loadExplorationDetail(database, context, id)))
      if (details.some(detail => detail === null)) { fail(404, '所选专业不存在，请重新选择'); return }
      html = renderMajorComparisonReport(profile, details.filter(detail => detail !== null), generatedAt)
    } else {
      const details = await Promise.all(input.ids.map(id => loadSchoolDetail(id, profileId)))
      const [saved] = await database.query<DatabaseRow[]>(`SELECT item_id itemId,note FROM profile_saved_items
        WHERE profile_id=? AND item_type='school' AND state='target' AND item_id IN (${input.ids.map(() => '?').join(',')})`, [profileId, ...input.ids])
      const notes = new Map(saved.map(item => [Number(item.itemId), item.note == null ? null : String(item.note)]))
      html = renderSchoolComparisonReport(profile, details, notes, generatedAt)
    }
    const pdf = await renderPdf(html, true)
    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Content-Disposition', `attachment; filename="zhixiang-${input.kind}-comparison-${profileId.slice(0, 8)}.pdf"`)
    response.setHeader('Cache-Control', 'no-store')
    response.send(pdf)
  } catch (error) {
    if (error instanceof SchoolDetailLookupError) { fail(error.status, error.message); return }
    if (error instanceof z.ZodError) { fail(422, '请选择 2—3 个专业或 2—4 所不同院校，并检查档案和对象标识'); return }
    // Do not expose renderer diagnostics, DB errors or any profile text in logs.
    fail(503, '对比 PDF 生成失败，请稍后重试；当前选择仍保留')
  }
})
