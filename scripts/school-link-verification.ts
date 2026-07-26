const excludedAdmissionsTerms = /研究生|硕士|博士|继续教育|成人|留学|国际学生|就业|培训/
const preferredAdmissionsTerms = /本科招生|普通本科|招生信息网|招生网|招生办公室|招生办/

export function pageConfirmsSchool(schoolName: string, html: string) {
  const expected = normalizeText(schoolName)
  const content = normalizeText(html.slice(0, 1_500_000).replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' '))
  return expected.length >= 4 && content.includes(expected)
}

export function extractAdmissionsCandidates(html: string, baseUrl: string) {
  const candidates: Array<{ url: string; score: number }> = []
  const base = new URL(baseUrl)
  const anchorPattern = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(anchorPattern)) {
    const label = decodeEntities(stripTags(match[2])).replace(/\s+/g, '')
    if (excludedAdmissionsTerms.test(label)) continue
    try {
      const url = new URL(decodeEntities(match[1]), baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      const directlyNamedPortal = preferredAdmissionsTerms.test(label)
      const genericSubdomainEntry = label === '招生信息' && url.hostname !== base.hostname
      if (!directlyNamedPortal && !genericSubdomainEntry) continue
      url.hash = ''
      const score = /本科招生|普通本科/.test(label) ? 3 : /招生信息网|招生网/.test(label) ? 2 : 1
      candidates.push({ url: url.toString(), score })
    } catch { /* 忽略页面中的无效链接 */ }
  }
  return [...new Map(candidates.sort((a, b) => b.score - a.score).map(item => [item.url, item])).values()].map(item => item.url)
}

export function extractSchoolWebsiteRows(html:string,schoolNames:string[]){
  const found=new Map<string,string>()
  for(const row of html.match(/<tr\b[\s\S]*?<\/tr>/gi)??[]){
    const text=decodeEntities(stripTags(row)).replace(/\s+/g,'')
    const schoolName=schoolNames.find(name=>text.includes(name.replace(/\s+/g,'')))
    if(!schoolName)continue
    const urls=[...row.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map(match=>decodeEntities(match[1]))
      .filter(url=>!/(wikipedia|wikimedia|archive\.org|gov\.cn\/)/i.test(url))
      .sort((a,b)=>Number(!/\.edu\.cn(?:\/|$)/i.test(a))-Number(!/\.edu\.cn(?:\/|$)/i.test(b))||a.length-b.length)
    if(urls[0])found.set(schoolName,urls[0])
  }
  return found
}

function stripTags(value: string) {
  return value.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
}

function normalizeText(value: string) {
  return decodeEntities(value).normalize('NFKC').replace(/[\s·•・—_()（）\[\]【】]/g, '').toLowerCase()
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}
