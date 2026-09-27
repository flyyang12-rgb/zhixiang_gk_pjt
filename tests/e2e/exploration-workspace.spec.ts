import { test, expect } from './fixtures/exploration-data'
import type { Page } from '@playwright/test'

async function openProfile(page: Page, id: string) {
  await page.goto('/')
  await page.evaluate(value => localStorage.setItem('zhixiang.currentProfileId', value), id)
  await page.reload()
  await expect(page.locator('.exploration-workspace')).toBeVisible()
}

const input = { studentName: '合成探索浏览器测试', province: '河南', subjectGroup: '物理类',
  selectedSubjects: ['物理', '化学', '生物'], score: null, provinceRank: null, planningMode: 'exploration' }

test('默认无成绩建档进入九项探索清单，未知条件不显示评分分档', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('radio', { name: /目标探索/ })).toBeChecked()
  await expect(page.locator('input[type=number]')).toHaveCount(0)
  await page.getByPlaceholder('例如：小知').fill(input.studentName)
  await page.locator('select').nth(1).selectOption({ label: '物理类' })
  await page.locator('.subject-picker button', { hasText: '化学' }).click()
  await page.locator('.subject-picker button', { hasText: '生物' }).click()
  await page.getByRole('button', { name: /保存并/ }).click()
  const workspace = page.locator('.exploration-workspace')
  await expect(workspace).toBeVisible()
  await expect(workspace.locator('.exploration-row')).toHaveCount(9)
  await expect(workspace).toContainText('已审核资料 12 个专业')
  await expect(workspace).toContainText('完整条目 12 个')
  await expect(workspace).toContainText('选科要求待核验')
  await expect(workspace).not.toContainText(/综合参考分|优先了解|值得比较|谨慎报考|适合你/)
  await expect(page.locator('.school-recommendation-empty,.admission-layer,.profession-bands')).toHaveCount(0)
  await expect(page.getByText(/霍兰德|性格答题|双视角|家庭偏好/)).toHaveCount(0)
  const id = await page.evaluate(() => localStorage.getItem('zhixiang.currentProfileId'))
  expect(id).toBeTruthy()
  const profile = (await (await request.get(`/api/profiles/${id}`)).json()).data
  expect(profile).toMatchObject({ score: null, provinceRank: null, planningMode: 'exploration' })
  expect((await (await request.get(`/api/profiles/${id}/score-snapshots`)).json()).data).toEqual([])
  expect((await request.get('/api/assessments/questions/student')).status()).toBe(404)
  expect(errors).toEqual([])
})

test('目录第2页详情返回保留筛选分页和焦点，资料待补不等于不存在', async ({ page, createProfile }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  await openProfile(page, id)
  await page.getByRole('combobox', { name: '专业类别', exact: true }).selectOption({ label: '合成测试类别' })
  await page.getByRole('button', { name: '查阅目录', exact: true }).click()
  const pagination = page.getByRole('navigation', { name: '专业目录分页' })
  await expect(pagination).toContainText('第 1 / 2 页')
  await pagination.getByRole('button', { name: '下一页' }).click()
  await expect(pagination).toContainText('第 2 / 2 页')
  const trigger = page.getByRole('button', { name: '查看 合成专业12 专业详情', exact: true })
  await trigger.click()
  const detail = page.locator('.exploration-detail')
  await expect(detail).toContainText('合成课程12')
  await expect(detail).toContainText('合成探索学院')
  await expect(detail).toContainText('2025')
  await detail.locator('.learning-source').first().locator('summary').click()
  await expect(detail).toContainText('合成章节 > 培养安排')
  await expect(detail.getByRole('link').first()).toHaveAttribute('href', 'https://example.edu/test-plan#courses')
  await page.keyboard.press('Escape')
  await expect(pagination).toContainText('第 2 / 2 页')
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('combobox', { name: '专业类别', exact: true })).toHaveValue('合成测试类别')
  await page.getByRole('button', { name: '返回探索清单 / 清除筛选', exact: true }).click()
  await expect(page.locator('.exploration-row')).toHaveCount(9)
  await expect(page.getByRole('combobox', { name: '专业类别', exact: true })).toHaveValue('')
  await page.getByLabel('按专业名称查阅').fill('计算机科学与技术')
  await page.getByRole('button', { name: '查阅目录', exact: true }).click()
  await expect(page.locator('.exploration-row')).toHaveCount(1)
  await expect(page.locator('.exploration-row')).toContainText('资料待补充')
  await page.getByRole('button', { name: '查看 计算机科学与技术 专业详情', exact: true }).click()
  await expect(detail).toContainText('课程材料待补充')
  await expect(detail).toContainText('未知不表示不限')
})

test('首屏外专业的收藏备注刷新持久化，排除和恢复不覆盖，改名撤回仍按ID访问', async ({ page, createProfile, request, explorationData }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  const { client, runtime } = explorationData
  const major = runtime.majors[11]!
  await openProfile(page, id)
  await page.getByLabel('按专业名称查阅').fill(major.name)
  await page.getByRole('button', { name: '查阅目录', exact: true }).click()
  await page.getByRole('button', { name: `查看 ${major.name} 专业详情`, exact: true }).click()
  const detail = page.locator('.exploration-detail')
  await detail.getByRole('button', { name: '关注专业', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已关注' })).toContainText(input.studentName)
  await expect(page.getByRole('dialog', { name: '收藏成功' })).toContainText(major.name)
  await page.keyboard.press('Escape')
  const note = '  我想核对实际项目安排，\n父母关心培养费用。\n '
  await detail.getByLabel(`${major.name} 家庭讨论备注`, { exact: true }).fill(note)
  await detail.getByRole('button', { name: '保存家庭备注', exact: true }).click()
  await expect(detail).toContainText('家庭备注已保存')
  await detail.getByRole('button', { name: '暂时排除专业', exact: true }).click()
  await expect(detail.getByLabel(`${major.name} 家庭讨论备注`, { exact: true })).toHaveValue(note)
  await detail.getByRole('button', { name: '恢复并关注', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '收藏成功' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(detail.getByLabel(`${major.name} 家庭讨论备注`, { exact: true })).toHaveValue(note)
  await page.reload()
  await page.getByRole('button', { name: /我的收藏/ }).click()
  const collection = page.getByRole('dialog', { name: '我的收藏' })
  await expect(collection).toContainText(note)
  await collection.getByRole('button', { name: `查看收藏专业 ${major.name} 详情`, exact: true }).click()
  await expect(detail).toContainText(major.name)
  try {
    await client.query('UPDATE majors SET name=$2 WHERE id=$1', [major.id, '合成专业12修订名称'])
    await client.query("UPDATE learning_content_batches SET status='withdrawn',withdrawn_at=NOW(),withdrawal_reason='本次合成撤回测试' WHERE id=$1", [major.batchId])
    await detail.getByRole('button', { name: '刷新当前材料', exact: true }).click()
    await expect(detail).toContainText('合成专业12修订名称')
    await expect(detail).not.toContainText('合成课程12')
    await expect(detail).toContainText('已撤回')
    await expect(detail.getByLabel('合成专业12修订名称 家庭讨论备注', { exact: true })).toHaveValue(note)
    await expect(detail.getByRole('button', { name: '问顾问：学习或职业问题', exact: true })).toBeEnabled()
    const saved = (await (await request.get(`/api/profiles/${id}/profession-dashboard`)).json()).data.savedItems
    expect(saved.find((item: { itemType: string; itemId: number }) => item.itemType === 'major' && item.itemId === major.id)).toMatchObject({ state: 'saved', note })
  } finally {
    await client.query('UPDATE majors SET name=$2 WHERE id=$1', [major.id, major.name])
    await client.query("UPDATE learning_content_batches SET status='active',withdrawn_at=NULL,withdrawal_reason=NULL WHERE id=$1", [major.batchId])
  }
})

test('网络失败保留可重试入口，手机学校抽屉和收藏关闭恢复焦点', async ({ page, createProfile }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  await page.setViewportSize({ width: 390, height: 844 })
  await openProfile(page, id)
  let fail = true
  await page.getByRole('combobox', { name: '专业类别', exact: true }).selectOption({ label: '合成测试类别' })
  await page.route('**/major-exploration/catalog?**', async route => {
    if (fail) { fail = false; await route.abort('failed') }
    else await route.continue()
  })
  await page.getByRole('button', { name: '查阅目录', exact: true }).click()
  await expect(page.getByRole('button', { name: '重试目录', exact: true })).toBeVisible()
  await expect(page.locator('.exploration-error')).toContainText('目录加载失败')
  await page.getByRole('button', { name: '重试目录', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '专业目录分页' })).toContainText('共 12 项')
  await page.getByRole('button', { name: '查看 合成专业01 专业详情', exact: true }).click()
  const detail = page.locator('.exploration-detail')
  await expect(detail).toContainText('以下是学习知识或大学课程条件，不是高考选科资格')
  await expect(detail).toContainText('须全部选择 物理、化学')
  await expect(detail).toContainText('2026 年招生')
  const school = detail.getByRole('button', { name: /合成探索学院/ })
  await school.click()
  await expect(page.getByRole('dialog', { name: '学校详情' })).toBeVisible()
  await page.getByRole('dialog', { name: '学校详情' }).getByRole('button', { name: '☆ 收藏学校', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '学校详情' })).toContainText(input.studentName)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '学校详情' })).toHaveCount(0)
  await expect(detail).toBeVisible()
  await expect(school).toBeFocused()
  const collectionTrigger = page.getByRole('button', { name: /我的收藏/ })
  await collectionTrigger.click()
  await expect(page.getByRole('dialog', { name: '我的收藏' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '我的收藏' })).toContainText('合成探索学院')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '我的收藏' })).toHaveCount(0)
  await expect(collectionTrigger).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '.scratch/exploration-first/exploration-mobile.png', fullPage: true })
})

test('删除本次当前档案后二次建档仍默认探索且不要求成绩', async ({ page, createProfile, request }) => {
  const name = `${input.studentName}-删除回归`
  const id = (await (await createProfile({ data: { ...input, studentName: name } })).json()).data.id
  await openProfile(page, id)
  await page.getByRole('button', { name: '↻ 历史档案', exact: true }).click()
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain(name)
    await dialog.accept()
  })
  await page.getByRole('button', { name: `删除 ${name} 未记录分数档案`, exact: true }).click()
  await expect(page.getByRole('heading', { name: '先建立一份学生档案', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: /目标探索/ })).toBeChecked()
  await expect(page.locator('input[type=number]')).toHaveCount(0)
  expect((await request.get(`/api/profiles/${id}`)).status()).toBe(404)
})

test('新增可靠位次自动进入招生比较，首屏外收藏仍可读取学习详情和原始备注', async ({ page, createProfile, request, explorationData }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  const major = explorationData.runtime.majors[11]!
  expect((await request.put(`/api/profiles/${id}/saved-items`, { data: { itemType: 'major', itemId: major.id, state: 'saved', note: '新增位次前的家庭讨论' } })).ok()).toBe(true)
  await openProfile(page, id)
  await page.locator('.exploration-score-section summary').click()
  await page.getByRole('button', { name: '记一次模考', exact: true }).click()
  const form = page.locator('.score-form')
  await form.getByLabel('考试名称', { exact: true }).fill('合成全省联考')
  await form.getByLabel('分数', { exact: true }).fill('600')
  await form.getByLabel('全省位次（联考/统考）', { exact: true }).fill('10000')
  await form.getByRole('button', { name: '保存为当前坐标', exact: true }).click()
  await expect(page.locator('.admission-layer')).toBeVisible()
  await expect(page.locator('.score-orbit')).toContainText('600')
  await page.getByRole('button', { name: /我的收藏/ }).click()
  await page.getByRole('dialog', { name: '我的收藏' }).getByRole('button', { name: `查看收藏专业 ${major.name} 详情`, exact: true }).click()
  const detail = page.locator('.exploration-detail')
  await expect(detail).toContainText('合成课程12')
  await expect(detail.getByLabel(`${major.name} 家庭讨论备注`, { exact: true })).toHaveValue('新增位次前的家庭讨论')
  await expect(page.locator('.exploration-workspace')).not.toContainText('当前没有可靠全省位次')
  const dashboard = (await (await request.get(`/api/profiles/${id}/profession-dashboard`)).json()).data
  expect(dashboard).toMatchObject({ mode: 'application', profileSummary: { planningMode: 'exploration' }, planningCoordinate: { rank: 10000 } })
})

test('保存备注的迟到响应只更新原专业，切到另一专业不串备注和关注状态', async ({ page, createProfile, request, explorationData }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  const [first, second] = explorationData.runtime.majors
  for (const [major, state, note] of [[first!, 'saved', '原始备注A'], [second!, 'excluded', '原始备注B']] as const) {
    expect((await request.put(`/api/profiles/${id}/saved-items`, { data: { itemType: 'major', itemId: major.id, state, note } })).ok()).toBe(true)
  }
  await openProfile(page, id)
  await page.getByRole('button', { name: `查看 ${first!.name} 专业详情`, exact: true }).click()
  const detail = page.locator('.exploration-detail')
  await detail.getByLabel(`${first!.name} 家庭讨论备注`, { exact: true }).fill('新备注A')
  let start!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { start = resolve })
  const released = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/profiles/${id}/saved-items/major/${first!.id}/note`, async route => {
    start(); await released; await route.continue()
  })
  try {
    await detail.getByRole('button', { name: '保存家庭备注', exact: true }).click()
    await started
    await detail.getByRole('button', { name: '← 返回探索清单', exact: true }).click()
    await page.getByLabel('按专业名称查阅').fill(second!.name)
    await page.getByRole('button', { name: '查阅目录', exact: true }).click()
    await page.getByRole('button', { name: `查看 ${second!.name} 专业详情`, exact: true }).click()
    await expect(detail.getByLabel(`${second!.name} 家庭讨论备注`, { exact: true })).toHaveValue('原始备注B')
    const completed = page.waitForResponse(response => response.url().endsWith(`/saved-items/major/${first!.id}/note`) && response.request().method() === 'PATCH')
    release(); await completed
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(detail.getByLabel(`${second!.name} 家庭讨论备注`, { exact: true })).toHaveValue('原始备注B')
    const saved = (await (await request.get(`/api/profiles/${id}/profession-dashboard`)).json()).data.savedItems
    expect(saved.find((item: { itemType: string; itemId: number }) => item.itemType === 'major' && item.itemId === first!.id)).toMatchObject({ state: 'saved', note: '新备注A' })
    expect(saved.find((item: { itemType: string; itemId: number }) => item.itemType === 'major' && item.itemId === second!.id)).toMatchObject({ state: 'excluded', note: '原始备注B' })
    await detail.getByRole('button', { name: '← 返回目录', exact: true }).click()
    await page.getByLabel('按专业名称查阅').fill(first!.name)
    await page.getByRole('button', { name: '查阅目录', exact: true }).click()
    await page.getByRole('button', { name: `查看 ${first!.name} 专业详情`, exact: true }).click()
    await expect(detail.getByRole('button', { name: '取消关注', exact: true })).toBeVisible()
    await expect(detail.getByLabel(`${first!.name} 家庭讨论备注`, { exact: true })).toHaveValue('新备注A')
  } finally { release() }
})

test('保存期间继续输入的备注草稿保留，明确提示新修改尚未保存', async ({ page, createProfile, request, explorationData }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  const major = explorationData.runtime.majors[0]!
  await request.put(`/api/profiles/${id}/saved-items`, { data: { itemType: 'major', itemId: major.id, state: 'saved', note: '原备注' } })
  await openProfile(page, id)
  await page.getByRole('button', { name: `查看 ${major.name} 专业详情`, exact: true }).click()
  const detail = page.locator('.exploration-detail')
  const field = detail.getByLabel(`${major.name} 家庭讨论备注`, { exact: true })
  const submitted = '  已提交备注\n '
  const newer = `${submitted}保存期间继续输入的新文字`
  await field.fill(submitted)
  let start!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { start = resolve })
  const released = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/profiles/${id}/saved-items/major/${major.id}/note`, async route => {
    start(); await released; await route.continue()
  }, { times: 1 })
  try {
    await detail.getByRole('button', { name: '保存家庭备注', exact: true }).click()
    await started
    await field.fill(newer)
    const completed = page.waitForResponse(response => response.url().endsWith(`/saved-items/major/${major.id}/note`) && response.request().method() === 'PATCH')
    release(); await completed
    await expect(detail).toContainText('当前修改尚未保存')
    await expect(field).toHaveValue(newer)
    const stored = (await (await request.get(`/api/profiles/${id}/profession-dashboard`)).json()).data.savedItems
    expect(stored.find((item: { itemId: number }) => item.itemId === major.id).note).toBe(submitted)
    await detail.getByRole('button', { name: '保存家庭备注', exact: true }).click()
    await expect(detail).toContainText('家庭备注已保存')
    await detail.getByRole('button', { name: '刷新当前材料', exact: true }).click()
    await expect(field).toHaveValue(newer)
  } finally { release() }
})
