import type { DatabaseConnection, DatabaseRow } from '../server/database.js'

// A nullable code is compared to a typed column, so PostgreSQL can infer its
// type. A separate `? IS NOT NULL` parameter has no type context and fails.
export async function findFeaturedMajorMatches(db: Pick<DatabaseConnection, 'query'>, code: string | null, name: string) {
  const [rows] = await db.query<DatabaseRow[]>(
    'SELECT id,name,code FROM majors WHERE code=? OR name=? LIMIT 2', [code, name],
  )
  return rows
}
