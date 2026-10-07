import { chromium } from 'playwright'

// Reports are self-contained. Rendering must never fetch a URL from stored text.
export async function renderPdf(html: string, landscape = false): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true, timeout: 20000 })
  try {
    const page = await browser.newPage({ javaScriptEnabled: false })
    await page.route('**/*', route => route.abort())
    await page.setContent(html, { waitUntil: 'load', timeout: 10000 })
    await page.evaluate(() => document.fonts.ready)
    const pdf = page.pdf({ format: 'A4', landscape, printBackground: true,
      margin: { top: '14mm', right: '13mm', bottom: '17mm', left: '13mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;padding:0 13mm;font-size:9px;color:#617268;display:flex;justify-content:space-between"><span>知向 · 家庭讨论材料</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([pdf, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('PDF rendering timed out')), 20000) })])
    } finally { if (timer) clearTimeout(timer) }
  } finally { await browser.close() }
}
