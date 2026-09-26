import { describe, expect, it } from 'vitest'
// Deployment module is also used directly in the server's production image.
// @ts-expect-error Standalone deployment JS deliberately has no build dependency.
import { normalizeMigrationValue, orderMigrationTables } from '../deploy/server/migration-values.mjs'

describe('same-host migration values', () => {
  it('serializes JSON arrays for pg without turning them into postgres arrays', () => {
    expect(normalizeMigrationValue('["物理","化学"]', {data_type:'jsonb'})).toBe('["物理","化学"]')
    expect(normalizeMigrationValue({note:' 原文\n'}, {data_type:'jsonb'})).toBe('{"note":" 原文\\n"}')
    expect(normalizeMigrationValue(null, {data_type:'jsonb'})).toBeNull()
    expect(() => normalizeMigrationValue('bad', {data_type:'jsonb'})).toThrow()
  })
  it('preserves large IDs and raw text without trimming or inventing values', () => {
    expect(normalizeMigrationValue('9007199254740990', {data_type:'bigint'})).toBe('9007199254740990')
    expect(normalizeMigrationValue(' 原始备注\n ', {data_type:'text'})).toBe(' 原始备注\n ')
    expect(normalizeMigrationValue(null, {data_type:'integer'})).toBeNull()
  })
  it('validates booleans and dates instead of silently replacing invalid source data', () => {
    expect(normalizeMigrationValue('0', {data_type:'boolean'})).toBe(false)
    expect(normalizeMigrationValue(1, {data_type:'boolean'})).toBe(true)
    expect(() => normalizeMigrationValue('maybe', {data_type:'boolean'})).toThrow()
    expect(normalizeMigrationValue('2026-09-26 13:00:00', {data_type:'date'})).toBe('2026-09-26')
    expect(() => normalizeMigrationValue('0000-00-00', {data_type:'date'})).toThrow()
  })
  it('orders foreign keys and refuses dependency cycles', () => {
    expect(orderMigrationTables(['saved','majors','profiles'], new Map([['saved',['profiles','majors']]]))).toEqual(['majors','profiles','saved'])
    expect(() => orderMigrationTables(['a','b'], new Map([['a',['b']],['b',['a']]]))).toThrow('cyclic_dependencies')
  })
})
