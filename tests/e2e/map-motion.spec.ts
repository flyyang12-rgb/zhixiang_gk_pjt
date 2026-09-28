import { expect, test, type Page } from '@playwright/test'

const success = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ success: true, data, error: null, requestId: 'map-motion-test' }),
})

async function openMockMap(page: Page) {
  await page.addInitScript(() => localStorage.removeItem('zhixiang.currentProfileId'))
  await page.route('**/api/**', route => route.fulfill({ status: 404, body: 'mock-only test' }))
  await page.route('**/api/admin/data-status', route => route.fulfill(success({ coverage: [], yearStatus: [] })))
  await page.route('**/api/map/provinces', route => route.fulfill(success({
    items: [{ name: '山东', schoolCount: 1, keyUniversityCount: 1, vocationalCount: 0 }],
    source: { title: '全国普通高等学校名单', sourceUrl: 'https://www.moe.gov.cn/example', publisher: '中华人民共和国教育部', publishedAt: '2026-06-18', effectiveAt: '2026-06-17' },
  })))
  await page.route('**/api/schools?**', route => route.fulfill(success({
    items: [{ id: 1, name: '测试大学', province: '山东', city: '济南', level: '本科', schoolType: '公办', features: {} }],
    total: 1,
    page: 1,
    pageSize: 24,
  })))
  await page.goto('/')
  await page.getByRole('button', { name: '院校地图' }).click()
  await expect(page.getByRole('heading', { name: '从地图开始看学校' })).toBeVisible()
}

async function figureX(page: Page) {
  return page.locator('.map-basketball-motion__sprite').evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    return matrix.m41
  })
}

test('人物与篮球随页面滚动正放和倒放，地图操作与返回入口保持可用', async ({ page }, testInfo) => {
  await openMockMap(page)
  const figure = page.getByTestId('map-basketball-motion')
  const sprite = figure.locator('.map-basketball-motion__sprite')
  await expect(figure).toBeVisible()
  await expect(sprite).toHaveClass(/is-ready/)
  expect(await figure.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
  await page.screenshot({ path: testInfo.outputPath('map-header.png') })

  await page.evaluate(() => {
    const candidates = [document.scrollingElement, document.querySelector('.map-canvas'), document.querySelector('.map-page')]
    const scroller = candidates.find(element => element && element.scrollHeight - element.clientHeight >= 150)
    if (!scroller) throw new Error('地图页没有可用的页面滚动距离')
    scroller.scrollTop = 80
  })
  await expect.poll(() => figureX(page)).toBeGreaterThan(15)
  await page.screenshot({ path: testInfo.outputPath('map-scrolled.png') })

  await page.evaluate(() => {
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0
    const canvas = document.querySelector('.map-canvas')
    const mapPage = document.querySelector('.map-page')
    if (canvas) canvas.scrollTop = 0
    if (mapPage) mapPage.scrollTop = 0
  })
  await expect.poll(() => figureX(page)).toBeLessThan(5)
  const canvas = page.locator('.china-map canvas').first()
  await expect(canvas).toBeVisible()
  const mapBeforeZoom = await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())
  await page.locator('.china-map').hover({ position: { x: 560, y: 170 } })
  await page.mouse.wheel(0, -400)
  await expect.poll(() => canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(mapBeforeZoom)
  await expect.poll(() => figureX(page)).toBeLessThan(5)
  await page.locator('.china-map').click({ position: { x: 454, y: 216 } })
  await expect(page.locator('.province-chip')).not.toHaveText('全国')
  await expect.poll(() => figureX(page)).toBeLessThan(5)
  await page.getByRole('button', { name: '返回规划' }).click()
  await expect(page.getByRole('heading', { name: '先建立一份学生档案' })).toBeVisible()
})

test('窄屏隐藏装饰，减少动态效果或资源失败时显示静态首帧', async ({ page }, testInfo) => {
  await openMockMap(page)
  await expect(page.locator('.map-basketball-motion__sprite')).toHaveClass(/is-ready/)

  await page.setViewportSize({ width: 1100, height: 700 })
  await expect(page.getByTestId('map-basketball-motion')).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('map-narrow.png') })

  await page.setViewportSize({ width: 1440, height: 700 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.map-basketball-motion__still')).toBeVisible()
  await expect(page.locator('.map-basketball-motion__sprite')).toBeHidden()

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route('**/motion/map-basketball/character.json', route => route.abort())
  await page.reload()
  await page.getByRole('button', { name: '院校地图' }).click()
  await expect(page.locator('.map-basketball-motion__still')).toBeVisible()
  await expect(page.locator('.map-basketball-motion__sprite')).toBeHidden()
})
