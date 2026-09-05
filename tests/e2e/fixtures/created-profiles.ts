import { test as base, type APIRequestContext, type APIResponse, type Response } from '@playwright/test'
import { CreatedProfiles } from '../../support/created-profiles'

type Fixtures = {
  createdProfiles: CreatedProfiles
  createProfile: (options: Parameters<APIRequestContext['post']>[1]) => Promise<APIResponse>
}

export const test = base.extend<Fixtures>({
  createdProfiles: [async ({ page, request }, use) => {
    const registry = new CreatedProfiles()
    const pending: Promise<void>[] = []
    const captureErrors: unknown[] = []
    const capture = (response: Response) => {
      if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/profiles') return
      pending.push(registry.capture(response).catch(error => { captureErrors.push(error) }))
    }
    page.on('response', capture)
    try {
      await use(registry)
    } finally {
      page.off('response', capture)
      await Promise.all(pending)
      await registry.cleanup(id => request.delete(`/api/profiles/${id}`))
      if (captureErrors.length) throw new Error('本次创建响应登记失败，请检查测试响应；未执行历史档案扫描')
    }
  }, { auto: true }],
  createProfile: async ({ request, createdProfiles }, use) => {
    await use(async options => {
      const response = await request.post('/api/profiles', options)
      await createdProfiles.capture(response)
      return response
    })
  },
})

export { expect } from '@playwright/test'
