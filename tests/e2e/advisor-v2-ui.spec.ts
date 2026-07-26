import {expect,test} from '@playwright/test'

async function createProfile(request:import('@playwright/test').APIRequestContext){
  const response=await request.post('/api/profiles',{data:{studentName:`顾问界面-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:620,provinceRank:12000}})
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data.id as string
}

test('未发送的草稿不留记录，发送后刷新可继续并能删除',async({page,request})=>{
  const profileId=await createProfile(request)
  try{
    await page.goto('/')
    await page.evaluate(id=>localStorage.setItem('zhixiang.currentProfileId',id),profileId)
    await page.reload()
    await page.getByRole('button',{name:'规划顾问'}).click()
    await expect(page.getByRole('heading',{name:'知向规划顾问'})).toBeVisible()
    await expect(page.locator('.message')).toHaveCount(0)
    let list=await request.get(`/api/profiles/${profileId}/advisor/conversations`)
    expect((await list.json()).data.total).toBe(0)

    const question='家里只能承担四年本科，请先说最要紧的风险。'
    await page.locator('#advisor-question').fill(question)
    await page.locator('#advisor-question').press('Enter')
    const summary=page.locator('.message.assistant .advisor-transparency')
    await expect(summary).toBeVisible({timeout:30_000})
    await expect(summary.locator('.confirmed')).toContainText('现在能确定')
    await expect(summary.locator('.unknown')).toContainText('还不能确定')
    await expect(summary.locator('.next-step')).toContainText('下一步只做')
    await expect(page.locator('.message.assistant')).not.toContainText('**')
    await page.reload()
    await page.getByRole('button',{name:'规划顾问'}).click()
    const historyItem=page.locator('.advisor-conversation-list article').first()
    await expect(historyItem).toContainText('条')
    await historyItem.locator('.conversation-main').click()
    await expect(page.locator('.message.user')).toContainText('四年本科')
    await expect(page.locator('.message.assistant .advisor-transparency')).toBeVisible()

    page.once('dialog',dialog=>dialog.accept())
    await historyItem.getByRole('button',{name:/删除/}).click()
    await expect(page.locator('.advisor-conversation-list article')).toHaveCount(0)
    list=await request.get(`/api/profiles/${profileId}/advisor/conversations`)
    expect((await list.json()).data.total).toBe(0)
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

test('手机端聊天记录弹层可打开、关闭并恢复按钮焦点',async({page,request})=>{
  const profileId=await createProfile(request)
  try{
    await page.setViewportSize({width:390,height:844})
    await page.goto('/')
    await page.evaluate(id=>localStorage.setItem('zhixiang.currentProfileId',id),profileId)
    await page.reload()
    await page.getByRole('button',{name:'规划顾问'}).click()
    const trigger=page.getByRole('button',{name:/聊天记录/})
    await trigger.click()
    await expect(page.getByRole('dialog',{name:'聊天记录'})).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog',{name:'聊天记录'})).toHaveCount(0)
    await expect(trigger).toBeFocused()
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})
