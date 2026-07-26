export type LinkRecord = { schoolName:string;officialUrl?:string|null;admissionsUrl?:string|null;sourceUrl:string;evidenceUrl?:string;verifiedAt?:string }
export type PreparedLinkRecord = { schoolName:string;officialUrl:string|null;admissionsUrl:string|null;sourceUrl:string;verifiedAt:Date }

export function verifiedHttpUrl(value:unknown){
  if(value==null||value==='')return null
  const url=new URL(String(value))
  if(!['http:','https:'].includes(url.protocol))throw new Error(`不支持的链接协议：${url.protocol}`)
  return url.toString()
}

export async function prepareLinkRecord(record:LinkRecord,verify:(url:string)=>Promise<void>,trustedSnapshot=false):Promise<PreparedLinkRecord>{
  if(!record.schoolName?.trim()||!record.sourceUrl)throw new Error('缺少 schoolName 或 sourceUrl')
  const officialUrl=verifiedHttpUrl(record.officialUrl),admissionsUrl=verifiedHttpUrl(record.admissionsUrl),sourceUrl=verifiedHttpUrl(record.sourceUrl)
  if(!officialUrl&&!admissionsUrl)throw new Error('官网和招生网不能同时为空')
  if(!trustedSnapshot){
    try{await Promise.all([officialUrl,admissionsUrl].filter((value):value is string=>Boolean(value)).map(verify))}
    catch(error){if(!record.evidenceUrl)throw error;await verify(verifiedHttpUrl(record.evidenceUrl)!)}
  }
  const verifiedAt=record.verifiedAt?new Date(record.verifiedAt):new Date()
  if(Number.isNaN(verifiedAt.getTime()))throw new Error('verifiedAt 不是有效时间')
  return {schoolName:record.schoolName.trim(),officialUrl,admissionsUrl,sourceUrl:sourceUrl!,verifiedAt}
}
