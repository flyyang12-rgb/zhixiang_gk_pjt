import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { test as base, expect } from './created-profiles'

type Runtime = {
  runId: string; databaseName: string; schoolId: number; secondSchoolId: number;
  majors: Array<{ id: number; name: string; batchId: string }>;
}

export const test = base.extend<{ explorationData: { client: Client; runtime: Runtime } }>({
  explorationData: [async ({}, use) => {
    const runtime = JSON.parse(await readFile('.scratch/exploration-first/ui-test-runtime.json', 'utf8')) as Runtime
    expect(runtime.runId).toBe(process.env.EXPLORATION_UI_RUN_ID)
    const url = new URL(process.env.EXPLORATION_UI_TEST_DATABASE_URL ?? '')
    expect(['127.0.0.1', 'localhost']).toContain(url.hostname)
    expect(url.pathname).toBe('/zhixiang_exploration_test')
    expect(runtime.databaseName).toBe(`zhixiang_exploration_test_ui_${runtime.runId.replaceAll('-', '')}`)
    url.pathname = `/${runtime.databaseName}`
    const client = new Client({ connectionString: url.toString() })
    await client.connect()
    try { await use({ client, runtime }) }
    finally { await client.end() }
  }, { auto: true }],
})

export { expect }
