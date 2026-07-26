import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('长对话只滚动消息区并保持输入区可见', async ({ page }) => {
  const advisorCss = await readFile('src/advisor.css', 'utf8')
  const messages = Array.from({ length: 30 }, (_, index) => `<div class="message ${index % 2 ? 'user' : 'assistant'}"><small>消息</small><p>第 ${index + 1} 条较长的家庭讨论内容，用来验证消息持续增加时页面布局不会向下无限膨胀。</p></div>`).join('')

  await page.setContent(`
    <style>*{box-sizing:border-box}html,body{margin:0;height:100%}${advisorCss}</style>
    <div class="advisor-workspace">
      <section class="advisor-canvas">
        <div class="advisor-page">
          <header><div><h2>知向规划顾问</h2></div></header>
          <div class="advisor-layout">
            <aside>讨论底稿</aside>
            <main>
              <div class="message-list">${messages}</div>
              <div class="quick-asks"><button>学校还是专业</button></div>
              <form><textarea></textarea><button>发送</button></form>
            </main>
          </div>
        </div>
      </section>
    </div>
  `)

  const dimensions = await page.locator('.message-list').evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    clientWidth: element.clientWidth,
    overflowY: getComputedStyle(element).overflowY,
  }))
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight)
  expect(dimensions.clientHeight).toBeGreaterThanOrEqual(380)
  expect(dimensions.clientWidth).toBeGreaterThanOrEqual(900)
  expect(dimensions.overflowY).toBe('scroll')
  await expect(page.locator('form')).toBeInViewport()
})
