import { expect, test } from './fixtures/created-profiles'

test('当前产品不再暴露测评与答题接口', async ({ request }) => {
  expect((await request.get('/api/assessments/questions/student')).status()).toBe(404)
})

test('目标探索无需分数和位次即可建档', async ({ page, request }) => {
  const studentName = `端到端验证-${Date.now()}`

  await page.goto('/')
  await page.getByPlaceholder('例如：小知').fill(studentName)
  await page.getByText('目标探索', { exact: true }).click()
  await expect(page.getByRole('note', { name: '目标探索说明' })).toContainText('无需分数和位次')
  await expect(page.locator('input[type="number"]')).toHaveCount(0)
  await page.locator('select').nth(1).selectOption({ label: '物理类' })
  await selectSubjects(page)
  await page.getByRole('button', { name: '保存并开始分析 →' }).click()

  await expect(page.getByRole('heading', { name: '9 个已审核专业，分 3 组比较' })).toBeVisible()
  await expect(page.locator('.school-recommendation-empty')).toContainText('记一次全省位次，学校范围自动出现')
  await expect(page.locator('.score-orbit')).toContainText('未记录成绩')

  const profileId = await page.evaluate(() => localStorage.getItem('zhixiang.currentProfileId'))
  expect(profileId).toBeTruthy()
  const profileResponse = await request.get(`/api/profiles/${profileId}`)
  expect(profileResponse.ok()).toBeTruthy()
  expect((await profileResponse.json()).data).toMatchObject({ studentName, planningMode: 'exploration', score: null, provinceRank: null })
  const snapshotsResponse = await request.get(`/api/profiles/${profileId}/score-snapshots`)
  expect(snapshotsResponse.ok()).toBeTruthy()
  expect((await snapshotsResponse.json()).data).toEqual([])

  await page.getByRole('button', { name: '↻ 历史档案' }).click()
  const historyItem = page.locator('.history-item').filter({ hasText: studentName })
  await expect(historyItem).toContainText('未记录')
  await expect(historyItem).not.toContainText('0 分')

  const reportResponse = await request.get(`/api/profiles/${profileId}/report.pdf`)
  expect(reportResponse.ok()).toBeTruthy()
  expect(reportResponse.headers()['content-type']).toContain('application/pdf')
})

test('打开网站不会自动触发就业数据采集', async ({ page }) => {
  let automaticSyncRequests = 0
  await page.route('**/api/employment/sync-if-stale', async route => {
    automaticSyncRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { triggered: false, reason: 'fresh' }, error: null, requestId: 'test' }),
    })
  })

  await page.goto('/')
  await page.waitForTimeout(500)

  expect(automaticSyncRequests).toBe(0)
})

test('尚未选择科类时提示先选择而不是误报数据缺失', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.data-coverage')).toContainText('选择科类后查看可比数据')
  await expect(page.locator('.data-coverage')).not.toContainText('尚未覆盖当前科类')
})

test('专业卡片以聚焦详情过渡取代向下展开', async ({ page }) => {
  const studentName = `端到端验证-${Date.now()}`

  await page.goto('/')
  await page.getByPlaceholder('例如：小知').fill(studentName)
  await page.getByText('志愿填报', { exact: true }).click()
  await page.locator('select').nth(1).selectOption({ label: '物理类' })
  await selectSubjects(page)
  await page.locator('input[type="number"]').nth(0).fill('612')
  await page.locator('input[type="number"]').nth(1).fill('18500')
  await page.getByRole('button', { name: '保存并开始分析 →' }).click()

  await expect(page.getByText('专业与就业方向', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/先看学什么/)).toHaveCount(0)
  await expect(page.locator('.sync-status')).toHaveCount(0)
  await expect(page.locator('.profession-card')).toHaveCount(9)
  await page.locator('.profession-card').first().locator('.card-summary').click()
  await expect(page.locator('.profession-card')).toHaveCount(0)
  await expect(page.locator('.profession-focus-detail')).toBeVisible()
  await expect(page.locator('.profession-focus-nav')).toContainText('优先了解')
  await expect(page.locator('.profession-focus-nav')).toContainText('1 / 3')
  await expect(page.locator('.job-directions article')).toHaveCount(3)

  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.profession-focus-nav')).toContainText('2 / 3')
  await page.keyboard.press('Escape')
  await expect(page.locator('.profession-card')).toHaveCount(9)
  await expect(page.locator('.profession-focus-detail')).toHaveCount(0)
})

test('家庭创建学生档案后直接进入专业就业工作台并可刷新继续', async ({ page }) => {
  const studentName = `端到端验证-${Date.now()}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '先建立一份学生档案' })).toBeVisible()

  await page.getByPlaceholder('例如：小知').fill(studentName)
  await page.getByText('志愿填报', { exact: true }).click()
  await page.locator('select').nth(1).selectOption({ label: '物理类' })
  await selectSubjects(page)
  await page.locator('input[type="number"]').nth(0).fill('612')
  await page.locator('input[type="number"]').nth(1).fill('18500')
  await page.getByRole('button', { name: '保存并开始分析 →' }).click()

  await expect(page.getByRole('heading', { name: '9 个已审核专业，分 3 组比较' })).toBeVisible()
  await expect(page.locator('.profession-card')).toHaveCount(9)
  await expect(page.locator('.profession-band').nth(0).locator('.profession-card')).toHaveCount(3)
  await expect(page.locator('.profession-band').nth(1).locator('.profession-card')).toHaveCount(3)
  await expect(page.locator('.profession-band').nth(2).locator('.profession-card')).toHaveCount(3)
  await page.locator('.profession-card').first().getByRole('button', { name: '☆ 收藏专业' }).click()
  await expect(page.getByRole('dialog', { name: '收藏成功' })).toBeVisible()
  await expect(page.getByText('以梦为马·不负韶华')).toBeVisible()
  await page.getByRole('button', { name: '继续比较' }).click()
  await page.locator('.profession-card').first().locator('.card-summary').click()
  await expect(page.locator('.profession-card')).toHaveCount(0)
  await expect(page.locator('.profession-focus-detail').locator('.job-directions article')).toHaveCount(3)
  await expect(page.locator('.profession-focus-detail').locator('.school-evidence-list article')).toHaveCount(0)
  await expect(page.locator('.profession-focus-detail').locator('.school-evidence')).toContainText('现在只查到这个学校专业组的投档线')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.profession-focus-nav')).toContainText('2 / 3')
  await page.keyboard.press('ArrowLeft')
  await page.locator('.focus-back').click()
  const firstSchoolCandidate=page.locator('.admission-risk-column article').first()
  await firstSchoolCandidate.getByRole('button',{name:/查看详情/}).click()
  await expect(page.getByRole('dialog', { name: '学校详情' })).toBeVisible()
  await expect(page.getByText('学校定位', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭学校详情' }).click()
  await firstSchoolCandidate.getByRole('button', { name: '☆ 收藏学校' }).click()
  await expect(page.getByRole('dialog', { name: '收藏成功' })).toBeVisible()
  await page.getByRole('button', { name: '查看我的收藏 →' }).click()
  await expect(page.getByRole('heading', { name: `${studentName} 的收藏` })).toBeVisible()
  await expect(page.getByText('保存在公开共享数据库，所有访客都能查看和修改')).toBeVisible()
  await page.locator('.collection-school-link').first().click()
  await expect(page.getByRole('dialog', { name: '学校详情' })).toBeVisible()
  await page.getByRole('button', { name: '关闭学校详情' }).click()
  await expect(firstSchoolCandidate.getByRole('button', { name: '★ 已收藏' })).toBeVisible()
  await expect(page.locator('.profession-card')).toHaveCount(9)
  await expect(page.getByRole('button', { name: /双视角|测评|答题/ })).toHaveCount(0)

  await page.reload()

  await expect(page.getByRole('heading', { name: '9 个已审核专业，分 3 组比较' })).toBeVisible()
  await expect(page.locator('.profession-card').first().locator('.major-save')).toHaveText('★ 已收藏')
  await page.locator('.profession-card').first().locator('.card-summary').click()
  await expect(page.locator('.profession-focus-detail').getByRole('button', { name: '★ 已收藏' }).first()).toBeVisible()
  await page.getByRole('button', { name: new RegExp('打开我的收藏，共 2 项') }).click()
  await expect(page.getByRole('heading', { name: `${studentName} 的收藏` })).toBeVisible()
  await page.getByRole('button', { name: '完成' }).click()
  await expect(page.getByText('已保存到本地', { exact: true })).toBeVisible()
  await expect(page.getByText('整体进度 100%')).toBeVisible()
  await expect(page.locator('.steps > li')).toHaveCount(2)
  await page.locator('.profession-focus-detail').locator('.major-advisor').click()
  await expect(page.getByRole('heading', { name: '知向规划顾问' })).toBeVisible()
  await expect(page.locator('textarea')).toHaveValue(/为什么放在/)
  await expect(page.locator('.message.user')).toHaveCount(0)
})

test('可从历史档案永久删除当前学生档案', async ({ page }) => {
  const studentName = `端到端验证-${Date.now()}`
  await page.goto('/')
  await page.getByPlaceholder('例如：小知').fill(studentName)
  await page.locator('select').nth(1).selectOption({ label: '物理类' })
  await selectSubjects(page)
  await page.locator('input[type="number"]').nth(0).fill('612')
  await page.locator('input[type="number"]').nth(1).fill('18500')
  await page.getByRole('button', { name: '保存并开始分析 →' }).click()
  await page.getByRole('button', { name: '历史档案' }).click()
  await page.waitForTimeout(350)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: `删除 ${studentName} 612 分档案` }).click()
  await expect(page.getByRole('heading', { name: '先建立一份学生档案' })).toBeVisible()
})

test('全国地图、山东候选、顾问与 PDF 报告可用', async ({ page, request, createProfile }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '院校地图' }).click()
  await expect(page.getByRole('heading', { name: '从地图开始看学校' })).toBeVisible()
  await expect(page.getByText('2,952')).toBeVisible()
  await expect(page.locator('.school-grid > button').first()).toBeVisible()
  await page.getByRole('button', { name: /加载更多/ }).click()
  await expect(page.locator('.school-grid > button')).toHaveCount(48)
  await page.getByPlaceholder('搜索院校或城市').fill('山东大学')
  await expect(page.getByRole('button', { name: '查看 山东大学 详情' })).toBeVisible()
  await page.getByRole('button', { name: '查看 山东大学 详情' }).click()
  await expect(page.getByRole('dialog', { name: '学校详情' })).toBeVisible()
  await expect(page.getByText('建立学生档案后查看本省招生单元和历史位次。')).toBeVisible()
  await page.getByRole('button', { name: '关闭学校详情' }).click()
  await expect(page.getByPlaceholder('搜索院校或城市')).toHaveValue('山东大学')

  const profileResponse = await createProfile({ data: { studentName: `综合验收-${Date.now()}`, province: '山东', subjectGroup: '综合改革', selectedSubjects: ['物理','化学','生物'], score: 620, provinceRank: 12000 } })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId = (await profileResponse.json()).data.id as string

  const dashboardResponse = await request.get(`/api/profiles/${profileId}/profession-dashboard`)
  expect(dashboardResponse.ok()).toBeTruthy()
  const dashboard = (await dashboardResponse.json()).data
  expect(dashboard.cards).toHaveLength(9)
  expect(dashboard.employment).toEqual(expect.objectContaining({healthySources:2,usable:true,windowDays:30}))
  expect(dashboard.cards.every((card: {sourceCount:number}) => card.sourceCount >= 2)).toBeTruthy()
  expect(dashboard.cards.every((card: {schools:Array<{officialUrl?:string;admissionsUrl?:string;linksSourceUrl?:string}>}) => card.schools.every(school => school.officialUrl && school.admissionsUrl && school.linksSourceUrl))).toBeTruthy()
  expect(dashboard.cards.filter((card: { band:string }) => card.band === '优先了解')).toHaveLength(3)
  expect(dashboard.cards.every((card: { jobs: unknown[] }) => card.jobs.length === 3)).toBeTruthy()
  expect(dashboard.cards.every((card: { schools:Array<{risk?:string}> }) => ['冲','稳','保'].every(risk => card.schools.filter(school => school.risk === risk).length <= 2))).toBeTruthy()
  const majorId = dashboard.cards[0].id as number
  const saveResponse = await request.put(`/api/profiles/${profileId}/saved-items`, { data: { itemType:'major',itemId:majorId,state:'saved' } })
  expect(saveResponse.ok()).toBeTruthy()
  const savedDashboard = (await (await request.get(`/api/profiles/${profileId}/profession-dashboard`)).json()).data
  expect(savedDashboard.savedItems).toContainEqual(expect.objectContaining({itemType:'major',itemId:majorId,state:'saved'}))

  const recommendationResponse = await request.post(`/api/profiles/${profileId}/recommendations/generate`)
  expect(recommendationResponse.ok()).toBeTruthy()
  const recommendations = (await recommendationResponse.json()).data
  expect(recommendations.sourceYear).toBe(2025)
  expect(recommendations.dataYears).toEqual([2023, 2024, 2025])
  expect(recommendations.sources).toHaveLength(3)
  expect(recommendations.candidates.length).toBeGreaterThan(0)
  expect(recommendations.candidates.every((candidate: {officialUrl?:string;admissionsUrl?:string}) => candidate.officialUrl && candidate.admissionsUrl)).toBeTruthy()

  const advisorResponse = await request.post(`/api/profiles/${profileId}/advisor/messages`, { data: { message: '我们应该优先选学校还是专业？' } })
  expect(advisorResponse.ok()).toBeTruthy()
  const advisor = (await advisorResponse.json()).data
  expect(['ai-adapted-skill', 'local-adapted-skill', 'local-ai-fallback']).toContain(advisor.mode)
  expect(advisor.content).toContain('现在能确定：')
  expect(advisor.content).toContain('现在还不能确定：')
  expect(advisor.content).toContain('下一步只做：')
  expect(advisor.content).not.toContain('【先说结论】')

  const reportResponse = await request.get(`/api/profiles/${profileId}/report.pdf`)
  expect(reportResponse.ok()).toBeTruthy()
  expect(reportResponse.headers()['content-type']).toContain('application/pdf')
  expect((await reportResponse.body()).byteLength).toBeGreaterThan(10_000)
})

test('学校详情可独立浏览并结合当前档案解释招生证据', async ({ request, createProfile }) => {
  const schoolsResponse = await request.get('/api/schools?q=山东大学')
  expect(schoolsResponse.ok()).toBeTruthy()
  const school = (await schoolsResponse.json()).data.items[0] as { id: number; name: string }

  const publicDetailResponse = await request.get(`/api/schools/${school.id}`)
  expect(publicDetailResponse.ok()).toBeTruthy()
  const publicDetail = (await publicDetailResponse.json()).data
  expect(publicDetail.school).toEqual(expect.objectContaining({ id: school.id, name: '山东大学', province: '山东', city: '济南' }))
  expect(publicDetail.featuredMajors).toEqual(expect.any(Array))
  expect(publicDetail.admissionContext).toBeNull()
  expect(publicDetail.interpretation).toHaveLength(3)
  expect(publicDetail.interpretation[1].text).toContain('建立学生档案')

  const profileResponse = await createProfile({ data: { studentName: `综合验收-${Date.now()}`, province: '河南', subjectGroup: '物理类', selectedSubjects: ['物理','化学','生物'], score: 620, provinceRank: 12000 } })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId = (await profileResponse.json()).data.id as string
  const detailResponse = await request.get(`/api/schools/${school.id}?profileId=${profileId}`)
  expect(detailResponse.ok()).toBeTruthy()
  const detail = (await detailResponse.json()).data
  expect(detail.admissionContext).toEqual(expect.objectContaining({ profileProvince: '河南', subjectGroup: '物理类' }))
  expect(detail.admissionContext.records.length).toBeGreaterThan(0)
  expect(detail.admissionContext.records.every((record: { unitType: string }) => ['exact_major','major_group','school_line'].includes(record.unitType))).toBeTruthy()
  expect(detail.interpretation).toHaveLength(3)

  const missingResponse = await request.get('/api/schools/999999999')
  expect(missingResponse.status()).toBe(404)
})

test('河南物理类档案可按专业组位次生成候选', async ({ request, createProfile }) => {
  const profileResponse = await createProfile({ data: { studentName: `河南候选验证-${Date.now()}`, province: '河南', subjectGroup: '物理类', selectedSubjects: ['物理','化学','生物'], score: 666, provinceRank: 2600 } })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId = (await profileResponse.json()).data.id as string

  const dashboardResponse = await request.get(`/api/profiles/${profileId}/profession-dashboard`)
  expect(dashboardResponse.ok()).toBeTruthy()
  const dashboard = (await dashboardResponse.json()).data
  expect(dashboard.cards).toHaveLength(9)
  expect(dashboard.admissionEvidence).toEqual(expect.objectContaining({unitType:'major_group',years:[2025],confidence:'低'}))
  expect(dashboard.schoolCandidates.length).toBeGreaterThan(0)
  expect(dashboard.schoolCandidates.every((candidate:{confidence:string;dataYears:number[];unitType:string}) => candidate.confidence==='低' && candidate.unitType==='major_group' && candidate.dataYears.join(',')==='2025')).toBeTruthy()
  expect(dashboard.cards.every((card:{schools:unknown[];schoolMatchStatus:string}) => card.schools.length===0 && card.schoolMatchStatus==='group_only')).toBeTruthy()

  const recommendationResponse = await request.post(`/api/profiles/${profileId}/recommendations/generate`)
  expect(recommendationResponse.ok()).toBeTruthy()
  const recommendations = (await recommendationResponse.json()).data
  expect(recommendations.sourceYear).toBe(2025)
  expect(recommendations.candidates.length).toBeGreaterThan(0)
  expect(recommendations.candidates.every((candidate: { unitType:string;unitName:string;majors:unknown[] }) => candidate.unitType==='major_group' && candidate.unitName.includes('物理类 第') && candidate.majors.length===0)).toBeTruthy()
  expect(recommendations.warning).toContain('考试院原页复核')
  expect(recommendations.dataYears).toEqual([2025])
  expect(recommendations.sources[0].publisher).toContain('河南省教育考试院')

  await verifyAdvisorAndReport(request, profileId)
})

test('河南单年专业组在页面分层展示且不清空专业', async ({ page, request, createProfile })=>{
  const profileResponse=await createProfile({data:{studentName:`分层验收-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:666,provinceRank:18500}})
  expect(profileResponse.ok()).toBeTruthy()
  const profileId=(await profileResponse.json()).data.id as string
  await page.goto('/')
  await page.evaluate(id=>localStorage.setItem('zhixiang.currentProfileId',id),profileId)
  await page.reload()
  await expect(page.getByRole('heading',{name:'先看位次可达，再核对组内专业'})).toBeVisible()
  await expect(page.getByText('单年冲刺候选最多放宽至 15% 位次差',{exact:false})).toBeVisible()
  await expect(page.locator('.admission-risk-column').nth(0).locator('article')).toHaveCount(2)
  await expect(page.locator('.admission-risk-column').nth(1).locator('article')).toHaveCount(2)
  await expect(page.locator('.admission-risk-column').nth(2).locator('article')).toHaveCount(2)
  await expect(page.locator('.profession-card')).toHaveCount(9)
  await expect(page.getByText('当前没有满足硬条件的专业')).toHaveCount(0)
  await expect(page.getByText('2025 · 2,247 条')).toBeVisible()
  const firstCandidate=page.locator('.admission-risk-column article').first()
  await firstCandidate.locator('.school-title-link').click()
  await expect(page.getByRole('dialog',{name:'学校详情'})).toBeVisible()
  await page.getByRole('dialog',{name:'学校详情'}).getByRole('button',{name:'关闭学校详情'}).click()
  await expect(firstCandidate.getByRole('link',{name:'本科招生网 ↗'})).toHaveAttribute('href',/^https?:\/\//)
  await firstCandidate.getByRole('button',{name:'☆ 收藏学校'}).click()
  await expect(firstCandidate.getByRole('button',{name:'★ 已收藏'})).toBeVisible()
  await page.getByRole('button',{name:'继续比较'}).click()
  await page.locator('.profession-card').first().click()
  await expect(page.getByText('现在只查到这个学校专业组的投档线，还不能确定组里一定有这个专业。请先参考上方的学校和专业组信息。')).toBeVisible()
})

test('数据状态首次失败后自动恢复而不误报未覆盖',async({ page, request, createProfile })=>{
  const profileResponse=await createProfile({data:{studentName:`分层验收-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:545,provinceRank:10163}})
  const profileId=(await profileResponse.json()).data.id as string
  await page.addInitScript(id=>localStorage.setItem('zhixiang.currentProfileId',id),profileId)
  let calls=0
  await page.route('**/api/admin/data-status',async route=>{calls+=1;if(calls===1)await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({success:false,data:null,error:'暂不可用'})});else await route.continue()})
  await page.goto('/')
  await expect(page.getByText('数据状态暂不可用')).toBeVisible()
  await expect(page.getByText('2025 · 2,247 条')).toBeVisible({timeout:8000})
  expect(calls).toBeGreaterThanOrEqual(2)
})

test('同一档案可连续重新计算且服务保持可用', async ({ request, createProfile }) => {
  const profileResponse = await createProfile({ data: { studentName: `河南候选验证-${Date.now()}`, province: '河南', subjectGroup: '物理类', selectedSubjects: ['物理','化学','生物'], score: 666, provinceRank: 2600 } })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId = (await profileResponse.json()).data.id as string

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const recommendationResponse = await request.post(`/api/profiles/${profileId}/recommendations/generate`)
    expect(recommendationResponse.ok()).toBeTruthy()
    expect((await recommendationResponse.json()).success).toBe(true)
  }

  const healthResponse = await request.get('/api/health')
  expect(healthResponse.ok()).toBeTruthy()
  expect((await healthResponse.json()).data.database).toBe('connected')
})

test('河北物理类档案可按专业最低分对应位次生成候选', async ({ request, createProfile }) => {
  const profileResponse = await createProfile({ data: { studentName: `河北候选验证-${Date.now()}`, province: '河北', subjectGroup: '物理类', selectedSubjects: ['物理','化学','生物'], score: 600, provinceRank: 27073 } })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId = (await profileResponse.json()).data.id as string

  const recommendationResponse = await request.post(`/api/profiles/${profileId}/recommendations/generate`)
  expect(recommendationResponse.ok()).toBeTruthy()
  const recommendations = (await recommendationResponse.json()).data
  expect(recommendations.sourceYear).toBe(2025)
  expect(recommendations.candidates.length).toBeGreaterThan(0)
  expect(recommendations.candidates.some((candidate: { majors: Array<{ name: string }> }) => candidate.majors.some(major => major.name.startsWith('物理类 ')))).toBeTruthy()
  expect(recommendations.dataYears).toEqual([2023, 2024, 2025])
  expect(recommendations.candidates.every((candidate: { confidence: string }) => candidate.confidence === '高')).toBeTruthy()

  await verifyAdvisorAndReport(request, profileId)
})

test('三省 2023—2025 数据状态包含来源、记录数和更新时间', async ({ request }) => {
  const response = await request.get('/api/admin/data-status')
  expect(response.ok()).toBeTruthy()
  const data=await response.json()
  const yearStatus = data.data.yearStatus as Array<{ province: string; year: number; recordCount: number; publisher: string; sourceUrl: string; updatedAt: string }>
  for (const province of ['河南', '山东', '河北']) {
    const rows = yearStatus.filter(item => item.province === province)
    expect(rows.map(item => item.year)).toEqual([2023, 2024, 2025])
    expect(rows.every(item => item.recordCount > 0 && item.publisher && item.sourceUrl && item.updatedAt)).toBeTruthy()
  }
  const details=data.data.coverageDetails as Array<{educationLevel:string;batch:string;recommendationEligibleCount:number;auditedGapCount:number;sourceStatus:string}>
  expect(details.length).toBeGreaterThan(0)
  expect(details.every(item=>item.educationLevel&&item.batch&&item.recommendationEligibleCount>=0&&item.auditedGapCount>=0)).toBeTruthy()
  expect(details.some(item=>item.sourceStatus==='pending')).toBeTruthy()
})

test('旧按需同步接口不再触发采集', async ({ request }) => {
  const response=await request.post('/api/employment/sync-if-stale')
  expect(response.ok()).toBeTruthy()
  expect((await response.json()).data).toEqual({triggered:false,reason:'manual-only'})
})

test('模考轨迹同步当前坐标，删除当前记录后恢复上一条',async({ request, createProfile })=>{
  const created=await createProfile({data:{studentName:`模考轨迹-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:500,provinceRank:120000,planningMode:'exploration'}})
  const profileId=(await created.json()).data.id as string
  try{
    const initial=await request.get(`/api/profiles/${profileId}/score-snapshots`)
    expect(initial.ok()).toBeTruthy()
    expect((await initial.json()).data).toHaveLength(1)
    const added=await request.post(`/api/profiles/${profileId}/score-snapshots`,{data:{examName:'高二期末',examDate:'2026-07-20',score:530,provinceRank:90000,note:'第一次全省联考'}})
    expect(added.status()).toBe(201)
    const snapshot=(await added.json()).data
    expect(snapshot.isCurrent).toBe(true)
    const current=(await (await request.get(`/api/profiles/${profileId}`)).json()).data
    expect(current).toMatchObject({score:530,provinceRank:90000})
    const removed=await request.delete(`/api/profiles/${profileId}/score-snapshots/${snapshot.id}`)
    expect(removed.ok()).toBeTruthy()
    const restored=(await (await request.get(`/api/profiles/${profileId}`)).json()).data
    expect(restored).toMatchObject({score:500,provinceRank:120000})
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

test('多次有效位次形成稳健规划位次，单次异常不会直接带偏学校候选',async({ request, createProfile })=>{
  const created=await createProfile({data:{studentName:`规划位次-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:680,provinceRank:10000,planningMode:'application'}})
  const profileId=(await created.json()).data.id as string
  try{
    const baseline=(await (await request.get(`/api/profiles/${profileId}/profession-dashboard`)).json()).data
    const baselineSchools=baseline.schoolCandidates.map((item:{schoolId:number})=>item.schoolId)
    await request.post(`/api/profiles/${profileId}/score-snapshots`,{data:{examName:'二模',examDate:'2026-06-01',score:690,provinceRank:9000}})
    await request.post(`/api/profiles/${profileId}/score-snapshots`,{data:{examName:'三模异常',examDate:'2026-07-01',score:500,provinceRank:100000}})
    const dashboard=(await (await request.get(`/api/profiles/${profileId}/profession-dashboard`)).json()).data
    expect(dashboard.profileSummary.provinceRank).toBe(100000)
    expect(dashboard.planningCoordinate).toMatchObject({rank:10000,sampleCount:3,bestRank:9000,worstRank:100000,stability:'volatile'})
    expect(dashboard.schoolCandidates.map((item:{schoolId:number})=>item.schoolId)).toEqual(baselineSchools)
    const generated=await request.post(`/api/profiles/${profileId}/recommendations/generate`)
    expect(generated.ok()).toBeTruthy()
    expect((await generated.json()).data.planningCoordinate).toMatchObject({rank:10000,sampleCount:3,stability:'volatile'})
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

test('目标探索档案积累有效位次后自动联合推荐学校和专业',async({ page, request, createProfile })=>{
  const created=await createProfile({data:{studentName:`联合推荐-${Date.now()}`,province:'山东',subjectGroup:'综合改革',selectedSubjects:['物理','化学','生物'],score:620,provinceRank:12000,planningMode:'exploration'}})
  const profileId=(await created.json()).data.id as string
  try{
    await request.post(`/api/profiles/${profileId}/score-snapshots`,{data:{examName:'校内周测',examDate:'2026-07-28',score:632,provinceRank:null,note:'只有分数，不参与规划位次'}})
    const profile=(await (await request.get(`/api/profiles/${profileId}`)).json()).data
    expect(profile.planningMode).toBe('exploration')
    const dashboard=(await (await request.get(`/api/profiles/${profileId}/profession-dashboard`)).json()).data
    expect(dashboard.planningCoordinate).toMatchObject({rank:12000,sampleCount:1})
    expect(dashboard.schoolCandidates.length).toBeGreaterThan(0)
    expect(dashboard.cards.some((card:{schools:Array<{risk?:string}>})=>card.schools.some(school=>['冲','稳','保'].includes(String(school.risk))))).toBeTruthy()
    await page.goto('/')
    await page.evaluate(id=>localStorage.setItem('zhixiang.currentProfileId',id),profileId)
    await page.reload()
    await expect(page.locator('.admission-layer')).toBeVisible({timeout:15000})
    await page.setViewportSize({width:390,height:844})
    const preview=page.locator('.major-school-preview').first()
    await expect(preview).toContainText('可核验学校')
    await preview.getByRole('button').first().click()
    await expect(page.getByRole('dialog',{name:'学校详情'})).toBeVisible()
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

test('没有有效位次时不猜学校并保留档案原始模式',async({ page, request, createProfile })=>{
  const created=await createProfile({data:{studentName:`学校待开启-${Date.now()}`,province:'山东',subjectGroup:'综合改革',selectedSubjects:['物理','化学','生物'],score:620,provinceRank:null,planningMode:'application'}})
  const profileId=(await created.json()).data.id as string
  try{
    const profile=(await (await request.get(`/api/profiles/${profileId}`)).json()).data
    expect(profile.planningMode).toBe('application')
    const dashboard=(await (await request.get(`/api/profiles/${profileId}/profession-dashboard`)).json()).data
    expect(dashboard.mode).toBe('exploration')
    expect(dashboard.planningCoordinate.rank).toBeNull()
    expect(dashboard.schoolCandidates).toHaveLength(0)
    await page.goto('/')
    await page.evaluate(id=>localStorage.setItem('zhixiang.currentProfileId',id),profileId)
    await page.reload()
    await expect(page.locator('.school-recommendation-empty')).toContainText('记一次全省位次，学校范围自动出现')
    await page.locator('.school-recommendation-empty').getByRole('button',{name:'记录含位次的模考'}).click()
    await expect(page.locator('.score-form')).toBeVisible()
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

async function verifyAdvisorAndReport(request: import('@playwright/test').APIRequestContext, profileId: string) {
  const advisorResponse = await request.post(`/api/profiles/${profileId}/advisor/messages`, { data: { message: '请按家庭约束、录取安全和专业发展帮我们梳理。' } })
  expect(advisorResponse.ok()).toBeTruthy()
  const advisor = (await advisorResponse.json()).data
  expect(['ai-adapted-skill', 'local-adapted-skill', 'local-ai-fallback']).toContain(advisor.mode)
  expect(advisor.content).toContain('现在能确定：')
  expect(advisor.content).toContain('现在还不能确定：')
  expect(advisor.content).toContain('下一步只做：')
  expect(advisor.content).not.toContain('【先说结论】')

  const reportResponse = await request.get(`/api/profiles/${profileId}/report.pdf`)
  expect(reportResponse.ok()).toBeTruthy()
  expect(reportResponse.headers()['content-type']).toContain('application/pdf')
  expect((await reportResponse.body()).byteLength).toBeGreaterThan(10_000)
}

async function selectSubjects(page: import('@playwright/test').Page) {
  await page.locator('.subject-picker button', { hasText: '化学' }).click()
  await page.locator('.subject-picker button', { hasText: '生物' }).click()
}
