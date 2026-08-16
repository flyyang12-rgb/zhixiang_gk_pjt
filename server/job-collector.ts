import { createHash } from 'node:crypto'
import type { DatabaseResult, DatabaseRow as RowDataPacket } from './database.js'
import { database } from './database.js'

type JobPosting = {
  title?: string
  datePosted?: string
  validThrough?: string
  hiringOrganization?: { name?: string }
  jobLocation?: Array<{ address?: { addressRegion?: string; addressLocality?: string } }> | { address?: { addressRegion?: string; addressLocality?: string } }
  educationRequirements?: string | { credentialCategory?: string }
  url?: string
}

type Direction = { id: number; aliases: string[] }

export function postingFingerprint(input: { employer: string; directionId: number; city: string; education: string; publishedAt: string }) {
  const dayBucket = input.publishedAt.slice(0, 10)
  return createHash('sha256').update([normalize(input.employer), input.directionId, normalize(input.city), normalize(input.education), dayBucket].join('|')).digest('hex')
}

export function matchDirection(title: string, directions: Direction[]) {
  const normalizedTitle = normalize(title)
  return directions.find(direction => direction.aliases.some(alias => normalizedTitle.includes(normalize(alias))))?.id ?? null
}

export async function collectEmploymentData(now = new Date()) {
  const [sourceRows] = await database.query<RowDataPacket[]>(`SELECT id,name,base_url baseUrl FROM job_sources WHERE status <> 'paused'`)
  const [directionRows] = await database.query<RowDataPacket[]>(`SELECT id,aliases FROM job_directions WHERE reviewed_at IS NOT NULL`)
  const directions: Direction[] = directionRows.map(row => ({ id: Number(row.id), aliases: parseJson<string[]>(row.aliases) }))
  const summary = { sources: sourceRows.length, succeeded: 0, failed: 0, inserted: 0, skipped: 0 }

  for (const source of sourceRows) {
    try {
      const postings = await fetchJobPostings(String(source.baseUrl))
      for (const posting of postings) {
        const title = posting.title?.trim() ?? ''
        const directionId = matchDirection(title, directions)
        const location = Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation
        const province = location?.address?.addressRegion?.trim() ?? ''
        const city = location?.address?.addressLocality?.trim() ?? province
        const employer = posting.hiringOrganization?.name?.trim() ?? ''
        const publishedAt = validDate(posting.datePosted) ?? now.toISOString().slice(0, 10)
        const education = typeof posting.educationRequirements === 'string' ? posting.educationRequirements : posting.educationRequirements?.credentialCategory ?? '未注明'
        if (!title || !employer || !province || !directionId) { summary.skipped += 1; continue }
        const expiresAt = addDays(publishedAt, 30)
        if (expiresAt < now.toISOString().slice(0, 10)) { summary.skipped += 1; continue }
        const fingerprint = postingFingerprint({ employer, directionId, city, education, publishedAt })
        const [result] = await database.execute<DatabaseResult>(
          `INSERT INTO job_postings
           (fingerprint,source_id,job_direction_id,employer,title,province,city,education,published_at,source_url,expires_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (fingerprint,source_id) DO NOTHING`,
          [fingerprint, source.id, directionId, employer, title, province, city, education, publishedAt, posting.url ?? source.baseUrl, expiresAt],
        )
        summary.inserted += result.affectedRows
      }
      await database.execute(`UPDATE job_sources SET status='healthy',last_success_at=NOW(),failure_count=0 WHERE id=?`, [source.id])
      summary.succeeded += 1
    } catch {
      await database.execute(`UPDATE job_sources SET status=CASE WHEN failure_count>=2 THEN 'degraded' ELSE status END,last_failure_at=NOW(),failure_count=failure_count+1 WHERE id=?`, [source.id])
      summary.failed += 1
    }
  }

  await database.execute(`DELETE FROM job_postings WHERE expires_at < CURRENT_DATE OR published_at < CURRENT_DATE-INTERVAL '30 days'`)
  await rebuildDailyStats(now)
  return summary
}

async function fetchJobPostings(url: string) {
  if (url.includes('ncss.cn/student/jobs/jobslist/ajax')) return fetchNcssJobs(url)
  if (url.includes('job.mohrss.gov.cn/cjobs/jobinfolist/listJobinfolist')) return fetchMohrssJobs(url)
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: 'text/html,application/ld+json', 'User-Agent': 'ZhixiangEmploymentResearch/1.0 (+public-data; no-login)' } })
  if (!response.ok) throw new Error(`source returned ${response.status}`)
  const text = await response.text()
  const documents = [...text.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1])
  if (!documents.length && response.headers.get('content-type')?.includes('json')) documents.push(text)
  return documents.flatMap(document => {
    try { return findJobPostings(JSON.parse(document)) }
    catch { return [] }
  })
}

async function fetchNcssJobs(baseUrl: string) {
  const postings: JobPosting[]=[]
  for(const keyword of collectionKeywords){
    const url=new URL(baseUrl);url.searchParams.set('offset','1');url.searchParams.set('limit','20');url.searchParams.set('jobName',keyword)
    const response=await fetch(url,{signal:AbortSignal.timeout(12_000),headers:{Accept:'application/json','User-Agent':'ZhixiangEmploymentResearch/1.0 (+public-data; no-login)',Referer:'https://www.ncss.cn/student/jobs/index.html','X-Requested-With':'XMLHttpRequest'}})
    if(!response.ok)throw new Error(`NCSS returned ${response.status}`)
    const body=await response.json() as {flag?:boolean;data?:{list?:Array<Record<string,unknown>>}}
    const rows=body.data?.list??[]
    for(const row of rows){
      const publishedAt=timestampDate(row.publishDate)??timestampDate(row.updateDate)
      postings.push({
        title:String(row.jobName??''),datePosted:publishedAt,validThrough:publishedAt?addDays(publishedAt,30):undefined,
        hiringOrganization:{name:String(row.recName??'')},jobLocation:{address:{addressRegion:String(row.areaCodeName??''),addressLocality:String(row.areaCodeName??'')}},
        educationRequirements:String(row.degreeName??'未注明'),url:`https://www.ncss.cn/student/jobs/${String(row.jobId??'')}/detail.html`,
      })
    }
  }
  return postings
}

async function fetchMohrssJobs(baseUrl: string) {
  const postings: JobPosting[]=[]
  for(const keyword of collectionKeywords){
    const url=new URL(baseUrl);url.searchParams.set('pageNo','1');url.searchParams.set('textfield',keyword)
    const response=await fetch(url,{signal:AbortSignal.timeout(20_000),headers:{Accept:'text/html','User-Agent':'ZhixiangEmploymentResearch/1.0 (+public-data; no-login)'}})
    if(!response.ok)throw new Error(`MOHRSS returned ${response.status}`)
    const html=await response.text()
    const match=html.match(/<input id="findjoblist"[^>]*value="([\s\S]*?)" type="hidden"/i)
    if(!match)throw new Error('MOHRSS job payload missing')
    const rows=JSON.parse(decodeHtml(match[1])) as Array<Record<string,unknown>>
    for(const row of rows){
      const regionCode=String(row.aab301??row.area??'')
      const province=provinceByCode(regionCode)??String(row.area_??'')
      const id=String(row.acb200??'')
      postings.push({
        title:String(row.aca112??''),datePosted:String(row.s_aae397??row.s_uptime??''),validThrough:String(row.s_aae398??''),
        hiringOrganization:{name:String(row.aab004??'')},jobLocation:{address:{addressRegion:province,addressLocality:String(row.area_??row.aab302??province)}},
        educationRequirements:'未注明',url:String(row.ace760??'')||`http://job.mohrss.gov.cn/cjobs/jobinfolist/cb21/showgw?id=${id}`,
      })
    }
  }
  return postings
}

function findJobPostings(value: unknown): JobPosting[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(findJobPostings)
  const record = value as Record<string, unknown>
  const current = record['@type'] === 'JobPosting' ? [record as JobPosting] : []
  return current.concat(Object.values(record).flatMap(findJobPostings))
}

async function rebuildDailyStats(now: Date) {
  const statDate = now.toISOString().slice(0, 10)
  await database.execute(`DELETE FROM job_daily_stats WHERE stat_date=?`, [statDate])
  await database.execute(
    `INSERT INTO job_daily_stats (stat_date,major_id,province,job_count,source_count)
     SELECT ?,mjd.major_id,jp.province,COUNT(DISTINCT jp.fingerprint),COUNT(DISTINCT jp.source_id)
     FROM job_postings jp JOIN major_job_directions mjd ON mjd.job_direction_id=jp.job_direction_id AND mjd.review_status='approved'
     WHERE jp.published_at >= ?::date-INTERVAL '30 days' AND jp.expires_at >= ?
     GROUP BY mjd.major_id,jp.province`,
    [statDate, statDate, statDate],
  )
}

function parseJson<T>(value: T | string): T { return typeof value === 'string' ? JSON.parse(value) as T : value }
function normalize(value: string) { return value.trim().toLocaleLowerCase('zh-CN').replace(/[\s（）()\-_/]/g, '') }
function validDate(value?: string) { const match = value?.match(/^\d{4}-\d{2}-\d{2}/); return match?.[0] }
function addDays(date: string, days: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10) }
function timestampDate(value: unknown){const number=Number(value);if(!Number.isFinite(number)||number<=0)return undefined;return new Date(number).toISOString().slice(0,10)}
function decodeHtml(value:string){return value.replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function provinceByCode(code:string){return ({'11':'北京','12':'天津','13':'河北','14':'山西','15':'内蒙古','21':'辽宁','22':'吉林','23':'黑龙江','31':'上海','32':'江苏','33':'浙江','34':'安徽','35':'福建','36':'江西','37':'山东','41':'河南','42':'湖北','43':'湖南','44':'广东','45':'广西','46':'海南','50':'重庆','51':'四川','52':'贵州','53':'云南','54':'西藏','61':'陕西','62':'甘肃','63':'青海','64':'宁夏','65':'新疆'} as Record<string,string>)[code.slice(0,2)]}
const collectionKeywords=['软件工程师','电气工程师','机械工程师','会计','护士','临床医师','法务助理','语文教师','数据分析师']
