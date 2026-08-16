import { describe, expect, it } from 'vitest'
import { normalizePostgresConnectionString, toPostgresPlaceholders } from '../server/database.js'

describe('PostgreSQL database adapter', () => {
  it('converts parameter placeholders without changing question marks inside strings', () => {
    expect(toPostgresPlaceholders("SELECT * FROM schools WHERE name=? AND note='是否可报？' AND level=?"))
      .toBe("SELECT * FROM schools WHERE name=$1 AND note='是否可报？' AND level=$2")
  })

  it('keeps double-quoted identifiers intact', () => {
    expect(toPostgresPlaceholders('SELECT "question?" FROM answers WHERE id=?')).toBe('SELECT "question?" FROM answers WHERE id=$1')
  })

  it('uses libpq-compatible encrypted TLS for Supabase pooler URLs', () => {
    const normalized = normalizePostgresConnectionString(
      'postgresql://user:password@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require',
    )
    const url = new URL(normalized)

    expect(url.searchParams.get('sslmode')).toBe('require')
    expect(url.searchParams.get('uselibpqcompat')).toBe('true')
  })

  it('does not weaken certificate verification for non-Supabase URLs', () => {
    const connectionString = 'postgresql://user:password@db.example.com:5432/app?sslmode=verify-full'
    expect(normalizePostgresConnectionString(connectionString)).toBe(connectionString)
  })
})
