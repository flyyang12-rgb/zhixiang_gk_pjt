import { expect, test, type Page } from '@playwright/test'

test.use({ deviceScaleFactor: 2, video: 'on' })

const success = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ success: true, data, error: null, requestId: 'map-motion-test' }),
})

async function openMockMap(page: Page) {
  await page.addInitScript(() => localStorage.removeItem('zhixiang.currentProfileId'))
  // Every API request is intercepted, including unexpected ones; this suite never writes a database.
  await page.route('**/api/**', route => route.fulfill({ status: 404, body: 'mock-only test' }))
  await page.route('**/api/admin/data-status', route => route.fulfill(success({ coverage: [], yearStatus: [] })))
  await page.route('**/api/map/provinces', route => route.fulfill(success({
    items: [{ name: '山东', schoolCount: 1, keyUniversityCount: 1, vocationalCount: 0 }],
    source: { title: '全国普通高等学校名单', sourceUrl: 'https://www.moe.gov.cn/example', publisher: '中华人民共和国教育部', publishedAt: '2026-06-18', effectiveAt: '2026-06-17' },
  })))
  await page.route('**/api/schools?**', route => route.fulfill(success({
    items: [{ id: 1, name: '测试大学', province: '山东', city: '济南', level: '本科', schoolType: '公办', features: {} }],
    total: 1, page: 1, pageSize: 24,
  })))
  await page.goto('/')
  await page.getByRole('button', { name: '院校地图' }).click()
  await expect(page.getByRole('heading', { name: '从地图开始看学校' })).toBeVisible()
}

async function pupilOffset(page: Page) {
  return page.locator('.map-basketball-motion__pupil').first().evaluate(element => {
    const matrix = (element as SVGGraphicsElement).transform.baseVal.consolidate()?.matrix
    return { x: matrix?.e ?? 0, y: matrix?.f ?? 0 }
  })
}

test('全身人物视线随鼠标移动且不越界，离开与失焦时回正', async ({ page }, testInfo) => {
  await openMockMap(page)
  const mascot = page.getByTestId('map-basketball-motion')
  await expect(mascot).toHaveClass(/is-ready/)
  await expect(page.locator('.map-basketball-motion__figure')).toHaveCSS('opacity', '1')
  expect(await mascot.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
  await page.screenshot({ path: testInfo.outputPath('map-header.png') })
  await mascot.screenshot({ path: testInfo.outputPath('mascot-center.png') })

  await page.mouse.move(25, 130)
  await expect.poll(async () => (await pupilOffset(page)).x).toBeLessThan(-8)
  await mascot.screenshot({ path: testInfo.outputPath('mascot-left.png') })

  await page.mouse.move(1260, 130)
  await expect.poll(async () => (await pupilOffset(page)).x).toBeGreaterThan(8)
  await mascot.screenshot({ path: testInfo.outputPath('mascot-right.png') })

  const bounds = await page.locator('.map-basketball-motion__figure').boundingBox()
  if (!bounds) throw new Error('人物未显示')
  const eyeX = bounds.x + bounds.width * 424 / 1024
  await page.mouse.move(eyeX, 0)
  await expect.poll(async () => (await pupilOffset(page)).y).toBeLessThan(-8)
  await page.mouse.move(eyeX, 790)
  await expect.poll(async () => (await pupilOffset(page)).y).toBeGreaterThan(12)
  await page.mouse.move(1260, 790)
  await expect.poll(async () => (await pupilOffset(page)).x).toBeGreaterThan(3)
  const diagonal = await pupilOffset(page)
  expect(Math.hypot(diagonal.x / 12, diagonal.y / 18)).toBeLessThanOrEqual(1)
  await mascot.screenshot({ path: testInfo.outputPath('mascot-down-right.png') })

  await page.mouse.move(-20, -20)
  await expect.poll(async () => Math.hypot(...Object.values(await pupilOffset(page)))).toBeLessThan(0.05)
  await page.mouse.move(30, 200)
  await expect.poll(async () => (await pupilOffset(page)).x).toBeLessThan(-8)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect.poll(async () => Math.hypot(...Object.values(await pupilOffset(page)))).toBe(0)
  await expect(mascot).toHaveAttribute('data-gaze-state', 'resting')
})

test('人物不拦截地图缩放筛选和返回操作，重入时正常响应', async ({ page }) => {
  await openMockMap(page)
  await expect(page.getByTestId('map-basketball-motion')).toHaveClass(/is-ready/)
  const canvas = page.locator('.china-map canvas').first()
  await expect(canvas).toBeVisible()
  const beforeZoom = await canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())
  await page.locator('.china-map').hover()
  await page.mouse.wheel(0, -400)
  await expect.poll(() => canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(beforeZoom)
  await page.locator('.china-map').click({ position: { x: 454, y: 216 } })
  await expect(page.locator('.province-chip')).not.toHaveText('全国')
  await page.getByRole('button', { name: '返回规划' }).click()
  await expect(page.getByRole('heading', { name: '先建立一份学生档案' })).toBeVisible()
  await page.getByRole('button', { name: '院校地图' }).click()
  await expect(page.getByTestId('map-basketball-motion')).toHaveClass(/is-ready/)
  await page.mouse.move(1250, 100)
  await expect.poll(async () => (await pupilOffset(page)).x).toBeGreaterThan(8)
})

test('窄屏布局、动态减少效果、触控与素材失败保持可用', async ({ page }, testInfo) => {
  await openMockMap(page)
  const mascot = page.getByTestId('map-basketball-motion')
  await expect(mascot).toHaveClass(/is-ready/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(mascot).toHaveAttribute('data-gaze-state', 'static')
  await page.mouse.move(1250, 100)
  expect(await pupilOffset(page)).toEqual({ x: 0, y: 0 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 1200, clientY: 700 })))
  expect(await pupilOffset(page)).toEqual({ x: 0, y: 0 })
  await page.mouse.move(1240, 110)
  await expect.poll(async () => (await pupilOffset(page)).x).toBeGreaterThan(8)

  await page.setViewportSize({ width: 1100, height: 700 })
  await expect(mascot).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '返回规划' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('map-mobile.png') })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.route('**/motion/map-basketball/mascot.webp', route => route.abort())
  await page.reload()
  await page.getByRole('button', { name: '院校地图' }).click()
  await expect(page.locator('.map-basketball-motion__figure')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '返回规划' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看 测试大学 详情' })).toBeVisible()
})
