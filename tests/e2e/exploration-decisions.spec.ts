import { randomUUID } from 'node:crypto'
import { test, expect } from './fixtures/exploration-data'
import type { Page } from '@playwright/test'

const input = { studentName: '合成比较顾问浏览器测试', province: '河南', subjectGroup: '物理类',
  selectedSubjects: ['物理', '化学', '生物'], score: null, provinceRank: null, planningMode: 'exploration' }
async function openProfile(page: Page, id: string) {
  await page.goto('/')
  await page.evaluate(value => localStorage.setItem('zhixiang.currentProfileId', value), id)
  await page.reload()
  await expect(page.locator('.exploration-workspace')).toBeVisible()
}

test('收藏专业数量限制、当前材料比较、复制失败与手机简报，重新生成刷新模式和撤回', async ({ page, createProfile, request, explorationData }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  const { client, runtime } = explorationData
  const majors = [runtime.majors[9]!, runtime.majors[10]!, runtime.majors[11]!, runtime.majors[0]!]
  const note = '  家庭原始备注\n想核对课程项目和学习成本。\n '
  for (const major of majors) expect((await request.put(`/api/profiles/${id}/saved-items`, {
    data: { itemType: 'major', itemId: major.id, state: 'saved', note },
  })).ok()).toBe(true)
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async () => { throw new Error('synthetic denied') } } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await openProfile(page, id)
  const currentDashboard = (await (await request.get(`/api/profiles/${id}/profession-dashboard`)).json()).data
  expect(currentDashboard.employment.usable).toBe(false)
  expect(currentDashboard.employment.staleDays).toBeGreaterThan(7)
  await page.getByRole('button', { name: /我的收藏/ }).click()
  const collection = page.getByRole('dialog', { name: '我的收藏' })
  await expect(collection.getByRole('button', { name: '比较已选专业', exact: true })).toBeDisabled()
  for (const major of majors.slice(0, 3)) await collection.getByRole('checkbox', { name: `选择 ${major.name} 参与专业比较或简报`, exact: true }).check()
  await expect(collection.getByRole('checkbox', { name: `选择 ${majors[3]!.name} 参与专业比较或简报`, exact: true })).toBeDisabled()
  await page.route(`**/api/profiles/${id}/major-exploration/${majors[0]!.id}`, route => route.abort('failed'), { times: 1 })
  await collection.getByRole('button', { name: '比较已选专业', exact: true }).click()
  const comparison = collection.getByRole('region', { name: '专业比较', exact: true })
  await expect(comparison).toContainText('失败')
  await expect(comparison).not.toContainText('合成课程10')
  await comparison.getByRole('button', { name: '刷新比较材料', exact: true }).click()
  await expect(comparison).toContainText('合成课程10')
  await expect(comparison).toContainText('合成课程12')
  await expect(comparison).toContainText('合成探索学院')
  await expect(comparison).toContainText('2025')
  const firstControl = collection.getByRole('button', { name: '关闭收藏弹窗', exact: true })
  await firstControl.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(comparison.locator('summary').last()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(firstControl).toBeFocused()
  await comparison.locator('details summary').first().click()
  await expect(comparison.getByRole('link').first()).toHaveAttribute('href', 'https://example.edu/test-plan#courses')
  await comparison.getByRole('button', { name: /返回收藏/ }).click()
  const briefTrigger = collection.getByRole('button', { name: '生成专业探索简报', exact: true })
  await briefTrigger.click()
  const brief = collection.getByRole('region', { name: '专业探索简报', exact: true })
  await expect(brief).toContainText('合成课程12')
  await brief.getByRole('button', { name: '复制专业简报', exact: true }).click()
  await expect(brief).toContainText('复制失败')
  const text = brief.getByRole('textbox', { name: '专业简报纯文本', exact: true })
  await expect(text).toBeVisible()
  expect(await text.inputValue()).toContain(note)
  expect(await text.inputValue()).toContain('https://example.edu/test-plan#courses')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const rankResponse = await request.post(`/api/profiles/${id}/score-snapshots`, {
    data: { examName: '合成简报模式刷新考试', examDate: '2026-09-26', score: 600, provinceRank: 10000 },
  })
  expect(rankResponse.ok()).toBe(true)
  try {
    await client.query("UPDATE learning_content_batches SET status='withdrawn',withdrawn_at=NOW(),withdrawal_reason='本次合成简报撤回验证' WHERE id=$1", [majors[2]!.batchId])
    await brief.getByRole('button', { name: '重新生成专业简报', exact: true }).click()
    await expect(brief).not.toContainText('合成课程12')
    await expect(brief).toContainText('已撤回')
    await expect(brief).not.toContainText('暂无可靠位次')
    await expect(brief).not.toContainText('暂未形成可靠位次')
    await brief.getByRole('button', { name: '复制专业简报', exact: true }).click()
    expect(await text.inputValue()).toContain(note)
    expect(await text.inputValue()).not.toContain('合成课程12')
    await brief.getByRole('button', { name: /返回收藏/ }).click()
    await expect(briefTrigger).toBeFocused()
    await collection.getByRole('button', { name: '比较已选专业', exact: true }).click()
    await expect(comparison).not.toContainText('合成课程12')
    await expect(comparison).toContainText('已撤回')
  } finally {
    await client.query("UPDATE learning_content_batches SET status='active',withdrawn_at=NULL,withdrawal_reason=NULL WHERE id=$1", [majors[2]!.batchId])
  }
})

test('专业简报复制成功与既有学校比较学校简报回归', async ({ page, createProfile, request, explorationData }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  const { runtime } = explorationData
  const major = runtime.majors[11]!
  for (const schoolId of [runtime.schoolId, runtime.secondSchoolId]) {
    expect((await request.put(`/api/profiles/${id}/saved-items`, { data: { itemType: 'school', itemId: schoolId, state: 'target', note: '合成学校家庭备注' } })).ok()).toBe(true)
  }
  await request.put(`/api/profiles/${id}/saved-items`, { data: { itemType: 'major', itemId: major.id, state: 'saved', note: '合成专业原始备注' } })
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async (value: string) => { (window as unknown as { copiedText: string }).copiedText = value } } }))
  await openProfile(page, id)
  await page.getByRole('button', { name: /我的收藏/ }).click()
  const collection = page.getByRole('dialog', { name: '我的收藏' })
  await collection.getByRole('checkbox', { name: `选择 ${major.name} 参与专业比较或简报`, exact: true }).check()
  await expect(collection.getByRole('button', { name: '比较已选专业', exact: true })).toBeDisabled()
  await collection.getByRole('button', { name: '生成专业探索简报', exact: true }).click()
  const brief = collection.getByRole('region', { name: '专业探索简报', exact: true })
  await brief.getByRole('button', { name: '复制专业简报', exact: true }).click()
  await expect(brief).toContainText('已复制')
  expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toContain('合成专业原始备注')
  await brief.getByRole('button', { name: /返回收藏/ }).click()
  await collection.getByRole('checkbox', { name: '选择 合成探索学院 参与比较', exact: true }).check()
  await collection.getByRole('checkbox', { name: '选择 合成比较学院 参与比较', exact: true }).check()
  await collection.getByRole('button', { name: '比较已选 2 所', exact: true }).click()
  await expect(collection).toContainText('院校对比')
  await expect(collection.locator('.school-comparison-column')).toHaveCount(2)
  await expect(collection).toContainText('本地规则分析')
  await collection.getByRole('button', { name: '← 返回收藏', exact: true }).click()
  const schoolBriefTrigger = collection.getByRole('button', { name: '给爸妈看 (2)', exact: true })
  await schoolBriefTrigger.click()
  const schoolBrief = page.getByRole('dialog', { name: '给爸妈看的学校简报', exact: true })
  await expect(schoolBrief).toContainText('合成学校家庭备注')
  await schoolBrief.getByRole('button', { name: '复制纯文本', exact: true }).click()
  await expect(schoolBrief).toContainText('已复制')
  await page.keyboard.press('Escape')
  await expect(schoolBrief).toHaveCount(0)
  await expect(schoolBriefTrigger).toBeFocused()
})

test('首屏外专业顾问只预填，首次发送持久化，撤回后当轮不引用旧事实', async ({ page, createProfile, request, explorationData }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  const { client, runtime } = explorationData
  const major = runtime.majors[11]!
  await request.put(`/api/profiles/${id}/saved-items`, { data: { itemType: 'major', itemId: major.id, state: 'saved', note: '家庭关注课程项目' } })
  await openProfile(page, id)
  await page.getByRole('button', { name: /我的收藏/ }).click()
  await page.getByRole('dialog', { name: '我的收藏' }).getByRole('button', { name: `查看收藏专业 ${major.name} 详情`, exact: true }).click()
  await page.locator('.exploration-detail').getByRole('button', { name: '问顾问：学习或职业问题', exact: true }).click()
  const field = page.getByRole('textbox', { name: '继续问升学规划顾问', exact: true })
  await expect(field).toHaveValue(/学习|课程/)
  expect((await (await request.get(`/api/profiles/${id}/advisor/conversations`)).json()).data.total).toBe(0)
  await field.fill('请解释这个专业当前课程，哪些还不能确定？')
  await page.getByRole('button', { name: '发送 →', exact: true }).click()
  await expect(page.locator('.message.assistant')).toHaveCount(1)
  await expect(page.locator('.message.assistant')).toContainText('合成课程12')
  await expect(page.locator('.message.assistant')).toContainText('还不能确定')
  let history = (await (await request.get(`/api/profiles/${id}/advisor/conversations`)).json()).data
  expect(history.total).toBe(1)
  expect(history.items[0].focus).toMatchObject({ type: 'major', majorId: major.id, majorName: major.name })
  try {
    await client.query("UPDATE learning_content_batches SET status='withdrawn',withdrawn_at=NOW(),withdrawal_reason='本次合成顾问撤回验证' WHERE id=$1", [major.batchId])
    await field.fill('刚才提到的课程现在还有可核验材料吗？')
    await page.getByRole('button', { name: '发送 →', exact: true }).click()
    await expect(page.locator('.message.assistant')).toHaveCount(2)
    const current = page.locator('.message.assistant').last()
    await expect(current).toContainText('撤回')
    await expect(current).not.toContainText('合成课程12')
    await expect(current.locator('.evidence-refs')).toHaveCount(0)
    history = (await (await request.get(`/api/profiles/${id}/advisor/conversations`)).json()).data
    const messages = (await (await request.get(`/api/profiles/${id}/advisor/conversations/${history.items[0].id}/messages`)).json()).data.items
    expect(messages.at(-1).content).not.toContain('合成课程12')
  } finally {
    await client.query("UPDATE learning_content_batches SET status='active',withdrawn_at=NULL,withdrawal_reason=NULL WHERE id=$1", [major.batchId])
  }
})

test('顾问不存在ID和未收藏待补专业不创建焦点会话，收藏后解释缺口和普通问候', async ({ createProfile, request, explorationData }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  const url = `/api/profiles/${id}/advisor/conversations`
  const invalid = await request.post(url, { data: { initialMessage: '请解释课程', clientMessageId: randomUUID(), focus: { type: 'major', majorId: 2147483647 } } })
  expect(invalid.status()).toBe(404)
  expect((await (await request.get(url)).json()).data.total).toBe(0)
  const major = (await explorationData.client.query("SELECT id FROM majors WHERE code='080901'")).rows[0]
  const pendingInput = { initialMessage: '这个专业课程和学习方式有哪些可靠资料？', clientMessageId: randomUUID(), focus: { type: 'major', majorId: Number(major.id) } }
  const pending = await request.post(url, { data: pendingInput })
  expect(pending.status()).toBe(422)
  expect((await pending.json()).error).toContain('待补')
  expect((await (await request.get(url)).json()).data.total).toBe(0)
  await request.put(`/api/profiles/${id}/saved-items`, { data: { itemType: 'major', itemId: Number(major.id), state: 'saved', note: '家庭想核对课程' } })
  const response = await request.post(url, { data: { ...pendingInput, clientMessageId: randomUUID() } })
  expect(response.ok()).toBe(true)
  const data = (await response.json()).data
  expect(data.mode).toMatch(/^local/)
  expect(data.evidenceRefs).toEqual([])
  expect(data.assistantMessage.content).toContain('待补')
  expect(data.assistantMessage.content).not.toMatch(/优先了解|值得比较|谨慎报考|适合你|数据结构|合成课程/)
  const greeting = await request.post(`/api/profiles/${id}/advisor/conversations/${data.conversation.id}/messages`, {
    data: { message: '你好，谢谢你', clientMessageId: randomUUID() },
  })
  expect(greeting.ok()).toBe(true)
  const text = (await greeting.json()).data.assistantMessage.content
  expect(text).not.toMatch(/现在能确定|还不能确定|下一步只做/)
})

test('无位次的学校评价和宿舍追问保留学校事实路由，不回退专业清单', async ({ createProfile, request, explorationData }) => {
  const id = (await (await createProfile({ data: input })).json()).data.id
  const response = await request.post(`/api/profiles/${id}/advisor/conversations`, {
    data: { initialMessage: '合成探索学院整体怎么样？', clientMessageId: randomUUID(),
      focus: { type: 'school', schoolId: explorationData.runtime.schoolId } },
  })
  expect(response.ok()).toBe(true)
  const result = (await response.json()).data
  expect(result.assistantMessage.content).toContain('合成探索学院')
  expect(result.assistantMessage.content).toContain('本科')
  expect(result.assistantMessage.content).not.toContain('打开一个想了解的专业详情')
  expect(result.focus).toMatchObject({ type: 'school', schoolId: explorationData.runtime.schoolId })
  const next = await request.post(`/api/profiles/${id}/advisor/conversations/${result.conversation.id}/messages`, {
    data: { message: '这个学校的宿舍条件有官方材料吗？', clientMessageId: randomUUID() },
  })
  expect(next.ok()).toBe(true)
  const answer = (await next.json()).data.assistantMessage.content
  expect(answer).toMatch(/宿舍|住宿/)
  expect(answer).not.toContain('打开一个想了解的专业详情')
})
