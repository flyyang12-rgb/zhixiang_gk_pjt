const specialProvinceNames: Record<string, string> = {
  北京: '北京市',
  天津: '天津市',
  上海: '上海市',
  重庆: '重庆市',
  内蒙古: '内蒙古自治区',
  广西: '广西壮族自治区',
  西藏: '西藏自治区',
  宁夏: '宁夏回族自治区',
  新疆: '新疆维吾尔自治区',
  香港: '香港特别行政区',
  澳门: '澳门特别行政区',
}

const databaseProvinceNames = Object.fromEntries(
  Object.entries(specialProvinceNames).map(([databaseName, mapName]) => [mapName, databaseName]),
)

export function toMapProvinceName(name: string) {
  if (name.endsWith('省') || name.endsWith('市') || name.endsWith('自治区') || name.endsWith('特别行政区')) {
    return name
  }
  return specialProvinceNames[name] ?? `${name}省`
}

export function toDatabaseProvinceName(name: string) {
  return databaseProvinceNames[name] ?? name.replace(/省$/, '')
}
