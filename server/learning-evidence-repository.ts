import { z } from 'zod'
import { database } from './database.js'
import {
  evidenceAvailability, evaluateAdmissionEvidence, learningEvidenceSchema,
  learningEvidenceKindSchema, learningScopeSchema,
  type LearningEvidence, type LearningEvidenceAvailability,
} from './learning-evidence-contract.js'

export type LearningEvidenceDatabase = Pick<typeof database, 'query'>
export const standardMajorSchema = z.object({
  id: z.number().int().positive().safe(), code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(100),
}).strict()
export type StandardMajor = z.infer<typeof standardMajorSchema>
const identitySchema = z.object({ id: z.number().int().positive().safe(), name: z.string().trim().min(1).max(200) }).strict()
export type LearningIdentity = z.infer<typeof identitySchema>
export type CurrentLearningFact = LearningEvidence & { school: LearningIdentity | null; jobDirection: LearningIdentity | null }
export function learningFactEvidence(fact: CurrentLearningFact): LearningEvidence {
  const { school: _school, jobDirection: _jobDirection, ...evidence } = fact
  return evidence
}
export type LearningEvidenceGap = {
  majorId: number; evidenceId: string | null; kind: LearningEvidence['kind'] | null;
  status: Exclude<LearningEvidenceAvailability, 'verified'>; scope: LearningEvidence['scope'] | null;
  sourceYear: number | null; reason: string;
}
export type LearningEvidenceSnapshot = { majors: StandardMajor[]; facts: CurrentLearningFact[]; gaps: LearningEvidenceGap[] }

const availabilityMessages: Record<Exclude<LearningEvidenceAvailability, 'verified'>, string> = {
  pending: '材料尚未完成审核或激活，当前不作为事实依据',
  conflicting: '材料存在冲突，当前不作为确定事实',
  rejected: '材料审核未通过，当前不作为事实依据',
  withdrawn: '材料已撤回，需要重新核验',
  expired: '材料已超过有效期，需要重新核验',
  invalid: '材料结构或来源登记不完整，当前不作为事实依据',
}

// This is the only joined read used by exploration consumers. Every regeneration
// loads batch, artifact and mapping state anew; no cached or historical chat facts.
export async function loadCurrentLearningEvidence(
  db: LearningEvidenceDatabase = database,
  options: { majorIds?: number[]; now?: Date } = {},
): Promise<LearningEvidenceSnapshot> {
  const ids = options.majorIds === undefined ? null : z.array(standardMajorSchema.shape.id).max(5000).parse(options.majorIds)
  if (ids?.length === 0) return { majors: [], facts: [], gaps: [] }
  const parameters = ids === null ? [] : [ids]
  const [majorRows] = await db.query<Record<string, unknown>[]>(
    `SELECT id,code,name,category FROM majors ${ids === null ? '' : 'WHERE id=ANY(?::bigint[])'} ORDER BY category,code,id`, parameters,
  )
  const majors = majorRows.flatMap(row => { const parsed = standardMajorSchema.safeParse(row); return parsed.success ? [parsed.data] : [] })
  if (!majors.length) return { majors: [], facts: [], gaps: [] }
  const [rows] = await db.query<Record<string, unknown>[]>(
    `SELECT jsonb_build_object(
      'id',e.id,'factKey',e.fact_key,'majorId',e.major_id,'kind',e.kind,'content',e.content,
      'source',jsonb_build_object('id',ds.id,'artifactId',a.id,'title',ds.title,'url',a.official_page_url,
        'year',ds.source_year,'publisher',ds.publisher,'publisherType',e.publisher_type,
        'sha256',a.sha256,'collectedAt',a.collected_at),
      'locator',jsonb_build_object('kind',e.locator_kind,'value',e.locator_value),
      'scope',jsonb_build_object('level',e.scope_level,'schoolId',e.school_id,'province',e.province,
        'subjectGroup',e.subject_group,'admissionYear',e.admission_year),
      'review',jsonb_build_object('status',e.review_status,'reviewer',e.reviewer,'reviewedAt',e.reviewed_at,
        'conclusion',e.review_conclusion,'reason',e.review_reason),
      'batch',jsonb_build_object('id',b.id,'checksum',b.payload_sha256,'status',b.status),
      'validUntil',e.valid_until,'jobDirectionId',e.job_direction_id,'careerMappingStatus',mjd.review_status,
      'condition',e.condition) evidence,
      CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('id',s.id,'name',s.name) END school,
      CASE WHEN jd.id IS NOT NULL THEN jsonb_build_object('id',jd.id,'name',jd.name) END job_direction
     FROM major_learning_evidence e
     LEFT JOIN source_artifacts a ON a.id=e.artifact_id
     LEFT JOIN data_sources ds ON ds.id=a.source_id
     LEFT JOIN learning_content_batches b ON b.id=e.batch_id
     LEFT JOIN major_job_directions mjd ON mjd.major_id=e.major_id AND mjd.job_direction_id=e.job_direction_id
     LEFT JOIN job_directions jd ON jd.id=mjd.job_direction_id
     LEFT JOIN schools s ON s.id=e.school_id
     WHERE e.major_id=ANY(?::bigint[]) ORDER BY e.major_id,e.id`, [majors.map(major => major.id)],
  )
  return parseCurrentLearningEvidence(majors, rows, options.now)
}

export function parseCurrentLearningEvidence(
  majors: readonly StandardMajor[], rows: readonly Record<string, unknown>[], now = new Date(),
): LearningEvidenceSnapshot {
  const validMajors = majors.map(major => standardMajorSchema.parse(major))
  const majorIds = new Set(validMajors.map(major => major.id))
  const parsed: CurrentLearningFact[] = []
  const gaps: LearningEvidenceGap[] = []
  for (const row of rows) {
    const raw = row.evidence
    const result = learningEvidenceSchema.safeParse(raw)
    if (!result.success) {
      // No unreviewed content, URL or reviewer prose escapes via error messages.
      const identity = z.object({ majorId: standardMajorSchema.shape.id }).passthrough().safeParse(raw)
      if (identity.success && majorIds.has(identity.data.majorId)) {
        const evidenceId = z.string().uuid().safeParse(identity.data.id)
        const kind = learningEvidenceKindSchema.safeParse(identity.data.kind)
        const scope = learningScopeSchema.safeParse(identity.data.scope)
        gaps.push({ majorId: identity.data.majorId, evidenceId: evidenceId.success ? evidenceId.data : null,
          kind: kind.success ? kind.data : null, scope: scope.success ? scope.data : null,
          sourceYear: null, status: 'invalid', reason: availabilityMessages.invalid })
      }
      continue
    }
    const item = result.data
    if (!majorIds.has(item.majorId)) continue
    const school = identitySchema.nullable().safeParse(row.school ?? null)
    const job = identitySchema.nullable().safeParse(row.job_direction ?? null)
    const relationValid = school.success && job.success &&
      (item.scope.schoolId === null || school.data?.id === item.scope.schoolId) &&
      (item.jobDirectionId === null || job.data?.id === item.jobDirectionId)
    const baseAvailability = relationValid ? evidenceAvailability(item, now) : 'invalid'
    const availability = baseAvailability === 'verified' && item.kind === 'career_requirement' &&
      item.jobDirectionId !== null && item.careerMappingStatus !== 'approved' ? 'pending' : baseAvailability
    if (availability !== 'verified') {
      gaps.push(gapFromEvidence(item, availability))
      continue
    }
    parsed.push({ ...item, school: school.success ? school.data : null, jobDirection: job.success ? job.data : null })
  }
  // Contradictory verified admission rules also become a gap. A separate
  // conflicting review in the same exact scope suppresses verified rules there.
  const facts = parsed.filter(item => {
    if (item.kind !== 'admission_requirement') return true
    const explicitConflict = gaps.some(gap => gap.majorId === item.majorId && gap.kind === 'admission_requirement' &&
      gap.status === 'conflicting' && sameAdmissionScope(gap.scope, item.scope))
    const assessment = evaluateAdmissionEvidence(parsed.filter(fact => fact.majorId === item.majorId).map(learningFactEvidence), {
      province: item.scope.province!, subjectGroup: item.scope.subjectGroup!, admissionYear: item.scope.admissionYear!,
      schoolId: item.scope.schoolId, selectedSubjects: [],
    }, now)
    if (!explicitConflict && assessment.status !== 'conflicting') return true
    gaps.push(gapFromEvidence(item, 'conflicting'))
    return false
  })
  return { majors: validMajors, facts, gaps }
}

function sameAdmissionScope(left: LearningEvidence['scope'] | null, right: LearningEvidence['scope']) {
  return left !== null && left.schoolId === right.schoolId && left.province === right.province &&
    left.subjectGroup === right.subjectGroup && left.admissionYear === right.admissionYear
}
function gapFromEvidence(item: LearningEvidence, status: Exclude<LearningEvidenceAvailability, 'verified'>): LearningEvidenceGap {
  return { majorId: item.majorId, evidenceId: item.id, kind: item.kind, status,
    scope: item.scope, sourceYear: item.source.year,
    reason: status === 'conflicting' && item.review.status === 'conflicting'
      ? `${availabilityMessages.conflicting}：${item.review.reason}` : availabilityMessages[status] }
}
