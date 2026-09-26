import { z } from 'zod'

const id = z.number().int().positive().safe()
const text = z.string().trim().min(1)
const timestamp = z.string().datetime({ offset: true })
const checksum = z.string().regex(/^[a-f0-9]{64}$/, '需要 SHA-256 校验值')
const year = z.number().int().min(2000).max(2100)

// A reachable URL is not an approval. The reviewer must confirm the publisher,
// original wording, locator and scope before a fact can become effective.
export const officialEvidenceUrlSchema = z.string().url().superRefine((value, context) => {
  let url: URL
  try { url = new URL(value) } catch {
    context.addIssue({ code: 'custom', message: '来源地址格式不正确' })
    return
  }
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password ||
      hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || !hostname.includes('.') ||
      /^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    context.addIssue({ code: 'custom', message: '来源须为无凭据的公开 HTTPS 材料地址' })
  }
})

export const learningEvidenceKindSchema = z.enum([
  'curriculum', 'learning_activity', 'learning_prerequisite', 'course_prerequisite',
  'admission_requirement', 'career_direction', 'career_requirement',
])
export const learningReviewStatusSchema = z.enum(['pending', 'verified', 'conflicting', 'rejected', 'withdrawn'])
export const learningBatchSchema = z.object({
  id: z.string().uuid(),
  checksum,
  status: z.enum(['staged', 'active', 'withdrawn']),
}).strict()

export const learningSourceSchema = z.object({
  id,
  artifactId: z.string().uuid(),
  title: text.max(500),
  url: officialEvidenceUrlSchema,
  year,
  publisher: text.max(200),
  publisherType: z.enum(['education_authority', 'university', 'professional_authority']),
  sha256: checksum,
  collectedAt: timestamp,
}).strict()

export const learningScopeSchema = z.object({
  level: z.enum(['major', 'school']),
  schoolId: id.nullable(),
  province: text.max(30).nullable(),
  subjectGroup: text.max(50).nullable(),
  admissionYear: year.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.level === 'school') !== (value.schoolId !== null)) {
    context.addIssue({ code: 'custom', message: '学校实例必须指定学校；专业范围不得携带学校 ID' })
  }
})

export const learningReviewSchema = z.object({
  status: learningReviewStatusSchema,
  reviewer: text.max(100).nullable(),
  reviewedAt: timestamp.nullable(),
  conclusion: z.enum(['verified', 'conflicting', 'rejected', 'withdrawn']).nullable(),
  reason: text.max(1000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === 'pending') {
    if (value.conclusion !== null) context.addIssue({ code: 'custom', message: '待审核不能带通过结论' })
  } else if (!value.reviewer || !value.reviewedAt || !value.reason || value.conclusion !== value.status) {
    context.addIssue({ code: 'custom', message: '审核结果须有核验人、时间、同一结论及理由' })
  }
})

const subjectSchema = z.enum(['物理', '历史', '化学', '生物', '政治', '地理'])
export const admissionSubjectConditionSchema = z.object({
  type: z.literal('subjects'),
  mode: z.enum(['all', 'any', 'unrestricted']),
  subjects: z.array(subjectSchema).max(6),
}).strict().superRefine((value, context) => {
  if ((value.mode === 'unrestricted') !== (value.subjects.length === 0) ||
      new Set(value.subjects).size !== value.subjects.length) {
    context.addIssue({ code: 'custom', message: '不限须显式登记；有条件的选科列表不能为空或重复' })
  }
})

export const learningEvidenceSchema = z.object({
  id: z.string().uuid(),
  factKey: text.max(160),
  majorId: id,
  kind: learningEvidenceKindSchema,
  content: text.max(2000),
  source: learningSourceSchema,
  locator: z.object({ kind: z.enum(['page', 'section', 'anchor']), value: text.max(500) }).strict(),
  scope: learningScopeSchema,
  review: learningReviewSchema,
  batch: learningBatchSchema,
  validUntil: timestamp.nullable(),
  jobDirectionId: id.nullable(),
  careerMappingStatus: z.enum(['pending', 'approved', 'rejected']).nullable(),
  condition: admissionSubjectConditionSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'admission_requirement') {
    if (!value.condition || !value.scope.province || !value.scope.subjectGroup || !value.scope.admissionYear) {
      context.addIssue({ code: 'custom', message: '招生资格须明确选科、省份、科类及招生年' })
    }
  } else if (value.condition !== null) {
    context.addIssue({ code: 'custom', message: '学习或职业条件不得携带招生选科规则' })
  }
  if (value.kind === 'career_direction' && (!value.jobDirectionId || !value.careerMappingStatus)) {
    context.addIssue({ code: 'custom', message: '职业方向须关联已有的专业—职业映射' })
  }
  if (value.jobDirectionId === null && value.careerMappingStatus !== null) {
    context.addIssue({ code: 'custom', message: '无职业方向 ID 时不能有映射审核状态' })
  }
  if (value.review.reviewedAt && value.validUntil && Date.parse(value.validUntil) < Date.parse(value.review.reviewedAt)) {
    context.addIssue({ code: 'custom', message: '有效期不得早于核验时间' })
  }
})

export type LearningEvidence = z.infer<typeof learningEvidenceSchema>
export type LearningEvidenceKind = LearningEvidence['kind']
export type LearningScope = LearningEvidence['scope']
export type AdmissionSubjectCondition = z.infer<typeof admissionSubjectConditionSchema>
export type LearningEvidenceAvailability = 'verified' | 'pending' | 'conflicting' | 'rejected' | 'withdrawn' | 'expired' | 'invalid'

export function evidenceAvailability(input: unknown, now = new Date()): LearningEvidenceAvailability {
  const parsed = learningEvidenceSchema.safeParse(input)
  if (!parsed.success || !Number.isFinite(now.getTime())) return 'invalid'
  const evidence = parsed.data
  if (evidence.batch.status === 'withdrawn') return 'withdrawn'
  if (evidence.review.status !== 'verified') return evidence.review.status
  if (evidence.batch.status !== 'active') return 'pending'
  if (Date.parse(evidence.review.reviewedAt!) > now.getTime() || Date.parse(evidence.source.collectedAt) > now.getTime()) return 'pending'
  if (evidence.validUntil && Date.parse(evidence.validUntil) <= now.getTime()) return 'expired'
  if (evidence.kind === 'career_direction' && evidence.careerMappingStatus !== 'approved') return 'pending'
  return 'verified'
}

export function learningCompleteness(evidence: readonly LearningEvidence[], now = new Date()) {
  const effective = evidence.filter(item => evidenceAvailability(item, now) === 'verified')
  const curriculum = effective.filter(item => item.kind === 'curriculum').length
  const activities = effective.filter(item => item.kind === 'learning_activity').length
  const directions = new Set(effective.filter(item => item.kind === 'career_direction').map(item => item.jobDirectionId)).size
  return { complete: curriculum > 0 && activities > 0 && directions > 0, curriculum, activities, directions,
    missing: [!curriculum ? '课程材料待补充' : null, !activities ? '学习活动材料待补充' : null,
      !directions ? '职业方向材料待补充' : null].filter((item): item is string => item !== null) }
}

export type AdmissionScopeContext = { province: string; subjectGroup: string; admissionYear: number; schoolId: number | null; selectedSubjects: string[] }
export type AdmissionEvidenceResult = { status: 'known' | 'unknown' | 'not_met' | 'conflicting'; evidenceIds: string[]; reason: string }

// No date/province/school fallback. A school rule never filters a whole major.
export function evaluateAdmissionEvidence(evidence: readonly LearningEvidence[], context: AdmissionScopeContext, now = new Date()): AdmissionEvidenceResult {
  const scoped = evidence.filter(item => item.kind === 'admission_requirement' &&
    item.scope.schoolId === context.schoolId && item.scope.province === context.province &&
    item.scope.subjectGroup === context.subjectGroup && item.scope.admissionYear === context.admissionYear)
  const available = scoped.filter(item => evidenceAvailability(item, now) === 'verified')
  const conflicting = scoped.filter(item => evidenceAvailability(item, now) === 'conflicting')
  if (conflicting.length) return { status: 'conflicting', evidenceIds: conflicting.map(item => item.id), reason: '当前范围的招生资料存在冲突，需核验' }
  if (!available.length) return { status: 'unknown', evidenceIds: [], reason: '当前学校、省份、科类及招生年缺少已核验选科材料' }
  const conditionKey = (item: LearningEvidence) => `${item.condition!.mode}:${[...item.condition!.subjects].sort().join(',')}`
  if (new Set(available.map(conditionKey)).size > 1) {
    return { status: 'conflicting', evidenceIds: available.map(item => item.id), reason: '当前范围有不同选科要求，不自动选择其中一条' }
  }
  const condition = available[0]!.condition!
  const met = condition.mode === 'unrestricted' || (condition.mode === 'all'
    ? condition.subjects.every(subject => context.selectedSubjects.includes(subject))
    : condition.subjects.some(subject => context.selectedSubjects.includes(subject)))
  return { status: met ? 'known' : 'not_met', evidenceIds: available.map(item => item.id), reason: met ? '符合该范围已核验选科要求' : '不符合该范围已核验选科要求' }
}

export type LearningMaterialRequest = { schoolId: number | null; sourceYear: number | null }
export function selectLearningMaterials(evidence: readonly LearningEvidence[], request: LearningMaterialRequest, now = new Date()) {
  const effective = evidence.filter(item => evidenceAvailability(item, now) === 'verified')
  const matches = (item: LearningEvidence) => (request.schoolId === null || item.scope.schoolId === request.schoolId) &&
    (request.sourceYear === null || item.source.year === request.sourceYear)
  return { status: effective.some(matches) ? 'available' as const : 'missing' as const,
    evidence: effective.filter(matches), otherInstances: effective.filter(item => !matches(item)),
    requestedScope: request }
}
