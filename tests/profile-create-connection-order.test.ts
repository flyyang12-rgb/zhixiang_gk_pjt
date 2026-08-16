import express from 'express'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const databaseState = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('../server/database.js', () => {
  const connection = {
    beginTransaction: vi.fn(async () => { databaseState.calls.push('begin') }),
    execute: vi.fn(async () => {
      databaseState.calls.push('connection-execute')
      return [{ affectedRows: 1, insertId: 0 }, []]
    }),
    query: vi.fn(),
    commit: vi.fn(async () => { databaseState.calls.push('commit') }),
    rollback: vi.fn(),
    release: vi.fn(),
  }

  return {
    database: {
      execute: vi.fn(async () => {
        databaseState.calls.push('pool-execute')
        return [[{ id: 1 }], []]
      }),
      getConnection: vi.fn(async () => {
        databaseState.calls.push('get-connection')
        return connection
      }),
    },
  }
})

import { profilesRouter } from '../server/profiles.js'

const app = express()
app.use(express.json())
app.use('/api/profiles', profilesRouter)
const server = app.listen(0)

describe('profile creation connection ordering', () => {
  beforeEach(() => { databaseState.calls.length = 0 })
  afterAll(() => server.close())

  it('looks up the province before reserving the only transaction connection', async () => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务器没有可用端口')

    const response = await fetch(`http://127.0.0.1:${address.port}/api/profiles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentName: '连接顺序测试',
        province: '河南',
        subjectGroup: '物理类',
        selectedSubjects: ['物理', '化学', '生物'],
        score: 621,
        provinceRank: 11545,
        planningMode: 'application',
      }),
    })

    expect(response.status).toBe(201)
    expect(databaseState.calls.indexOf('pool-execute')).toBeLessThan(databaseState.calls.indexOf('get-connection'))
  })
})
