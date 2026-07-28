export type FamilyBriefSchoolInput={
  name:string;city:string;level:string;featuredMajors:string[]
  admission:null|{year:number;risk:string|null;minRank:number|null;unitType?:string}
  officialUrl:boolean;admissionsUrl:boolean;note:string|null
}
export type FamilyBriefItem={name:string;stance:string;evidence:[string,string];risk:string;note:string;nextAction:string}

export function buildFamilyBrief(input:{profileSummary:{planningMode:'exploration'|'application';province:string;subjectGroup:string;score:number;provinceRank:number|null};schools:FamilyBriefSchoolInput[]}):FamilyBriefItem[]{
  return input.schools.map(school=>{
    const hasAdmission=Boolean(school.admission?.minRank)
    const stance=input.profileSummary.planningMode==='exploration'
      ?'继续了解，等可靠位次后再判断报考位置。'
      :hasAdmission?`可以比较，当前只能参考历史“${school.admission?.risk??'待核验'}”位置。`:'暂不下报考结论，因为没有当前档案的可比招生记录。'
    const evidence:[string,string]=[
      `${school.city} · ${school.level}`,
      hasAdmission?`${school.admission!.year} 年参考最低位次 ${school.admission!.minRank!.toLocaleString('zh-CN')}`:school.featuredMajors.length?`已核验专业：${school.featuredMajors.slice(0,2).join('、')}`:'暂无经核验优势专业',
    ]
    const gaps:string[]=[]
    if(!hasAdmission)gaps.push('缺当前档案可比招生记录')
    if(!school.featuredMajors.length)gaps.push('缺已核验优势专业')
    if(!school.officialUrl)gaps.push('学校官网待核验')
    if(!school.admissionsUrl)gaps.push('招生官网待核验')
    return {name:school.name,stance,evidence,risk:gaps[0]??'历史记录不代表明年结果',note:school.note?.trim()||'还没有家庭讨论备注',nextAction:!hasAdmission?`只核对 ${school.name} 在本省的当年招生计划`:'只核对弟弟想学的具体专业是否在招生单元里'}
  })
}

export function buildFamilyBriefText(items:FamilyBriefItem[]){
  const schools=items.map(item=>`${item.name}\n态度：${item.stance}\n依据：${item.evidence.join('；')}\n最大风险：${item.risk}\n家庭备注：${item.note}\n下一步：${item.nextAction}`).join('\n\n')
  return `给爸妈看的学校简报\n\n${schools}\n\n家庭只讨论三个问题：\n1. 弟弟愿不愿学四年？\n2. 家庭能否承担培养成本？\n3. 最差就业出口能否接受？\n\n历史数据只用于家庭讨论，不是录取承诺。`
}
