import { Router } from 'express'
import type { DatabaseRow as RowDataPacket } from './database.js'
import { chromium } from 'playwright'
import { z } from 'zod'
import { database } from './database.js'

export const reportsRouter = Router()

reportsRouter.get('/profiles/:id/report.pdf', async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id)
    const [profiles] = await database.execute<RowDataPacket[]>(`SELECT sp.student_name studentName,p.name province,sp.subject_group subjectGroup,sp.score,sp.province_rank provinceRank,sp.updated_at updatedAt FROM student_profiles sp JOIN provinces p ON p.id=sp.province_id WHERE sp.id=?`, [id])
    if (!profiles[0]) { response.status(404).send('学生档案不存在'); return }
    const [snapshots] = await database.execute<RowDataPacket[]>(`SELECT result,generated_at generatedAt FROM recommendation_snapshots WHERE profile_id=?`, [id])
    const report = { profile: profiles[0], recommendation: snapshots[0] ?? null }
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(renderReport(report), { waitUntil: 'load' })
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' } })
      response.setHeader('Content-Type', 'application/pdf')
      response.setHeader('Content-Disposition', `attachment; filename="zhixiang-report-${id.slice(0, 8)}.pdf"`)
      response.send(pdf)
    } finally { await browser.close() }
  } catch (error) { next(error) }
})

function renderReport(data: { profile: RowDataPacket; recommendation: RowDataPacket|null }) {
  const recommendation = parse<{sourceYear:number|null;dataYears?:number[];warning:string;planningCoordinate?:{rank:number|null;sampleCount:number};sources?:Array<{title:string;sourceUrl:string;sourceYear:number;publisher:string}>;candidates:Array<{schoolName:string;province:string;city:string;level:string;risk:string;referenceRank:number;ruleScore:number;majors:Array<{name:string;fit:string}>}>}>(data.recommendation?.result) ?? { sourceYear:null, warning:'尚未生成候选清单', candidates:[] }
  const planningRank=recommendation.planningCoordinate?.rank??(data.profile.provinceRank==null?null:Number(data.profile.provinceRank))
  const planningSamples=recommendation.planningCoordinate?.sampleCount??(planningRank?1:0)
  const scoreText=data.profile.score==null?'—':String(data.profile.score)
  const rankText=planningRank==null?'—':planningRank.toLocaleString()
  const rows = recommendation.candidates.slice(0,18).map((item,index)=>`<tr><td>${index+1}</td><td><b>${safe(item.schoolName)}</b><small>${safe(item.province)} · ${safe(item.city)} · ${safe(item.level)}</small></td><td class="${item.risk}">${item.risk}</td><td>${item.referenceRank.toLocaleString()}</td><td>${item.ruleScore}</td><td>${item.majors.slice(0,2).map(major=>safe(major.name)).join('、')}</td></tr>`).join('')
  const sources = (recommendation.sources??[]).map(item=>`<li><b>${item.sourceYear} · ${safe(item.publisher)}</b><span>${safe(item.title)}</span><small>${safe(item.sourceUrl)}</small></li>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${reportCss}</style></head><body><header><i>知</i><div><h1>高考志愿规划报告</h1><p>家长主导 · 学生共同参与 · 公开档案分析</p></div><span>${new Date().toLocaleDateString('zh-CN')}</span></header><section class="hero"><div><small>学生档案</small><h2>${safe(data.profile.studentName)}</h2><p>${safe(data.profile.province)} · ${safe(data.profile.subjectGroup)}</p></div><strong>${scoreText}<small>${data.profile.score==null?'当前分数未记录':'当前分数'}</small></strong><strong>${rankText}<small>${planningRank==null?'规划位次未形成':`综合规划位次 · ${planningSamples} 次`}</small></strong></section><section><h3>01 院校 / 专业候选</h3><p class="note">实际使用年份：${recommendation.dataYears?.join('、')??recommendation.sourceYear??'暂无'}。${safe(recommendation.warning)}</p>${rows?`<table><thead><tr><th>#</th><th>学校</th><th>层级</th><th>参考位次</th><th>规则评分</th><th>专业方向</th></tr></thead><tbody>${rows}</tbody></table>`:`<div class="empty">${planningRank==null?'尚未形成规划位次，当前不生成冲稳保。':'本省官方数据尚未导入，暂不生成冲稳保。'}</div>`}</section><section><h3>02 数据来源</h3>${sources?`<ul class="sources">${sources}</ul>`:'<p>暂无可列出的招生数据来源。</p>'}</section><footer><b>不确定性与重要说明</b><p>本报告仅作家庭讨论与信息整理，不构成录取承诺。综合规划位次取最近最多 5 次有效全省位次的中位数，只用于减少单次模考波动，不预测高考成绩或录取概率。往年位次会受招生计划、专业组调整与考生偏好变化影响；正式填报前，请以当年省级教育考试院招生计划、选科要求和院校招生章程为准。</p></footer></body></html>`
}
function parse<T>(value: unknown): T|null { if (!value) return null; return (typeof value==='string'?JSON.parse(value):value) as T }
function safe(value: unknown){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))}
const reportCss=`*{box-sizing:border-box}body{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#26372e;margin:0;font-size:12px}header{display:flex;align-items:center;border-bottom:2px solid #315d45;padding-bottom:14px}header i{width:42px;height:42px;background:#315d45;color:#fff;border-radius:10px;display:grid;place-items:center;font-style:normal;font-size:22px}header div{margin-left:12px}header h1{margin:0;font-size:22px}header p{margin:4px 0 0;color:#718077}header>span{margin-left:auto;color:#718077}.hero{margin:20px 0;background:#eef3ee;border-radius:14px;padding:20px;display:flex;align-items:center}.hero div{flex:1}.hero h2{font-size:25px;margin:5px 0}.hero p{margin:0;color:#647068}.hero>strong{font-size:28px;margin-left:35px}.hero>strong small{font-size:11px;display:block;color:#728078;text-align:right}section{margin-top:22px}section h3{font-size:16px;border-left:4px solid #d39a52;padding-left:9px}.traits{display:grid;grid-template-columns:1fr 1fr;gap:12px}.trait{padding:14px;border:1px solid #dfe6df;border-radius:10px}.trait b{display:block;margin-bottom:10px}.trait span{display:inline-block;background:#eff4ef;padding:5px 8px;margin-right:7px;border-radius:5px}.note{background:#fff7e9;padding:10px;border-radius:7px;color:#715224}table{width:100%;border-collapse:collapse;margin-top:12px}th{text-align:left;background:#315d45;color:#fff;padding:8px}td{padding:8px;border-bottom:1px solid #e5e9e5}td small{display:block;color:#79837c;margin-top:3px}td.冲{color:#b65c2b}td.稳{color:#31639a}td.保{color:#367349}.sources{list-style:none;padding:0}.sources li{display:grid;gap:3px;padding:8px 10px;border-bottom:1px solid #e5e9e5}.sources li span,.sources li small{color:#68766d}.sources li small{font-size:9px}.empty{padding:25px;background:#f4f6f4;text-align:center}footer{margin-top:26px;padding:15px;background:#f1f3f0;border-radius:9px;color:#5d685f}footer p{line-height:1.7;margin:6px 0 0}`
