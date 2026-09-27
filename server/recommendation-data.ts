import type { DatabaseConnection, DatabaseRow } from './database.js'

export async function loadRecommendationAvailability(db: Pick<DatabaseConnection, 'execute'>, province: string, subjectGroup: string) {
  const [rows] = await db.execute<DatabaseRow[]>(
    `SELECT COUNT(*) AS count,MAX(ap.year) AS year,COUNT(DISTINCT ap.year) AS "yearCount",
       STRING_AGG(DISTINCT ap.year::text, ',' ORDER BY ap.year::text) AS years
     FROM admission_programs ap JOIN provinces p ON p.id=ap.province_id
     WHERE p.name=? AND ap.subject_group=? AND ap.recommendation_eligible=1 AND ap.min_rank IS NOT NULL`,
    [province, subjectGroup],
  )
  return rows
}
