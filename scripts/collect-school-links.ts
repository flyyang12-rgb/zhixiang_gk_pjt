import 'dotenv/config'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { DatabaseRow as RowDataPacket } from '../server/database.js'
import { database } from '../server/database.js'
import { extractAdmissionsCandidates, extractSchoolWebsiteRows, pageConfirmsSchool } from './school-link-verification.js'

type SchoolRow = RowDataPacket & { id:number;name:string;province:string;level:string;features:unknown;officialUrl:string|null;admissionsUrl:string|null }
type Candidate = { officialUrl:string; discoverySource:string }
type Result = { id:number;name:string;status:'verified'|'official_only'|'pending'|'error';officialUrl?:string;admissionsUrl?:string;reason?:string;discoverySource?:string }
type SparqlResponse = { results:{ bindings:Array<{ item:{value:string};code:{value:string};website:{value:string} }> } }

const USER_AGENT = 'ZhixiangSchoolLinkCollector/1.0 (official-link-verification)'
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'
const WIKIPEDIA_API = 'https://zh.wikipedia.org/w/api.php'
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const concurrency = positiveInteger(flagValue('--concurrency')) ?? 8
const limit = positiveInteger(flagValue('--limit'))
const refresh = process.argv.includes('--refresh')
const schoolName = flagValue('--school')
const useTitleFallback = process.argv.includes('--title-fallback')
const officialMissingOnly = process.argv.includes('--official-missing-only')
const useProvinceLists = process.argv.includes('--province-lists')
const provinceListsOnly = process.argv.includes('--province-lists-only')
const fastVerify = process.argv.includes('--fast')
const curlFallback = process.argv.includes('--curl-fallback')
const reportPath = resolve(flagValue('--report') ?? '.scratch/school-link-collection-report.json')
const discoveryWarnings:string[]=[]
const execFileAsync=promisify(execFile)

async function run() {
  const conditions:string[]=[];const parameters:string[]=[]
  if(!refresh)conditions.push(officialMissingOnly?'official_url IS NULL':'(official_url IS NULL OR admissions_url IS NULL)')
  if(schoolName){conditions.push('name=?');parameters.push(schoolName)}
  const [rows] = await database.execute<SchoolRow[]>(
    `SELECT s.id,s.name,p.name province,s.level,s.features,s.official_url officialUrl,s.admissions_url admissionsUrl
     FROM schools s JOIN provinces p ON p.id=s.province_id ${conditions.length?`WHERE ${conditions.map(item=>item.replace(/\b(official_url|admissions_url|name)\b/g,'s.$1')).join(' AND ')}`:''} ORDER BY s.id`,parameters,
  )
  const schools = limit ? rows.slice(0, limit) : rows
  const discovered = await discoverOfficialCandidates(schools)
  const results = await mapConcurrent(schools, concurrency, school => verifySchool(school, discovered.get(school.id)))
  await mkdir(resolve('.scratch'), { recursive: true })
  const summary = {
    generatedAt: new Date().toISOString(), mode:'candidate-only', requested: schools.length,
    verified: results.filter(item => item.status === 'verified').length,
    officialOnly: results.filter(item => item.status === 'official_only').length,
    pending: results.filter(item => item.status === 'pending').length,
    errors: results.filter(item => item.status === 'error').length,discoveryWarnings,
    results,
  }
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  const candidatePath=resolve('.scratch/school-links.candidates.json')
  const candidates=results.filter(item=>item.status==='verified'||item.status==='official_only').map(item=>({schoolName:item.name,officialUrl:item.officialUrl??null,admissionsUrl:item.admissionsUrl??null,sourceUrl:item.discoverySource,evidenceUrl:item.officialUrl,discoveredAt:new Date().toISOString()}))
  await writeFile(candidatePath,`${JSON.stringify(candidates,null,2)}\n`,'utf8')
  console.log(JSON.stringify({ reportPath,candidatePath,notice:'候选不会自动写入数据库；人工核验后请复制到 data/school-links.json 并执行 npm run data:school-links。', ...summary, results: undefined }, null, 2))
}

async function discoverOfficialCandidates(schools: SchoolRow[]) {
  const byId = new Map<number, Candidate>()
  const byCode = new Map<string, SchoolRow>()
  for (const school of schools) {
    const features = typeof school.features === 'string' ? JSON.parse(school.features) as Record<string,unknown> : school.features as Record<string,unknown>
    const code = String(features?.institutionCode ?? '').trim()
    if (code) byCode.set(code, school)
    if (school.officialUrl) byId.set(school.id, { officialUrl:school.officialUrl, discoverySource:school.officialUrl })
  }

  const query = 'SELECT ?item ?code ?website WHERE { ?item wdt:P10472 ?code; wdt:P856 ?website. }'
  const sparqlUrl = `${WIKIDATA_SPARQL}?${new URLSearchParams({ query, format:'json' })}`
  const sparql = provinceListsOnly?{results:{bindings:[]}}:await fetchJsonCached<SparqlResponse>(sparqlUrl,resolve('.scratch/wikidata-school-websites.json'))
  for (const binding of sparql.results.bindings) {
    const school = byCode.get(binding.code.value)
    if (school && isHttpUrl(binding.website.value)) {
      const current=byId.get(school.id)
      if(!current || (current.discoverySource.includes('wikidata.org/entity/') && urlPreference(binding.website.value,current.officialUrl)<0)) {
        byId.set(school.id, { officialUrl:binding.website.value, discoverySource:binding.item.value })
      }
    }
  }

  const unresolved = useTitleFallback ? schools.filter(school => !byId.has(school.id)) : []
  await mapConcurrent(chunks(unresolved,40),4,async batch=>{
    const params = new URLSearchParams({ action:'query',format:'json',formatversion:'2',redirects:'1',prop:'pageprops',ppprop:'wikibase_item',titles:batch.map(item=>item.name).join('|') })
    let pageData:{query?:{normalized?:Array<{from:string;to:string}>;redirects?:Array<{from:string;to:string}>;pages?:Array<{title:string;missing?:boolean;pageprops?:{wikibase_item?:string}}>}}
    try{pageData=await fetchJson(`${WIKIPEDIA_API}?${params}`,12_000,1)}catch(error){discoveryWarnings.push(`百科标题批次失败（${batch[0]?.name} 起）：${error instanceof Error?error.message:'未知错误'}`);return}
    const aliases = new Map(batch.map(item => [normalizeName(item.name), item]))
    for (const item of pageData.query?.normalized ?? []) { const school=aliases.get(normalizeName(item.from)); if(school)aliases.set(normalizeName(item.to),school) }
    for (const item of pageData.query?.redirects ?? []) { const school=aliases.get(normalizeName(item.from)); if(school)aliases.set(normalizeName(item.to),school) }
    const entities = (pageData.query?.pages ?? []).flatMap(page => {
      const school=aliases.get(normalizeName(page.title));const entity=page.pageprops?.wikibase_item
      return school&&entity?[{school,entity}]:[]
    })
    for (const entityBatch of chunks(entities, 40)) {
      const entityParams = new URLSearchParams({ action:'wbgetentities',format:'json',formatversion:'2',props:'claims',ids:entityBatch.map(item=>item.entity).join('|') })
      let entityData:{entities:Record<string,{claims?:{P856?:Array<{rank?:string;mainsnak?:{datavalue?:{value?:string}}}>}}>}
      try{entityData=await fetchJson(`${WIKIDATA_API}?${entityParams}`,15_000,2)}catch(error){discoveryWarnings.push(`实体批次失败（${entityBatch[0]?.school.name} 起）：${error instanceof Error?error.message:'未知错误'}`);continue}
      for (const item of entityBatch) {
        const websites=(entityData.entities[item.entity]?.claims?.P856??[]).map(claim=>String(claim.mainsnak?.datavalue?.value??'')).filter(isHttpUrl)
        const officialUrl=websites.sort(urlPreference)[0]
        if(officialUrl)byId.set(item.school.id,{officialUrl,discoverySource:`https://www.wikidata.org/wiki/${item.entity}`})
      }
    }
  })
  if(useProvinceLists){
    const remaining=schools.filter(school=>!byId.has(school.id))
    const grouped=new Map<string,SchoolRow[]>()
    for(const school of remaining)grouped.set(school.province,[...(grouped.get(school.province)??[]),school])
    await mapConcurrent([...grouped.entries()],5,async([province,items])=>{
      const title=`${provinceFullName(province)}高等学校列表`
      const sourceUrl=`https://zh.wikipedia.org/wiki/${encodeURIComponent(title)}`
      try{
        const page=await fetchDiscoveryHtml(sourceUrl)
        for(const [name,officialUrl] of extractSchoolWebsiteRows(page.html,items.map(item=>item.name))){
          const school=items.find(item=>item.name===name)
          if(school)byId.set(school.id,{officialUrl,discoverySource:sourceUrl})
        }
      }catch(error){discoveryWarnings.push(`${province}学校列表失败：${error instanceof Error?error.message:'未知错误'}`)}
    })
  }
  return byId
}

async function verifySchool(school: SchoolRow, candidate?: Candidate): Promise<Result> {
  if (!candidate) return { id:school.id,name:school.name,status:'pending',reason:'权威目录和结构化候选源均未提供官网' }
  try {
    const official = await fetchHtml(candidate.officialUrl)
    if (!pageConfirmsSchool(school.name, official.html)) {
      return { id:school.id,name:school.name,status:'pending',reason:'候选页面未明确出现完整校名',discoverySource:candidate.discoverySource }
    }
    let admissionsUrl = school.admissionsUrl
    if (!admissionsUrl) {
      const links = extractAdmissionsCandidates(official.html, official.finalUrl).slice(0, 8)
      for (const link of links) {
        try {
          const admissions = await fetchHtml(link)
          if (/招生/.test(plainText(admissions.html))) { admissionsUrl=admissions.finalUrl; break }
        } catch { /* 继续核验下一个由官网直接给出的入口 */ }
      }
    }
    return { id:school.id,name:school.name,status:admissionsUrl?'verified':'official_only',officialUrl:official.finalUrl,admissionsUrl:admissionsUrl??undefined,discoverySource:candidate.discoverySource }
  } catch (error) {
    return { id:school.id,name:school.name,status:'error',reason:error instanceof Error?error.message:'未知错误',discoverySource:candidate.discoverySource }
  }
}

async function fetchHtml(url:string) {
  try{
    const response = await fetchWithRetries(url, { redirect:'follow',headers:{'User-Agent':USER_AGENT,'Accept':'text/html,application/xhtml+xml'} },15_000,fastVerify?1:3)
    if (!response.ok) throw new Error(`官网返回 ${response.status}`)
    const type=response.headers.get('content-type')??''
    if(!/text\/html|application\/xhtml\+xml/i.test(type))throw new Error(`官网返回非 HTML 内容：${type||'未知类型'}`)
    const bytes=new Uint8Array(await response.arrayBuffer()).slice(0,2_500_000)
    return {html:decodeHtml(bytes,type),finalUrl:response.url}
  }catch(error){if(curlFallback)return fetchHtmlWithCurl(url);throw error}
}

async function fetchDiscoveryHtml(url:string){
  try{return await fetchHtml(url)}catch(fetchError){
    try{return await fetchHtmlWithCurl(url)}
    catch{throw fetchError}
  }
}

async function fetchHtmlWithCurl(url:string){
  const {stdout}=await execFileAsync('curl.exe',['-L','--fail','--silent','--show-error','--max-time','25','-A',USER_AGENT,url],{encoding:'buffer',maxBuffer:5_000_000})
  const bytes=new Uint8Array(stdout).slice(0,2_500_000)
  return {html:decodeHtml(bytes,''),finalUrl:url}
}

function decodeHtml(bytes:Uint8Array,contentType:string){
  const head=new TextDecoder('ascii').decode(bytes.slice(0,4000))
  const charset=(contentType.match(/charset=([^;\s]+)/i)?.[1]??head.match(/charset=["']?([^\s"'/>]+)/i)?.[1]??'utf-8').replace(/["']/g,'')
  try{return new TextDecoder(/gbk|gb2312|gb18030/i.test(charset)?'gb18030':'utf-8').decode(bytes)}catch{return new TextDecoder('utf-8').decode(bytes)}
}

async function fetchJson<T>(url:string,timeoutMs=45_000,attempts=3):Promise<T>{
  const response=await fetchWithRetries(url,{headers:{'User-Agent':USER_AGENT,'Accept':'application/json'}},timeoutMs,attempts)
  if(!response.ok)throw new Error(`数据源返回 ${response.status}：${url}`)
  return await response.json() as T
}

async function fetchJsonCached<T>(url:string,cachePath:string):Promise<T>{
  try{const value=await fetchJson<T>(url);await mkdir(resolve('.scratch'),{recursive:true});await writeFile(cachePath,`${JSON.stringify(value)}\n`,'utf8');return value}
  catch(error){try{return JSON.parse(await readFile(cachePath,'utf8')) as T}catch{throw error}}
}

async function fetchWithRetries(url:string,init:RequestInit,timeoutMs:number,attempts=3){
  let lastError:unknown
  for(let attempt=0;attempt<attempts;attempt+=1){
    try{const response=await fetch(url,{...init,signal:AbortSignal.timeout(timeoutMs)});if(response.status!==429&&response.status<500)return response;lastError=new Error(`HTTP ${response.status}`);await response.body?.cancel()}
    catch(error){lastError=error}
    await delay(500*(attempt+1))
  }
  throw lastError instanceof Error?lastError:new Error('网络请求失败')
}

function plainText(html:string){return html.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')}
function flagValue(name:string){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined}
function positiveInteger(value:string|undefined){if(!value)return undefined;const result=Number.parseInt(value,10);if(!Number.isInteger(result)||result<=0)throw new Error(`${value} 不是正整数`);return result}
function normalizeName(value:string){return value.normalize('NFKC').replace(/[\s()（）·•・]/g,'').toLowerCase()}
function isHttpUrl(value:string){try{return ['http:','https:'].includes(new URL(value).protocol)}catch{return false}}
function urlPreference(a:string,b:string){return websiteScore(b)-websiteScore(a)||a.length-b.length}
function websiteScore(value:string){const url=new URL(value);let score=value.startsWith('https://')?3:0;if(url.hostname.startsWith('www.'))score+=2;if(/^(en|english)\./i.test(url.hostname))score-=6;return score}
function provinceFullName(value:string){if(['北京','天津','上海','重庆'].includes(value))return `${value}市`;if(value==='内蒙古')return '内蒙古自治区';if(value==='广西')return '广西壮族自治区';if(value==='西藏')return '西藏自治区';if(value==='宁夏')return '宁夏回族自治区';if(value==='新疆')return '新疆维吾尔自治区';return `${value}省`}
function chunks<T>(items:T[],size:number){const result:T[][]=[];for(let i=0;i<items.length;i+=size)result.push(items.slice(i,i+size));return result}
function delay(ms:number){return new Promise(resolve=>setTimeout(resolve,ms))}
async function mapConcurrent<T,R>(items:T[],workers:number,task:(item:T)=>Promise<R>){const result=new Array<R>(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(workers,items.length)},async()=>{while(true){const index=cursor++;if(index>=items.length)return;result[index]=await task(items[index]!)}}));return result}

run().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1}).finally(()=>database.end())
