import { describe, expect, it } from 'vitest'
import { resolveDatabaseUrl } from '../server/config.js'

describe('resolveDatabaseUrl', () => {
  it('prefers an explicitly configured DATABASE_URL', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgresql://primary', POSTGRES_URL: 'postgresql://vercel' }))
      .toBe('postgresql://primary')
  })

  it('uses the Vercel Supabase POSTGRES_URL fallback', () => {
    expect(resolveDatabaseUrl({ POSTGRES_URL: 'postgresql://vercel' })).toBe('postgresql://vercel')
  })
})
