import { Pool, type PoolClient, types } from 'pg'
import { config } from './config.js'

types.setTypeParser(20, value => Number(value))

// Database rows are runtime-shaped by each SELECT; callers narrow fields through
// their existing route-level parsing and validation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DatabaseRow = Record<string, any>

export type DatabaseResult = {
  affectedRows: number
  insertId: number
}

export type QueryTuple<T> = [T, unknown]

type QueryValues = readonly unknown[]

export interface DatabaseConnection {
  query<T = DatabaseRow[]>(sql: string, values?: QueryValues): Promise<QueryTuple<T>>
  execute<T = DatabaseRow[]>(sql: string, values?: QueryValues): Promise<QueryTuple<T>>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}

function shouldUseSsl(connectionString: string) {
  if (!config.DATABASE_SSL) return false
  try {
    const hostname = new URL(connectionString).hostname
    return hostname !== 'localhost' && hostname !== '127.0.0.1'
  } catch {
    return config.DATABASE_SSL
  }
}

export function normalizePostgresConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString)
    const isSupabase = url.hostname === 'supabase.com' || url.hostname.endsWith('.supabase.com')
    if (isSupabase && url.searchParams.get('sslmode') === 'require' && !url.searchParams.has('uselibpqcompat')) {
      // Supabase's managed pooler requires TLS but its certificate chain is not
      // available in Vercel's Node trust store. Match libpq's `sslmode=require`:
      // encrypt the connection without treating it as `verify-full`.
      url.searchParams.set('uselibpqcompat', 'true')
    }
    return url.toString()
  } catch {
    return connectionString
  }
}

const databaseUrl = normalizePostgresConnectionString(config.DATABASE_URL)

const pool = new Pool({
  connectionString: databaseUrl,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: process.env.NODE_ENV === 'test',
  ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: true } : false,
})

export function toPostgresPlaceholders(sql: string) {
  let index = 0
  let quote: "'" | '"' | null = null
  let output = ''

  for (let position = 0; position < sql.length; position += 1) {
    const character = sql[position]!
    const previous = sql[position - 1]

    if ((character === "'" || character === '"') && previous !== '\\') {
      if (quote === character) quote = null
      else if (quote === null) quote = character
      output += character
      continue
    }

    if (character === '?' && quote === null) {
      index += 1
      output += `$${index}`
      continue
    }

    output += character
  }

  return output
}

function restoreCamelCaseAliases(sql: string, rows: DatabaseRow[]) {
  const aliases = new Map<string, string>()
  for (const match of sql.matchAll(/\b[a-z][a-z0-9_]*[A-Z][A-Za-z0-9_]*/g)) {
    aliases.set(match[0].toLowerCase(), match[0])
  }

  if (!aliases.size) return rows
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [aliases.get(key) ?? key, value])))
}

async function runQuery<T>(executor: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>, sql: string, values: QueryValues = []) {
  const result = await executor.query(toPostgresPlaceholders(sql), [...values])
  const rows = restoreCamelCaseAliases(sql, result.rows as DatabaseRow[])

  if (result.command === 'SELECT' || result.command === 'SHOW' || result.command === 'WITH') {
    return [rows as T, result.fields] as QueryTuple<T>
  }

  const firstRow = rows[0]
  const insertId = firstRow && typeof firstRow.id === 'number' ? firstRow.id : 0
  const header: DatabaseResult = { affectedRows: result.rowCount ?? 0, insertId }
  return [header as T, result.fields] as QueryTuple<T>
}

function wrapClient(client: PoolClient): DatabaseConnection {
  return {
    query: (sql, values) => runQuery(client, sql, values),
    execute: (sql, values) => runQuery(client, sql, values),
    beginTransaction: async () => { await client.query('BEGIN') },
    commit: async () => { await client.query('COMMIT') },
    rollback: async () => { await client.query('ROLLBACK') },
    release: () => client.release(),
  }
}

export const database = {
  query: <T = DatabaseRow[]>(sql: string, values?: QueryValues) => runQuery<T>(pool, sql, values),
  execute: <T = DatabaseRow[]>(sql: string, values?: QueryValues) => runQuery<T>(pool, sql, values),
  raw: (sql: string) => pool.query(sql),
  getConnection: async () => wrapClient(await pool.connect()),
  end: () => pool.end(),
}
