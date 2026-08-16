export function formatChineseSourceDate(value:string){
  const matched=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if(!matched)throw new Error('院校名单截至日期格式无效')
  return `${Number(matched[1])}年${Number(matched[2])}月${Number(matched[3])}日`
}
