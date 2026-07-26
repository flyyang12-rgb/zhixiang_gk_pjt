export type MajorRecommendation={name:string;basis:string;evidenceLevel:'admission'|'orientation';sourceUrl:string|null}

const orientationRules:Array<[RegExp,string[]]>= [
  [/中医药|中医/,['中医学方向','中药学方向','针灸推拿方向']],
  [/医科|医学院|医学|卫生/,['临床医学方向','医学技术方向','护理学方向']],
  [/师范/,['汉语言文学（师范）方向','数学与应用数学（师范）方向','教育学方向']],
  [/财经|财贸|商学院|工商/,['会计学方向','金融学方向','工商管理方向']],
  [/政法|警察|公安/,['法学方向','公安学方向','公共管理方向']],
  [/外国语|外语/,['英语方向','翻译方向','国际商务方向']],
  [/农业|农林|林业/,['农学方向','林学方向','食品科学方向']],
  [/海洋|水产/,['海洋科学方向','水产养殖方向','船舶与海洋工程方向']],
  [/航空|航天|飞行/,['航空航天工程方向','机械工程方向','电子信息方向']],
  [/交通|铁道|铁路/,['交通运输方向','车辆工程方向','土木工程方向']],
  [/邮电|电子|信息/,['通信工程方向','电子信息工程方向','计算机方向']],
  [/石油|矿业|地质/,['资源勘查工程方向','地质工程方向','能源工程方向']],
  [/电力|水利/,['电气工程方向','能源动力方向','水利工程方向']],
  [/艺术|美术|音乐|传媒|戏剧|电影/,['艺术设计方向','数字媒体方向','文化传播方向']],
  [/体育/,['体育教育方向','运动训练方向','健康管理方向']],
  [/理工|工业|科技|工程/,['计算机方向','电子信息方向','智能制造方向']],
]

export function orientationRecommendations(schoolName:string,sourceUrl:string|null):MajorRecommendation[]{
  const matched=orientationRules.find(([pattern])=>pattern.test(schoolName))?.[1]
  const names=matched??['数字技术方向','经济管理方向','公共服务方向']
  return names.map(name=>({name,basis:matched?'依据校名体现的办学方向建议核验，并非官方优势专业认定':'当前缺少具体专业证据，仅提供通用探索方向；须先核对该校招生章程',evidenceLevel:'orientation',sourceUrl}))
}
