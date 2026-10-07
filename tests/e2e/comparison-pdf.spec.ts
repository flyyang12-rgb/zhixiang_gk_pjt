import { expect, test, type Page } from '@playwright/test'
import { comparisonDashboard, comparisonMajor, comparisonSchool, comparisonProfileId } from '../fixtures/comparison'
import { renderMajorComparisonReport, renderSchoolComparisonReport } from '../../server/comparison-report-template'
import { renderPdf } from '../../server/pdf-renderer'
test.use({ video: 'on' })
let majorPdf: Buffer, schoolPdf: Buffer
test.beforeAll(async () => {
  const profile = comparisonDashboard().profileSummary, at = '2026-10-07T00:00:00Z'
  majorPdf = await renderPdf(renderMajorComparisonReport(profile, [comparisonMajor(1), comparisonMajor(2)], at), true)
  schoolPdf = await renderPdf(renderSchoolComparisonReport(profile, [comparisonSchool(1), comparisonSchool(2)], new Map(), at), true)
})
async function setup(page: Page) {
  const dashboard = comparisonDashboard()
  const state = { pdfError: false, invalidPdf: false, removeError: false, noteError: false, pending: false, requests: [] as unknown[], releasePdf: null as (() => void) | null, holdPdf: false }
  const success = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data, error: null }) })
  await page.addInitScript(id => localStorage.setItem('zhixiang.currentProfileId', id), comparisonProfileId)
  // No request can reach a live database; every API, including unknown ones, is intercepted.
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (path.endsWith('/comparison.pdf')) {
      state.requests.push(request.postDataJSON())
      if (state.holdPdf) await new Promise<void>(resolve => { state.releasePdf = resolve })
      if (state.pdfError) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, data: null, error: '对比 PDF 生成失败，请稍后重试；当前选择仍保留' }) })
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: state.invalidPdf ? Buffer.from('invalid bytes') : request.postDataJSON().kind === 'major' ? majorPdf : schoolPdf })
    }
    if (path.endsWith('/admin/data-status')) return route.fulfill(success({ coverage: [], yearStatus: [] }))
    if (path === `/api/profiles/${comparisonProfileId}`) return route.fulfill(success({ id: comparisonProfileId, ...dashboard.profileSummary, selectedSubjects: ['物理', '化学', '生物'], currentStage: 'recommendation', updatedAt: '2026-10-07T00:00:00Z' }))
    if (path.endsWith('/profession-dashboard')) return route.fulfill(success(dashboard))
    if (path.endsWith('/major-exploration/catalog')) return route.fulfill(success({ ...dashboard.exploration, items: dashboard.exploration!.cards, total: 3, page: 1, pageSize: 9, categories: ['工学', '理学', '文学'] }))
    if (/\/major-exploration\/\d+$/.test(path)) { const detail = comparisonMajor(Number(path.split('/').at(-1))); if (state.pending) detail.status = 'unavailable'; return route.fulfill(success(detail)) }
    if (/\/schools\/\d+$/.test(path)) return route.fulfill(success(comparisonSchool(Number(path.split('/').at(-1)))))
    if (path.endsWith('/advisor/comparison')) return route.fulfill(success({ mode: 'local', content: '现在能确定：当前学校信息可供核对。\n还不能确定：当年招生与培养成本仍有缺口。\n下一步只做：核对当年招生章程。' }))
    if (path.includes('/saved-items/') && request.method() === 'DELETE') {
      if (state.removeError) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: '收藏移除失败，请重试' }) })
      const id = Number(path.split('/').at(-1)); dashboard.savedItems = dashboard.savedItems.filter(item => !(item.itemType === 'school' && item.itemId === id)); return route.fulfill(success({ itemType: 'school', itemId: id }))
    }
    if (path.endsWith('/note')) {
      if (state.noteError) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: '备注保存失败，请重试' }) })
      const id = Number(path.split('/').at(-2)), note = request.postDataJSON().note
      dashboard.savedItems.find(item => item.itemType === 'major' && item.itemId === id)!.note = note
      return route.fulfill(success({ itemType: 'major', itemId: id, note }))
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'mock-only test' }) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /我的收藏/ }).click()
  await expect(page.getByRole('dialog', { name: '我的收藏', exact: true })).toBeVisible()
  return state
}
async function majorCompare(page: Page) {
  const dialog = page.getByRole('dialog', { name: '我的收藏', exact: true })
  for (const id of [1, 2]) await dialog.getByRole('checkbox', { name: `选择 ${comparisonMajor(id).identity.name} 参与专业比较或简报` }).check()
  await dialog.getByRole('button', { name: '比较已选专业', exact: true }).click()
  await expect(dialog.getByRole('region', { name: '专业比较', exact: true })).toContainText('合成测试课程')
  return dialog
}
test('专业比较导出失败保留选择、生成反馈及有效下载，刷新不沿用撤回材料', async ({ page }, info) => {
  const state = await setup(page), dialog = await majorCompare(page)
  state.pdfError = true
  await dialog.getByRole('button', { name: '导出对比 PDF', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('当前选择仍保留')
  await expect(dialog.getByRole('columnheader')).toHaveCount(3)
  state.pdfError = false; state.holdPdf = true
  await dialog.getByRole('button', { name: '导出对比 PDF', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '正在生成 PDF…', exact: true })).toBeDisabled()
  await expect.poll(() => state.releasePdf !== null).toBe(true)
  const downloading = page.waitForEvent('download'); state.releasePdf!()
  const download = await downloading; expect(download.suggestedFilename()).toContain('专业对比'); await download.saveAs(info.outputPath('major-comparison.pdf'))
  await expect(dialog.getByRole('status')).toContainText('PDF 已下载')
  expect(state.requests).toEqual([{ kind: 'major', ids: [1, 2] }, { kind: 'major', ids: [1, 2] }])
  state.pending = true; await dialog.getByRole('button', { name: '刷新比较材料' }).click()
  await expect(dialog).toContainText('资料需重新核验'); await expect(dialog).not.toContainText('合成测试课程')
})
test('学校对比可导出，移除失败保持原对象与当前比较，成功后回收藏', async ({ page }, info) => {
  const state = await setup(page), dialog = page.getByRole('dialog', { name: '我的收藏' })
  for (const id of [1, 2]) await dialog.getByRole('checkbox', { name: `选择 ${comparisonSchool(id).school.name} 参与比较`, exact: true }).check()
  await dialog.getByRole('button', { name: '比较已选 2 所', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: '院校对比' })).toBeVisible()
  await expect(dialog).toContainText('未知不表示不限')
  const downloading = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出对比 PDF' }).click()
  await (await downloading).saveAs(info.outputPath('school-comparison.pdf')); expect(state.requests).toEqual([{ kind: 'school', ids: [1, 2] }])
  await page.keyboard.press('Escape'); await expect(dialog.getByRole('button', { name: '比较已选 2 所', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: '比较已选 2 所', exact: true }).click()
  await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBe(0)
  state.removeError = true; await dialog.getByRole('button', { name: '移出收藏', exact: true }).first().click()
  await expect(dialog).toContainText('收藏移除失败'); await expect(dialog.locator('.school-comparison-column')).toHaveCount(2)
  state.removeError = false; await dialog.getByRole('button', { name: '移出收藏', exact: true }).first().click()
  await expect(dialog.getByRole('heading', { name: '家庭讨论 的收藏' })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: '选择 合成探索学院 参与比较', exact: true })).toHaveCount(0)
})
test('收藏备注保存失败保留草稿，成功后刷新仍读取；手机比较可滚动且键盘返回恢复焦点', async ({ page }, info) => {
  const state = await setup(page), dialog = page.getByRole('dialog', { name: '我的收藏' })
  await dialog.getByRole('button', { name: '编辑 计算机科学与技术 家庭备注' }).click()
  const note = dialog.getByRole('textbox', { name: '计算机科学与技术 家庭讨论备注' })
  await note.fill('先阅读课程，再核对住宿费用。')
  state.noteError = true; await dialog.getByRole('button', { name: '保存备注', exact: true }).click()
  await expect(dialog).toContainText('备注保存失败'); await expect(note).toHaveValue('先阅读课程，再核对住宿费用。')
  state.noteError = false; await dialog.getByRole('button', { name: '保存备注', exact: true }).click(); await expect(note).toHaveCount(0)
  await page.reload(); await page.getByRole('button', { name: /我的收藏/ }).click(); await expect(dialog).toContainText('先阅读课程，再核对住宿费用。')
  await page.setViewportSize({ width: 390, height: 844 }); await majorCompare(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const table = dialog.getByRole('region', { name: '可横向滚动的专业比较表' })
  await table.evaluate(element => { element.scrollLeft = element.scrollWidth })
  await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(100)
  await page.screenshot({ path: info.outputPath('mobile-comparison.png') })
  await page.keyboard.press('Escape'); await expect(dialog.getByRole('button', { name: '比较已选专业', exact: true })).toBeFocused()
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: /我的收藏/ })).toBeFocused()
})
test('下载内容无效时不显示成功，减少动态效果保持静态反馈', async ({ page }) => {
  const state = await setup(page), dialog = await majorCompare(page)
  state.invalidPdf = true; await page.emulateMedia({ reducedMotion: 'reduce' })
  await dialog.getByRole('button', { name: '导出对比 PDF' }).click()
  await expect(dialog.getByRole('alert')).toContainText('不是有效 PDF'); await expect(dialog).not.toContainText('PDF 已下载')
})
