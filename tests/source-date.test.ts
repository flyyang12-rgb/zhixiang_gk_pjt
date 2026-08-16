import {describe,expect,it} from 'vitest'
import {formatChineseSourceDate} from '../src/source-date'

describe('院校名单来源日期',()=>{
  it('用大白话显示数据库返回的截至日期',()=>{
    expect(formatChineseSourceDate('2026-06-17')).toBe('2026年6月17日')
  })

  it('拒绝拿不完整日期冒充来源日期',()=>{
    expect(()=>formatChineseSourceDate('2026-06')).toThrow('院校名单截至日期格式无效')
  })
})
