import { Router } from 'express'
import type { DatabaseRow as RowDataPacket } from './database.js'
import { z } from 'zod'
import { database } from './database.js'

const router = Router()
const factorSchema = z.enum(['majorFit', 'schoolLevel', 'career', 'city', 'cost', 'distance'])
const factors = factorSchema.options
const uncertainOption = z.string().min(1).max(32)

const preferenceSchema = z.object({
  postgraduateTendency: z.enum(['employment', 'open', 'planned', 'uncertain']),
  familyConditions: z.object({
    annualBudget: uncertainOption,
    employmentTiming: uncertainOption,
    industryResources: uncertainOption,
    familyBusiness: uncertainOption,
    studySupport: uncertainOption,
    locationAcceptance: uncertainOption,
    highCostCity: uncertainOption,
  }),
  studentRanking: z.array(factorSchema).length(6).refine(items => new Set(items).size === factors.length, '学生排序包含重复因素'),
  parentRanking: z.array(factorSchema).length(6).refine(items => new Set(items).size === factors.length, '家长排序包含重复因素'),
  finalWeights: z.record(factorSchema, z.number().int().min(0).max(100)).refine(
    weights => factors.reduce((total, factor) => total + (weights[factor] ?? 0), 0) === 100,
    '最终权重总和必须为 100%',
  ),
})

router.get('/profiles/:id/preferences', async (request, response, next) => {
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const [rows] = await database.execute<PreferenceRow[]>(
      `SELECT postgraduate_tendency AS postgraduateTendency,
              family_conditions AS familyConditions,
              student_ranking AS studentRanking,
              parent_ranking AS parentRanking,
              final_weights AS finalWeights,
              status, updated_at AS updatedAt
       FROM profile_preferences WHERE profile_id = ? LIMIT 1`,
      [profileId],
    )
    const data = rows[0] ? serializePreference(rows[0]) : null
    response.json({ success: true, data, error: null, requestId: response.locals.requestId })
  } catch (error) {
    next(error)
  }
})

router.put('/profiles/:id/preferences', async (request, response, next) => {
  try {
    const profileId = z.string().uuid().parse(request.params.id)
    const input = preferenceSchema.parse(request.body)
    await database.execute(
      `INSERT INTO profile_preferences
        (profile_id, postgraduate_tendency, family_conditions, student_ranking, parent_ranking, final_weights, status)
       VALUES (?, ?, ?, ?, ?, ?, 'completed')
       ON CONFLICT (profile_id) DO UPDATE SET postgraduate_tendency = EXCLUDED.postgraduate_tendency,
         family_conditions = EXCLUDED.family_conditions, student_ranking = EXCLUDED.student_ranking,
         parent_ranking = EXCLUDED.parent_ranking, final_weights = EXCLUDED.final_weights, status = 'completed'`,
      [profileId, input.postgraduateTendency, JSON.stringify(input.familyConditions), JSON.stringify(input.studentRanking), JSON.stringify(input.parentRanking), JSON.stringify(input.finalWeights)],
    )
    response.json({ success: true, data: { ...input, status: 'completed' }, error: null, requestId: response.locals.requestId })
  } catch (error) {
    next(error)
  }
})

function normalizeJson<T>(value: T | string): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value
}

function serializePreference(row: PreferenceRow) {
  return {
    postgraduateTendency: row.postgraduateTendency,
    familyConditions: normalizeJson(row.familyConditions),
    studentRanking: normalizeJson(row.studentRanking),
    parentRanking: normalizeJson(row.parentRanking),
    finalWeights: normalizeJson(row.finalWeights),
    status: row.status,
    updatedAt: row.updatedAt,
  }
}

interface PreferenceRow extends RowDataPacket {
  postgraduateTendency: 'employment' | 'open' | 'planned' | 'uncertain'
  familyConditions: Record<string, string> | string
  studentRanking: string[] | string
  parentRanking: string[] | string
  finalWeights: Record<string, number> | string
  status: 'draft' | 'completed'
  updatedAt: Date
}

export const preferencesRouter = router
