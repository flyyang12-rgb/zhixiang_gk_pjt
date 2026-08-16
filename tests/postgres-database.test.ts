import { describe, expect, it } from 'vitest'
import { toPostgresPlaceholders } from '../server/database.js'

describe('PostgreSQL database adapter', () => {
  it('converts parameter placeholders without changing question marks inside strings', () => {
    expect(toPostgresPlaceholders("SELECT * FROM schools WHERE name=? AND note='是否可报？' AND level=?"))
      .toBe("SELECT * FROM schools WHERE name=$1 AND note='是否可报？' AND level=$2")
  })

  it('keeps double-quoted identifiers intact', () => {
    expect(toPostgresPlaceholders('SELECT "question?" FROM answers WHERE id=?')).toBe('SELECT "question?" FROM answers WHERE id=$1')
  })
})
