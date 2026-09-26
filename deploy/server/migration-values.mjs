export function normalizeMigrationValue(value, column) {
  if (value === null || value === undefined) return null
  if (column.data_type === 'jsonb' || column.data_type === 'json') {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    // pg otherwise serializes JS arrays as PostgreSQL arrays, not JSON.
    return JSON.stringify(parsed)
  }
  if (column.data_type === 'boolean') {
    if (value === 0 || value === '0' || value === false) return false
    if (value === 1 || value === '1' || value === true) return true
    throw new Error('invalid_boolean')
  }
  if (column.data_type === 'date') {
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith('0000')) throw new Error('invalid_date')
    return text
  }
  if (/^timestamp/.test(column.data_type) && value instanceof Date) return value.toISOString()
  return value
}

export function orderMigrationTables(names, dependencies) {
  const pending = new Set(names), ordered = []
  while (pending.size) {
    const ready = [...pending].filter(name => (dependencies.get(name) ?? []).every(dep => dep === name || !pending.has(dep)))
    if (!ready.length) throw new Error('cyclic_dependencies')
    for (const name of ready) { ordered.push(name); pending.delete(name) }
  }
  return ordered
}
