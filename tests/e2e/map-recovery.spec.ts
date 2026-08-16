import {expect,test} from '@playwright/test'

const success=(data:unknown)=>({
  status:200,
  contentType:'application/json',
  body:JSON.stringify({success:true,data,error:null,requestId:'map-recovery-test'}),
})

test('地图失败后可重试，来源日期来自接口，列表失败不清空已有学校',async({page})=>{
  let mapCalls=0
  let searchFailed=false
  await page.route('**/api/map/provinces',async route=>{
    mapCalls+=1
    if(mapCalls===1){
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,data:null,error:'院校名单来源暂时不可用',requestId:'map-recovery-test'})})
      return
    }
    await route.fulfill(success({
      items:[{name:'山东',schoolCount:1,keyUniversityCount:1,vocationalCount:0}],
      source:{title:'全国普通高等学校名单',sourceUrl:'https://www.moe.gov.cn/example',publisher:'中华人民共和国教育部',publishedAt:'2026-06-18',effectiveAt:'2026-06-17'},
    }))
  })
  await page.route('**/api/schools?**',async route=>{
    const url=new URL(route.request().url())
    if(url.searchParams.get('q')==='失败搜索'&&!searchFailed){
      searchFailed=true
      await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({success:false,data:null,error:'院校列表暂时不可用',requestId:'map-recovery-test'})})
      return
    }
    const items=url.searchParams.get('q')?[{id:2,name:'重试成功大学',province:'山东',city:'济南',level:'本科',schoolType:'公办',features:{}}]:[{id:1,name:'保留结果大学',province:'山东',city:'济南',level:'本科',schoolType:'公办',features:{}}]
    await route.fulfill(success({items,total:1,page:1,pageSize:24}))
  })

  await page.goto('/')
  await page.getByRole('button',{name:'院校地图'}).click()
  await expect(page.getByRole('alert')).toContainText('院校数据暂时无法加载')
  await page.getByRole('button',{name:'重新加载'}).click()
  await expect(page.getByText('数据截至 2026年6月17日')).toBeVisible()
  await expect(page.getByRole('button',{name:'查看 保留结果大学 详情'})).toBeVisible()

  await page.getByPlaceholder('搜索院校或城市').fill('失败搜索')
  await expect(page.getByRole('alert')).toContainText('当前结果已经保留')
  await expect(page.getByRole('button',{name:'查看 保留结果大学 详情'})).toBeVisible()
  await page.getByRole('alert').getByRole('button',{name:'重新加载'}).click()
  await expect(page.getByRole('button',{name:'查看 重试成功大学 详情'})).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
