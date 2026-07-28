import { expect, test } from '@playwright/test'

test('家庭讨论备注独立保存，切换收藏状态不会覆盖', async ({ request }) => {
  const created=await request.post('/api/profiles',{data:{studentName:`备注验收-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:500,provinceRank:120000,planningMode:'exploration'}})
  const profileId=(await created.json()).data.id as string
  try {
    const schools=await request.get('/api/schools?page=1')
    const school=(await schools.json()).data.items[0]
    await request.put(`/api/profiles/${profileId}/saved-items`,{data:{itemType:'school',itemId:school.id,state:'target',note:'父母最担心培养成本'}})
    await request.put(`/api/profiles/${profileId}/saved-items`,{data:{itemType:'school',itemId:school.id,state:'saved'}})
    let dashboard=(await (await request.get(`/api/profiles/${profileId}/profession-dashboard`)).json()).data
    expect(dashboard.savedItems.find((item:{itemId:number})=>item.itemId===school.id).note).toBe('父母最担心培养成本')
    const patched=await request.patch(`/api/profiles/${profileId}/saved-items/school/${school.id}/note`,{data:{note:'下一步核对实习机会'}})
    expect(patched.ok()).toBeTruthy()
    dashboard=(await (await request.get(`/api/profiles/${profileId}/profession-dashboard`)).json()).data
    expect(dashboard.savedItems.find((item:{itemId:number})=>item.itemId===school.id).note).toBe('下一步核对实习机会')
    await request.patch(`/api/profiles/${profileId}/saved-items/school/${school.id}/note`,{data:{note:null}})
    dashboard=(await (await request.get(`/api/profiles/${profileId}/profession-dashboard`)).json()).data
    expect(dashboard.savedItems.find((item:{itemId:number})=>item.itemId===school.id).note).toBeNull()
  } finally { await request.delete(`/api/profiles/${profileId}`) }
})

test('历史家庭偏好不会改变当前候选、规则分或风险说明', async ({ request }) => {
  const profileResponse = await request.post('/api/profiles', {
    data: {
      studentName: `历史偏好隔离-${Date.now()}`,
      province: '河南',
      subjectGroup: '物理类',
      selectedSubjects: ['物理', '化学', '生物'],
      score: 545,
      provinceRank: 10163,
      planningMode: 'application',
    },
  })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId = (await profileResponse.json()).data.id as string

  try {
    const baselineResponse = await request.post(`/api/profiles/${profileId}/recommendations/generate`)
    expect(baselineResponse.ok()).toBeTruthy()
    const baseline = (await baselineResponse.json()).data

    const legacyPreferenceResponse = await request.put(`/api/profiles/${profileId}/preferences`, {
      data: {
        postgraduateTendency: 'planned',
        familyConditions: {
          annualBudget: '历史高预算',
          employmentTiming: '历史长期培养',
          industryResources: '历史行业资源',
          familyBusiness: '历史家业接续',
          studySupport: '历史充分支持',
          locationAcceptance: '历史全国均可',
          highCostCity: '历史接受高成本城市',
        },
        studentRanking: ['majorFit', 'schoolLevel', 'career', 'city', 'cost', 'distance'],
        parentRanking: ['schoolLevel', 'career', 'majorFit', 'city', 'distance', 'cost'],
        finalWeights: { majorFit: 100, schoolLevel: 0, career: 0, city: 0, cost: 0, distance: 0 },
      },
    })
    expect(legacyPreferenceResponse.ok()).toBeTruthy()

    const afterResponse = await request.post(`/api/profiles/${profileId}/recommendations/generate`)
    expect(afterResponse.ok()).toBeTruthy()
    const after = (await afterResponse.json()).data

    const observable = (result: typeof baseline) => ({
      candidates: result.candidates.map((candidate: { schoolId:number;unitId:number;risk:string;ruleScore:number }) => ({
        schoolId: candidate.schoolId,
        unitId: candidate.unitId,
        risk: candidate.risk,
        ruleScore: candidate.ruleScore,
      })),
      warning: result.warning,
    })

    expect(observable(after)).toEqual(observable(baseline))
    expect(after.warning).not.toMatch(/家庭|偏好|共同确认|权重/)
    const reportResponse=await request.get(`/api/profiles/${profileId}/report.pdf`)
    expect(reportResponse.ok()).toBeTruthy()
    expect(reportResponse.headers()['content-type']).toContain('application/pdf')
  } finally {
    await request.delete(`/api/profiles/${profileId}`)
  }
})

test('历史家庭偏好不会进入当前顾问回答', async ({ request }) => {
  const profileResponse = await request.post('/api/profiles', {
    data: {
      studentName: `顾问偏好隔离-${Date.now()}`,
      province: '河南',
      subjectGroup: '物理类',
      selectedSubjects: ['物理', '化学', '生物'],
      score: 545,
      provinceRank: 10163,
      planningMode: 'application',
    },
  })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId = (await profileResponse.json()).data.id as string
  const question = '当前档案里家庭预算字段的原文是什么？如果上下文中有，请原样回答；没有就明确说当前流程没有该数据。'

  try {
    const legacyPreferenceResponse = await request.put(`/api/profiles/${profileId}/preferences`, {
      data: {
        postgraduateTendency: 'planned',
        familyConditions: {
          annualBudget: 'LEGACY-BUDGET-SENTINEL-92741',
          employmentTiming: '历史长期培养',
          industryResources: '历史行业资源',
          familyBusiness: '历史家业接续',
          studySupport: '历史充分支持',
          locationAcceptance: '历史全国均可',
          highCostCity: '历史接受高成本城市',
        },
        studentRanking: ['majorFit', 'schoolLevel', 'career', 'city', 'cost', 'distance'],
        parentRanking: ['schoolLevel', 'career', 'majorFit', 'city', 'distance', 'cost'],
        finalWeights: { majorFit: 100, schoolLevel: 0, career: 0, city: 0, cost: 0, distance: 0 },
      },
    })
    expect(legacyPreferenceResponse.ok()).toBeTruthy()

    const afterResponse = await request.post(`/api/profiles/${profileId}/advisor/messages`, { data: { message: question } })
    expect(afterResponse.ok()).toBeTruthy()
    const after = (await afterResponse.json()).data

    expect(after.content).not.toContain('LEGACY-BUDGET-SENTINEL-92741')
    expect(after.content).not.toContain('家庭条件已进入本地分析')
  } finally {
    await request.delete(`/api/profiles/${profileId}`)
  }
})

test('顾问按院校 ID 读取当前档案下的可信院校上下文', async ({ request }) => {
  const schoolResponse = await request.get('/api/schools?q=山东大学')
  expect(schoolResponse.ok()).toBeTruthy()
  const school = (await schoolResponse.json()).data.items[0] as { id:number;name:string }
  expect(school.name).toBe('山东大学')

  const profileResponse = await request.post('/api/profiles', {
    data: {
      studentName: `院校顾问上下文-${Date.now()}`,
      province: '山东',
      subjectGroup: '综合改革',
      selectedSubjects: ['物理', '化学', '生物'],
      score: 620,
      provinceRank: 12000,
      planningMode: 'application',
    },
  })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId = (await profileResponse.json()).data.id as string

  try {
    const response = await request.post(`/api/profiles/${profileId}/advisor/messages`, {
      data: { message: '请解释这所学校为什么值得关注、风险和待核验信息。', focus: { type: 'school', schoolId: school.id } },
    })
    expect(response.ok()).toBeTruthy()
    const answer = (await response.json()).data

    expect(answer.focus).toEqual({ type: 'school', schoolId: school.id, schoolName: '山东大学' })
    expect(answer.content).toContain('山东大学')
    expect(answer.content).toMatch(/招生|位次|风险/)
  } finally {
    await request.delete(`/api/profiles/${profileId}`)
  }
})

test('顾问拒绝不存在的院校焦点且普通入口保持可用', async ({request})=>{
  const profileResponse=await request.post('/api/profiles',{
    data:{studentName:`顾问焦点校验-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:545,provinceRank:10163,planningMode:'application'},
  })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId=(await profileResponse.json()).data.id as string
  try{
    const invalid=await request.post(`/api/profiles/${profileId}/advisor/messages`,{data:{message:'解释这所学校',focus:{type:'school',schoolId:2147483647}}})
    expect(invalid.status()).toBe(404)
    expect((await invalid.json()).error).toBe('院校不存在')
    const historyAfterInvalid=await request.get(`/api/profiles/${profileId}/advisor/messages`)
    expect((await historyAfterInvalid.json()).data).toHaveLength(0)

    const general=await request.post(`/api/profiles/${profileId}/advisor/messages`,{data:{message:'解释当前工作台的数据边界'}})
    expect(general.ok()).toBeTruthy()
    expect((await general.json()).data.focus).toBeUndefined()
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

test('从院校详情进入顾问时显示院校焦点且不会自动发送', async ({ page,request }) => {
  const profileResponse=await request.post('/api/profiles',{
    data:{studentName:`院校顾问交互-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:545,provinceRank:10163,planningMode:'application'},
  })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId=(await profileResponse.json()).data.id as string

  try{
    await page.goto('/')
    await page.evaluate(id=>localStorage.setItem('zhixiang.currentProfileId',id),profileId)
    await page.reload()
    const firstSchool=page.locator('.admission-risk-column article').first()
    await expect(firstSchool).toBeVisible()
    await firstSchool.locator('.school-title-link').click()
    const drawer=page.getByRole('dialog',{name:'学校详情'})
    const schoolName=(await drawer.getByRole('heading',{level:2}).textContent())?.trim()??''
    expect(schoolName).not.toBe('')
    await drawer.getByRole('button',{name:'问顾问 →'}).click()

    await expect(page.getByRole('heading',{name:'知向规划顾问'})).toBeVisible()
    await expect(page.locator('.advisor-focus')).toContainText(`正在讨论：${schoolName}`)
    await expect(page.locator('textarea')).toHaveValue(new RegExp(schoolName))
    await expect(page.locator('.message.user')).toHaveCount(0)

    await page.getByRole('button',{name:'发送 →'}).click()
    await expect(page.locator('.message.user')).toHaveCount(1)
    await expect(page.locator('.message.assistant').last()).toContainText(schoolName,{timeout:30_000})
    await page.locator('textarea').fill('这所学校还要重点核验什么？')
    await page.getByRole('button',{name:'发送 →'}).click()
    await expect(page.locator('.message.assistant').last()).toContainText(schoolName,{timeout:30_000})
  }finally{
    await request.delete(`/api/profiles/${profileId}`)
  }
})

test('从专业进入新会话，保留聊天记录并能返回原专业',async({page,request})=>{
  const profileResponse=await request.post('/api/profiles',{
    data:{studentName:`专业会话-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:545,provinceRank:10163,planningMode:'application'},
  })
  const profileId=(await profileResponse.json()).data.id as string
  try{
    await page.goto('/')
    await page.evaluate(id=>localStorage.setItem('zhixiang.currentProfileId',id),profileId)
    await page.reload()
    await page.locator('.profession-card').first().locator('.card-summary').click()
    const majorName=(await page.locator('.profession-focus-hero h3').textContent())?.trim()??''
    await page.locator('.major-advisor').click()
    await expect(page.locator('.advisor-focus')).toContainText(`正在讨论：${majorName}`)
    await page.getByRole('button',{name:'发送 →'}).click()
    await expect(page.locator('.message.user')).toHaveCount(1)
    await expect(page.locator('.message.assistant')).toHaveCount(1,{timeout:30_000})
    await expect(page.locator('.advisor-conversation-list .conversation-main')).toContainText(majorName)
    await page.getByRole('button',{name:`返回${majorName}`,exact:true}).last().click()
    await expect(page.locator('.profession-focus-hero h3')).toHaveText(majorName)
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

test('可在我的收藏中选择两所目标院校进行紧凑比较',async({page,request})=>{
  const profileResponse=await request.post('/api/profiles',{
    data:{studentName:`院校比较-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:545,provinceRank:10163,planningMode:'application'},
  })
  expect(profileResponse.ok()).toBeTruthy()
  const profileId=(await profileResponse.json()).data.id as string
  try{
    const dashboard=(await (await request.get(`/api/profiles/${profileId}/profession-dashboard`)).json()).data
    const schools=[...new Map(dashboard.schoolCandidates.map((item:{schoolId:number;schoolName:string})=>[item.schoolId,item])).values()].slice(0,2) as Array<{schoolId:number;schoolName:string}>
    expect(schools).toHaveLength(2)
    for(const [index,school] of schools.entries()){
      const saved=await request.put(`/api/profiles/${profileId}/saved-items`,{data:{itemType:'school',itemId:school.schoolId,state:'target',note:index===0?'弟弟愿意继续了解这所学校':null}})
      expect(saved.ok()).toBeTruthy()
    }
    await page.goto('/')
    await page.evaluate(id=>localStorage.setItem('zhixiang.currentProfileId',id),profileId)
    await page.reload()
    await page.getByRole('button',{name:/打开我的收藏，共 2 项/}).click()
    const dialog=page.getByRole('dialog',{name:'我的收藏'})
    await expect(dialog.locator('textarea')).toHaveCount(0)
    await expect(dialog.getByRole('button',{name:/编辑.*家庭备注/}).first()).toBeVisible()
    await expect(dialog).not.toContainText('愿不愿学四年？成本担心什么？下一项查什么？')
    for(const school of schools)await dialog.getByRole('checkbox',{name:`选择 ${school.schoolName} 参与比较`}).check()
    await page.setViewportSize({width:390,height:844})
    await page.context().grantPermissions(['clipboard-read','clipboard-write'])
    const briefButton=dialog.getByRole('button',{name:'给爸妈看 (2)'})
    await briefButton.click()
    const brief=page.getByRole('dialog',{name:'给爸妈看的学校简报'})
    await expect(brief).toBeVisible()
    await expect(brief).toContainText('弟弟愿意继续了解这所学校')
    await expect(brief).toContainText('弟弟愿不愿学四年')
    await brief.getByRole('button',{name:`编辑 ${schools[0].schoolName} 家庭备注`}).click()
    const briefNote=brief.getByLabel(`${schools[0].schoolName} 家庭讨论备注`)
    await briefNote.fill('弟弟愿意学，父母要再核对住宿成本')
    await brief.getByRole('button',{name:`保存 ${schools[0].schoolName} 家庭备注`}).click()
    await expect(brief).toContainText('家庭备注已保存')
    const briefBox=await brief.boundingBox();expect(briefBox?.width).toBe(390);expect(briefBox?.height).toBe(844)
    await brief.getByRole('button',{name:'复制纯文本'}).click()
    await expect(brief).toContainText('已复制，可以发到家庭群')
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('家庭只讨论三个问题')
    await brief.getByRole('button',{name:'关闭家庭简报'}).click()
    await expect(brief).toBeHidden()
    await expect(briefButton).toBeFocused()
    await briefButton.click()
    await expect(page.getByRole('dialog',{name:'给爸妈看的学校简报'})).toContainText('弟弟愿意学，父母要再核对住宿成本')
    await page.getByRole('dialog',{name:'给爸妈看的学校简报'}).getByRole('button',{name:'关闭家庭简报'}).click()
    await dialog.getByRole('button',{name:'比较已选 2 所'}).click()
    await expect(dialog.getByRole('heading',{name:'院校对比'})).toBeVisible()
    await expect(dialog.locator('.school-comparison-column')).toHaveCount(2)
    await expect(dialog).toContainText('当前档案招生位置')
    await expect(dialog).toContainText('数据缺口')
    const analysis=dialog.locator('.comparison-analysis')
    await expect(analysis).toContainText('优先核对：',{timeout:30_000})
    await expect(analysis).toContainText('关键差异：')
    await expect(analysis).toContainText('填报风险：')
    for(const school of schools)await expect(analysis).toContainText(school.schoolName)
    const advisorHistory=(await (await request.get(`/api/profiles/${profileId}/advisor/messages`)).json()).data
    expect(advisorHistory).toHaveLength(0)
    const dialogBox=await dialog.boundingBox();expect(dialogBox?.width).toBeLessThanOrEqual(390)
    expect(await dialog.locator('.school-comparison-grid').evaluate(element=>element.scrollWidth>=element.clientWidth)).toBeTruthy()
    await dialog.getByRole('button',{name:new RegExp(`查看 ${schools[0].schoolName} 详情`)}).click()
    await expect(page.getByRole('dialog',{name:'学校详情'})).toBeVisible()
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

test('本地维护接口披露院校事实覆盖率与逐校待核验原因',async({request})=>{
  const response=await request.get('/api/admin/school-data-quality?page=1&pageSize=10')
  expect(response.ok()).toBeTruthy()
  const data=(await response.json()).data
  expect(data.summary.totalSchools).toBeGreaterThan(2000)
  for(const key of ['officialWebsite','admissionsWebsite','featuredMajors','admissionYears']){
    expect(data.summary[key].verified).toBeGreaterThanOrEqual(0)
    expect(data.summary[key].missing).toBe(data.summary.totalSchools-data.summary[key].verified)
  }
  expect(data.items.length).toBeLessThanOrEqual(10)
  expect(data.items.every((item:{id:number;name:string;missing:string[]})=>item.id>0&&item.name&&item.missing.length>0)).toBeTruthy()
  expect(data.totalPending).toBeGreaterThanOrEqual(data.items.length)
})

test('院校数据维护页只能通过直达地址进入且不出现在普通导航',async({page})=>{
  await page.goto('/')
  await expect(page.getByRole('link',{name:/数据维护|核验工作台/})).toHaveCount(0)
  await page.goto('/admin/data-quality')
  await expect(page.getByRole('heading',{name:'院校数据核验'})).toBeVisible()
  const summary=page.locator('.quality-summary')
  await expect(summary.getByText('学校官网',{exact:true})).toBeVisible()
  await expect(summary.getByText('招生官网',{exact:true})).toBeVisible()
  await expect(summary.getByText('优势专业',{exact:true})).toBeVisible()
  await expect(summary.getByText('招生年份',{exact:true})).toBeVisible()
})

test('院校详情只披露带类型年份和来源的已核验优势专业',async({request})=>{
  const schools=(await (await request.get('/api/schools?q=北京语言大学&pageSize=10')).json()).data.items as Array<{id:number;name:string}>
  const school=schools.find(item=>item.name==='北京语言大学')
  expect(school).toBeTruthy()
  const detail=(await (await request.get(`/api/schools/${school!.id}`)).json()).data
  const major=detail.featuredMajors.find((item:{name:string})=>item.name==='计算机科学与技术')
  expect(major).toMatchObject({recognitionType:'国家级一流本科专业建设点',recognitionYear:2020,publisher:'北京语言大学'})
  expect(major.sourceUrl).toMatch(/^https:\/\//)
  expect(major.verifiedAt).toBeTruthy()
})

test('山东大学与大连理工大学返回完整的官方优势专业名录',async({request})=>{
  async function schoolDetail(name:string){
    const schools=(await (await request.get(`/api/schools?q=${encodeURIComponent(name)}&pageSize=10`)).json()).data.items as Array<{id:number;name:string}>
    const school=schools.find(item=>item.name===name)
    expect(school).toBeTruthy()
    return (await (await request.get(`/api/schools/${school!.id}`)).json()).data
  }

  const [shandong,dalian]=await Promise.all([schoolDetail('山东大学'),schoolDetail('大连理工大学')])
  expect(shandong.featuredMajors).toHaveLength(74)
  expect([...new Set(shandong.featuredMajors.map((item:{recognitionYear:number})=>item.recognitionYear))].sort()).toEqual([2019,2020,2021])
  expect(shandong.featuredMajors.every((item:{sourceUrl:string})=>/^https:\/\/(www\.)?view\.sdu\.edu\.cn\//.test(item.sourceUrl))).toBe(true)
  expect(dalian.featuredMajors).toHaveLength(57)
  expect(dalian.featuredMajors.every((item:{recognitionYear:null;sourceYear:number;sourceUrl:string})=>item.recognitionYear===null&&item.sourceYear===2025&&item.sourceUrl==='https://teach.dlut.edu.cn/info/1031/16448.htm')).toBe(true)
})

test('学校详情抽屉保持简洁并可展开完整优势专业名录',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'院校地图'}).click()
  const search=page.getByRole('combobox',{name:'搜索院校或城市'})
  await search.fill('山东大学')
  await page.getByRole('option',{name:/山东大学/}).click()
  await page.getByRole('button',{name:'查看 山东大学 详情'}).click()
  const drawer=page.getByRole('dialog',{name:'学校详情'})
  await expect(drawer.getByRole('heading',{name:'山东大学'})).toBeVisible()
  await expect(drawer.getByRole('button',{name:'查看全部 74 个'})).toBeVisible()
  await expect(drawer.locator('.school-major-tags > span')).toHaveCount(12)
  await drawer.getByRole('button',{name:'查看全部 74 个'}).click()
  await expect(drawer.locator('.school-major-tags > span')).toHaveCount(74)
  await expect(drawer.getByRole('button',{name:'收起'})).toBeVisible()
})

test('没有官方优势专业时展示明确标注的推荐关注方向',async({page,request})=>{
  const schools=(await (await request.get('/api/schools?q=北京卫生职业学院&pageSize=10')).json()).data.items as Array<{id:number;name:string}>
  const school=schools.find(item=>item.name==='北京卫生职业学院')
  expect(school).toBeTruthy()
  const detail=(await (await request.get(`/api/schools/${school!.id}`)).json()).data
  expect(detail.featuredMajors).toHaveLength(0)
  expect(detail.recommendedMajors).toHaveLength(3)
  expect(detail.recommendedMajors.every((item:{evidenceLevel:string;basis:string})=>item.evidenceLevel==='orientation'&&item.basis.includes('并非官方优势专业认定'))).toBe(true)

  await page.goto('/')
  await page.getByRole('button',{name:'院校地图'}).click()
  const search=page.getByRole('combobox',{name:'搜索院校或城市'})
  await search.fill('北京卫生职业学院')
  await page.getByRole('option',{name:/北京卫生职业学院/}).click()
  await page.getByRole('button',{name:'查看 北京卫生职业学院 详情'}).click()
  const drawer=page.getByRole('dialog',{name:'学校详情'})
  await expect(drawer.getByText('当前暂无官方优势专业认定，以下为推荐关注，不等同于官方优势专业。')).toBeVisible()
  await expect(drawer.getByText('临床医学方向',{exact:true})).toBeVisible()
  await expect(drawer.getByText('办学方向建议 · 须核验是否招生').first()).toBeVisible()
})

test('首屏不加载地图与 ECharts，进入地图后再按需请求',async({page})=>{
  const requested:string[]=[]
  page.on('request',request=>requested.push(request.url()))
  await page.goto('/')
  await expect(page.getByText('志愿规划工作台').first()).toBeVisible()
  expect(requested.some(url=>/SchoolMap\.vue|echarts/i.test(url))).toBe(false)
  await page.getByRole('button',{name:'院校地图'}).click()
  await expect.poll(()=>requested.some(url=>/SchoolMap\.vue|echarts/i.test(url))).toBe(true)
  await expect(page.getByRole('heading',{name:'从地图开始看学校'})).toBeVisible()
})

test('院校搜索输入几个字即可联想并用键盘补全',async({page})=>{
  await page.goto('/')
  await page.getByRole('button',{name:'院校地图'}).click()
  const search=page.getByRole('combobox',{name:'搜索院校或城市'})
  await search.fill('北京语')
  const suggestions=page.getByRole('listbox',{name:'院校搜索建议'})
  await expect(suggestions).toBeVisible()
  await expect(suggestions.getByRole('option',{name:/北京语言大学/})).toBeVisible()
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(search).toHaveValue('北京语言大学')
  await expect(suggestions).toBeHidden()
  await expect(page.getByRole('button',{name:'查看 北京语言大学 详情'})).toBeVisible()
  await search.fill('上海交')
  await suggestions.getByRole('option',{name:/上海交通大学/}).click()
  await expect(search).toHaveValue('上海交通大学')
  await expect(page.getByRole('button',{name:'查看 上海交通大学 详情'})).toBeVisible()
})
