import { describe, expect, it, vi } from 'vitest'
import { CreatedProfiles } from './support/created-profiles'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const creation = (id: string) => ({ ok: () => true, json: async () => ({ success: true, data: { id } }) })
const removed = () => ({ ok: () => true, status: () => 200 })

describe('本次创建档案的清理范围', () => {
  it('只删除成功创建返回的准确 ID，去重且不包含失败请求中的 ID', async () => {
    const registry = new CreatedProfiles()
    await registry.capture(creation(first))
    await registry.capture(creation(first))
    await registry.capture({ ...creation(second), ok: () => false })
    const remove = vi.fn(async () => removed())
    await registry.cleanup(remove)
    expect(remove.mock.calls).toEqual([[first]])
    await registry.cleanup(remove)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('接受本次已主动删除的档案 404', async () => {
    const registry = new CreatedProfiles()
    await registry.capture(creation(first))
    await registry.cleanup(async () => ({ ok: () => false, status: () => 404 }))
    const remove = vi.fn(async () => removed())
    await registry.cleanup(remove)
    expect(remove).not.toHaveBeenCalled()
  })

  it('清理失败仍继续清理其余本次 ID，并只保留失败项供精确重试', async () => {
    const registry = new CreatedProfiles()
    await registry.capture(creation(first))
    await registry.capture(creation(second))
    const remove = vi.fn(async (id: string) => {
      if (id === first) throw new Error('network unavailable')
      return removed()
    })
    await expect(registry.cleanup(remove)).rejects.toThrow('1 个本次测试档案未能清理')
    expect(remove.mock.calls).toEqual([[first], [second]])
    const retry = vi.fn(async () => removed())
    await registry.cleanup(retry)
    expect(retry.mock.calls).toEqual([[first]])
  })

  it('服务端删除失败不能被标记为已清理', async () => {
    const registry = new CreatedProfiles()
    await registry.capture(creation(first))
    await expect(registry.cleanup(async () => ({ ok: () => false, status: () => 500 }))).rejects.toThrow('未能清理')
  })

  it('拒绝无法验证 ID 的成功响应，不把它当成可执行删除路径', async () => {
    const registry = new CreatedProfiles()
    await expect(registry.capture(creation('../profiles'))).rejects.toThrow('缺少有效档案 ID')
    const remove = vi.fn(async () => removed())
    await registry.cleanup(remove)
    expect(remove).not.toHaveBeenCalled()
  })
})
