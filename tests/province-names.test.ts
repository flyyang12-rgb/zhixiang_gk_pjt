import { describe, expect, it } from 'vitest'
import { toDatabaseProvinceName, toMapProvinceName } from '../src/province-names'

describe('地图与数据库省份名称转换', () => {
  it.each([
    ['陕西', '陕西省'],
    ['北京', '北京市'],
    ['广西', '广西壮族自治区'],
    ['内蒙古', '内蒙古自治区'],
    ['新疆', '新疆维吾尔自治区'],
    ['香港', '香港特别行政区'],
  ])('把数据库名称 %s 转换为 GeoJSON 名称 %s', (databaseName, mapName) => {
    expect(toMapProvinceName(databaseName)).toBe(mapName)
    expect(toDatabaseProvinceName(mapName)).toBe(databaseName)
  })
})
