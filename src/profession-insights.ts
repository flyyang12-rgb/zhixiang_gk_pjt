import type { ProfessionCard } from './api'

const factorNames={coverage:'近期招聘机会',directEntry:'本科毕业能做的工作',schoolAccess:'按你位次可选的学校',stability:'近期工作需求的稳定程度',outlook:'有官方依据的未来发展信号'} as const

export function buildProfessionInsights(card:ProfessionCard){
  const available=Object.entries(card.factors).filter((entry):entry is [keyof typeof factorNames,ProfessionCard['factors'][keyof ProfessionCard['factors']]]=>entry[1].value!=null).sort((a,b)=>Number(b[1].value)-Number(a[1].value))
  const strongest=available[0]
  const directCount=card.jobs.filter(job=>job.directEntry).length
  const postgraduateCount=card.jobs.filter(job=>job.requiresPostgraduate).length
  const certificateCount=card.jobs.filter(job=>job.requiresCertificate).length
  const pathParts=[`${directCount} 个方向本科毕业后就可以尝试`]
  if(postgraduateCount)pathParts.push(`${postgraduateCount} 个方向通常要继续读研`)
  if(certificateCount)pathParts.push(`${certificateCount} 个方向还需要考证`)
  const missing=Object.entries(card.factors).find(([,factor])=>factor.value==null)
  const caution=card.schoolMatchStatus==='group_only'
    ? '当前只有院校专业组投档线，不能据此认定组内一定包含该专业。'
    : missing ? `${factorNames[missing[0] as keyof typeof factorNames]}证据暂缺：${missing[1].evidence}。`
      : `还要逐校查清课程安排、当年招生计划和学费生活费。这个分数只用于比较，不代表一定录取或一定好就业。`
  return [
    {label:'为什么放在这组',text:card.totalScore==null?`这个专业暂不评分，因为目前少于两个独立有效因子。它仍被保留供你了解，缺失证据不会按 0 分处理。`:`这个专业被放在“${card.band}”${strongest?`，主要因为“${factorNames[strongest[0]]}”这一项表现较好（${strongest[1].value} 分）。${strongest[1].evidence}。`:'，但目前能查到的资料还不够。'}`},
    {label:'毕业后能做什么',text:`我们核对了下面 3 个常见工作方向：${pathParts.join('；')}。`},
    {label:'报考前要查清什么',text:caution},
  ]
}
