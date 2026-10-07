import type { ExplorationMajorDetail } from './major-exploration.js'
import type { CurrentLearningFact } from './learning-evidence-repository.js'

export type ComparisonProfile = { studentName: string; province: string; subjectGroup: string }
export type SchoolReportDetail = {
  school: { id: number; name: string; city: string; province: string; level: string; schoolType: string; officialUrl: unknown; admissionsUrl: unknown }
  featuredMajors: Array<{ name: string; recognitionType: string; recognitionYear: number | null; sourceYear: number; sourceUrl: string; publisher: string }>
  admissionContext: null | { provinceRank: number | null; records: Array<{ year: number; unitName: string; unitType: string; batch: string; subjectRequirement: string | null; minRank: number | null; risk: string | null; confidence: string; sourceUrl: string | null; publisher: string | null; recommendationExclusionReason: string | null }> }
  interpretation: Array<{ label: string; text: string }>
}
const safe = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
function sourceLink(url: unknown, label: string) {
  try { const parsed = new URL(String(url)); if (!['https:', 'http:'].includes(parsed.protocol)) return safe(label)
    return `<a href="${safe(parsed.href)}">${safe(label)}</a>`
  } catch { return safe(label) }
}
function list(values: string[], empty: string) { return values.length ? `<ul>${values.map(value => `<li>${safe(value)}</li>`).join('')}</ul>` : `<p class="muted">${safe(empty)}</p>` }
function fact(f: CurrentLearningFact, objectName: string) {
  const kinds = { curriculum: '课程与培养', learning_activity: '学习活动', learning_prerequisite: '学习准备', course_prerequisite: '大学课程先修', career_direction: '职业方向', career_requirement: '职业准入门槛', admission_requirement: '招生选科资格' }
  const condition = f.kind === 'admission_requirement' && f.condition ? `<p><b>招生选科条件：</b>${safe(f.condition.mode === 'all' ? `须全部选择 ${f.condition.subjects.join('、')}` : f.condition.mode === 'any' ? `须在 ${f.condition.subjects.join('、')} 中至少选择一门` : '官方材料明确未设选科限制')}（仅适用于下方所注明范围）</p>` : ''
  const scope = [f.school?.name ?? '专业范围', f.scope.province, f.scope.subjectGroup, f.scope.admissionYear ? `${f.scope.admissionYear} 年招生` : null].filter(Boolean).join(' · ')
  return `<article class="fact"><b>${safe(objectName)} · ${kinds[f.kind]}</b><p>${safe(f.content)}</p>${condition}<small>${safe(scope)} · ${f.source.year} 年材料</small><small>${sourceLink(f.source.url, f.source.title)} · ${safe(f.source.publisher)}</small><small>${safe(f.locator.kind === 'page' ? '页码' : f.locator.kind === 'section' ? '章节' : '定位')}：${safe(f.locator.value)} · 核验：${safe(f.review.reviewedAt?.slice(0, 10) ?? '待核验')}</small><small class="url">${safe(f.source.url)}</small></article>`
}
function facts(values: CurrentLearningFact[], objectName: string) { return values.map(value => fact(value, objectName)).join('') }
function frame(profile: ComparisonProfile, title: string, generatedAt: string, body: string, appendix: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${safe(title)}</title><style>${css}</style></head><body><header class="report-head"><div><span>知向 / 比较材料</span><h1>${title}</h1></div><p>${safe(profile.studentName)} 的公开档案<br>${safe(profile.province)} · ${safe(profile.subjectGroup)}<br>生成于 ${safe(new Date(generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}（北京时间）</p></header><p class="intro">按选择顺序整理当前有效资料与已保存备注，供家庭讨论，不表示个人适合度，也不构成录取、就业、收入或升学承诺。培养材料仅适用于注明的学校与年份；往年招生不能代替当年计划。未知选科不表示不限，学校线和未核验专业组不能证明具体专业可报。缺失项保持未知，家庭备注保留原文，不作为已核验事实；不含临时顾问分析。</p>${body}${appendix}</body></html>`
}
function matrix(names: string[], rows: Array<{ label: string; cells: string[] }>) {
  return `<table class="matrix"><thead><tr><th class="dimension">比较维度</th>${names.map(name => `<th>${safe(name)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th>${safe(row.label)}</th>${row.cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}
export function renderMajorComparisonReport(profile: ComparisonProfile, details: ExplorationMajorDetail[], generatedAt: string) {
  // Pending/withdrawn responses must never carry old facts into a PDF.
  const active = (d: ExplorationMajorDetail) => d.status === 'available'
  const rows = [
    { label: '专业身份', cells: details.map(d => `<p>${safe(d.identity.category)} · ${safe(d.identity.code)}</p><p class="muted">${active(d) ? '当前有已核验材料' : '资料待补充或已不可用'}</p>`) },
    { label: '学什么', cells: details.map(d => list(active(d) ? d.facts.curriculum.map(f => f.content) : [], '课程材料待补充')) },
    { label: '怎么学', cells: details.map(d => list(active(d) ? d.facts.learning_activity.map(f => f.content) : [], '学习活动材料待补充')) },
    { label: '职业方向与门槛', cells: details.map(d => active(d) ? d.careerDirections.map(c => `<b>${safe(c.name)}</b>${list(c.evidence.map(f => f.content), '职业材料待补充')}${list(c.requirements.map(f => f.content), '职业准入材料待补充，不能认定本科可直接进入')}`).join('') || '<p class="muted">职业方向材料待补充</p>' : '<p class="muted">职业方向材料待补充</p>') },
    { label: '选科证据', cells: details.map(d => `<p>${safe(d.admission.reason)}</p><small>${d.admission.admissionYear} 年招生；未知不表示不限</small>`) },
    { label: '资料缺口', cells: details.map(d => list(d.dataGaps, '当前字段有材料，仍需核对当年招生计划')) },
    { label: '家庭原始备注', cells: details.map(d => `<p class="note">${safe(d.note ?? '未添加家庭讨论备注')}</p>`) },
    { label: '下一步只做', cells: details.map(d => `<p>${safe(d.nextAction)}</p>`) },
  ]
  const appendix = details.filter(d => active(d)).map(d => {
    const learning = [...d.facts.curriculum, ...d.facts.learning_activity, ...d.facts.learning_prerequisite, ...d.facts.course_prerequisite,
      ...d.careerDirections.flatMap(c => [...c.evidence, ...c.requirements])]
    const unique = [...new Map(learning.map(f => [f.id, f])).values()]
    const name = d.identity.name
    return `<section class="object-evidence"><h2>${safe(name)} / 证据与范围</h2>${unique.length ? `<h3>${safe(name)} · 学习、职业与条件</h3>${facts(unique, name)}` : ''}${d.facts.admission_requirement.length ? `<h3>${safe(name)} · 招生选科材料</h3>${facts(d.facts.admission_requirement, name)}` : ''}${d.otherInstances.length ? `<h3>${safe(name)} · 另外的学校或年份实例</h3><p class="muted">以下材料不替代当前指定范围的缺口。</p>${facts(d.otherInstances, name)}` : ''}</section>`
  }).join('')
  return frame(profile, '专业对比 PDF', generatedAt, matrix(details.map(d => d.identity.name), rows), appendix)
}
const unitLabels: Record<string, string> = { exact_major: '具体专业', major_group: '院校专业组', school_line: '学校线' }
export function renderSchoolComparisonReport(profile: ComparisonProfile, details: SchoolReportDetail[], notes: Map<number, string | null>, generatedAt: string) {
  const gaps = (d: SchoolReportDetail) => [!d.admissionContext?.records.length ? '当前档案无可比招生记录' : null, !d.featuredMajors.length ? '暂无经核验优势专业' : null, !d.school.officialUrl ? '学校官网待核验' : null, !d.school.admissionsUrl ? '招生官网待核验' : null].filter((value): value is string => !!value)
  const rows = [
    { label: '城市与学校', cells: details.map(d => `<p>${safe(d.school.province)} · ${safe(d.school.city)}</p><p>${safe(d.school.level)} · ${safe(d.school.schoolType)}</p>`) },
    { label: '经核验优势专业', cells: details.map(d => list(d.featuredMajors.map(m => `${m.name} · ${m.recognitionType} · ${m.recognitionYear ?? m.sourceYear} 年${m.recognitionYear === null ? '名录' : '认定'}`), '暂无经核验数据')) },
    { label: '当前档案招生材料', cells: details.map(d => d.admissionContext?.records.length ? `<p>${[...new Set(d.admissionContext.records.map(r => r.year))].join('、')} 年，共 ${d.admissionContext.records.length} 条记录</p><p>${d.admissionContext.provinceRank === null ? '没有规划位次，不生成冲稳保' : `规划位次 ${d.admissionContext.provinceRank.toLocaleString()}；各招生单元的位置见后页`}</p>` : '<p class="muted">暂无可比招生记录</p>') },
    { label: '资料缺口', cells: details.map(d => list(gaps(d), '仍需核对当年招生章程、学费和培养条件')) },
    { label: '家庭原始备注', cells: details.map(d => `<p class="note">${safe(notes.get(d.school.id) ?? '未添加家庭讨论备注')}</p>`) },
  ]
  const appendix = details.filter(d => d.admissionContext?.records.length || d.featuredMajors.length || d.school.officialUrl || d.school.admissionsUrl).map(d => `<section class="object-evidence"><h2>${safe(d.school.name)} / 证据与范围</h2>${d.interpretation.map(i => `<p><b>${safe(i.label)}：</b>${safe(i.text)}</p>`).join('')}<h3>当前档案招生记录</h3><p class="muted">按招生单元逐条查看，记录位置不能概括为整所学校的录取结论。</p>${d.admissionContext?.records.length ? `<table class="records"><colgroup><col style="width:10%"><col style="width:27%"><col style="width:18%"><col style="width:20%"><col style="width:25%"></colgroup><thead><tr><th colspan="5" class="record-owner">${safe(d.school.name)} / 招生记录</th></tr><tr><th>年份 / 粒度</th><th>招生单元 / 批次</th><th>选科要求</th><th>最低位次 / 位置</th><th>来源</th></tr></thead><tbody>${d.admissionContext.records.map(r => `<tr><td>${r.year}<br>${safe(unitLabels[r.unitType] ?? r.unitType)}</td><td>${safe(r.unitName)}<br><small>${safe(r.batch)}</small></td><td>${safe(r.subjectRequirement?.trim() || '待核验，未知不表示不限')}</td><td>${r.minRank?.toLocaleString() ?? '位次待核验'}<br>${safe(r.risk ?? '仅供浏览')} · ${safe(r.confidence)}<small>${safe(r.recommendationExclusionReason ?? '')}</small></td><td>${sourceLink(r.sourceUrl, r.publisher ?? '来源待核验')}<small class="url">${safe(r.sourceUrl ?? '来源待核验')}</small></td></tr>`).join('')}</tbody></table>` : '<p class="muted">暂无可比招生记录，不补造学校或专业。</p>'}<h3>优势专业来源</h3>${d.featuredMajors.length ? d.featuredMajors.map(m => `<article class="fact"><b>${safe(d.school.name)} · ${safe(m.name)} · ${safe(m.recognitionType)}</b><p>${m.sourceYear} 年材料 · ${safe(m.publisher)}</p><small>${sourceLink(m.sourceUrl, '查看来源')} · ${safe(m.sourceUrl)}</small></article>`).join('') : '<p class="muted">暂无经核验数据</p>'}<h3>官网</h3><p>学校官网：${d.school.officialUrl ? sourceLink(d.school.officialUrl, String(d.school.officialUrl)) : '待核验'}</p><p>招生官网：${d.school.admissionsUrl ? sourceLink(d.school.admissionsUrl, String(d.school.admissionsUrl)) : '待核验'}</p></section>`).join('')
  return frame(profile, '院校对比 PDF', generatedAt, matrix(details.map(d => d.school.name), rows), appendix)
}
const css = `*{box-sizing:border-box}body{margin:0;color:#203c30;font:12px/1.65 "Microsoft YaHei","Noto Sans CJK SC","WenQuanYi Zen Hei",sans-serif}h1{font-size:27px;margin:3px 0}h2{font-size:20px;margin:0 0 14px;padding-bottom:9px;border-bottom:2px solid #2c6854}h3{font-size:14px;margin:20px 0 8px}h2,h3{break-after:avoid}p{margin:4px 0;overflow-wrap:anywhere}a{color:#245c47;text-decoration:underline;overflow-wrap:anywhere}small{display:block;color:#607166;font-size:10px;line-height:1.55;overflow-wrap:anywhere}.report-head{display:flex;justify-content:space-between;gap:25px;border-bottom:2px solid #2c6854;padding-bottom:14px}.report-head span{font-size:11px;color:#5b7162}.report-head>p{font-size:11px;text-align:right}.intro{color:#607166;margin:15px 0 20px;max-width:900px}.matrix,.records{width:100%;border-collapse:collapse;table-layout:fixed}.matrix th,.matrix td,.records th,.records td{padding:11px 13px;border:1px solid #dce4dd;text-align:left;vertical-align:top;overflow-wrap:anywhere}.matrix thead th{background:#2c6854;color:#fff;font-size:15px}.matrix .dimension{width:115px;font-size:12px}.matrix tbody th{background:#f0f4ef;font-size:12px}.matrix tbody td{font-size:12px}.matrix ul{padding-left:15px;margin:0}.matrix li+li{margin-top:7px}.matrix tr,.records tr{break-inside:avoid}.matrix thead,.records thead{display:table-header-group}.note{white-space:pre-wrap}.muted{color:#68796f}.object-evidence{break-before:page}.fact{padding:6px 0;border-bottom:1px solid #e4e9e3;break-inside:avoid}.fact p{margin-bottom:5px}.url{overflow-wrap:anywhere;color:#66796d}.records th{background:#f0f4ef}.records .record-owner{background:#2c6854;color:#fff;font-size:14px}`
