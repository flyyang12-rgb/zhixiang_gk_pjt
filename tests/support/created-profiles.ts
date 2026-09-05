type CreationResponse = {
  ok(): boolean
  json(): Promise<unknown>
}

type DeletionResponse = { ok(): boolean; status(): number }

/** Only IDs returned by successful creations in this test can be removed. */
export class CreatedProfiles {
  private readonly ids = new Set<string>()

  async capture(response: CreationResponse) {
    if (!response.ok()) return
    const body = await response.json() as { success?: boolean; data?: { id?: unknown } }
    const id = body?.data?.id
    if (body?.success !== true || typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('创建响应缺少有效档案 ID，无法登记精确清理范围')
    }
    this.ids.add(id)
  }

  async cleanup(remove: (id: string) => Promise<DeletionResponse>) {
    let failed = 0
    for (const id of this.ids) {
      try {
        const response = await remove(id)
        if (!response.ok() && response.status() !== 404) {
          failed += 1
          continue
        }
        this.ids.delete(id)
      } catch {
        failed += 1
      }
    }
    if (failed) throw new Error(`${failed} 个本次测试档案未能清理；不得扫描其他历史档案代替清理`)
  }
}
