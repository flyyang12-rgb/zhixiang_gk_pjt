import {describe,expect,it,vi} from 'vitest'
import {createClientMessageId} from '../src/client-message-id'

describe('createClientMessageId',()=>{
  it('优先使用浏览器原生 randomUUID',()=>{
    const randomUUID=vi.fn(()=> '123e4567-e89b-42d3-a456-426614174000' as `${string}-${string}-${string}-${string}-${string}`)
    const getRandomValues=vi.fn(<T extends ArrayBufferView|null>(array:T)=>array)
    expect(createClientMessageId({randomUUID,getRandomValues})).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it('HTTP 环境没有 randomUUID 时生成 UUID v4',()=>{
    const getRandomValues=<T extends ArrayBufferView|null>(array:T)=>{
      if(array instanceof Uint8Array)array.set([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15])
      return array
    }
    const id=createClientMessageId({getRandomValues})
    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
