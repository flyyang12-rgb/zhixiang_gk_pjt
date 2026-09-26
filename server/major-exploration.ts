import { z } from 'zod'
import { evaluateAdmissionEvidence, learningCompleteness, type AdmissionEvidenceResult, type LearningEvidenceKind } from './learning-evidence-contract.js'
import { learningFactEvidence, loadCurrentLearningEvidence, type CurrentLearningFact, type LearningEvidenceDatabase,
  type LearningEvidenceGap, type LearningEvidenceSnapshot, type StandardMajor } from './learning-evidence-repository.js'

const subject = z.enum(['物理', '历史', '化学', '生物', '政治', '地理'])
export const explorationContextSchema = z.object({
  province: z.string().trim().min(1).max(30), subjectGroup: z.string().trim().min(1).max(50),
  selectedSubjects: z.array(subject).max(6), admissionYear: z.number().int().min(2000).max(2100),
  savedItems: z.array(z.object({ itemType: z.enum(['major', 'school']), itemId: z.number().int().positive().safe(),
    state: z.enum(['saved', 'excluded', 'target']), note: z.string().max(500).nullable().optional(),
  })).optional(),
})
export type ExplorationContext = Omit<z.infer<typeof explorationContextSchema>, 'selectedSubjects'> & { selectedSubjects: string[] }
export const explorationCatalogQuerySchema = z.object({
  search: z.string().trim().max(100).default(''), category: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict()
export type ExplorationCatalogQuery = z.input<typeof explorationCatalogQuerySchema>
export const explorationDetailScopeSchema = z.object({
  schoolId: z.coerce.number().int().positive().safe().nullable().optional(),
  sourceYear: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
}).strict()
export type ExplorationDetailScope = z.input<typeof explorationDetailScopeSchema>
export type ExplorationAdmission = AdmissionEvidenceResult & { admissionYear: number; evidence: CurrentLearningFact[] }
export type ExplorationCareerDirection = {
  id: number; name: string; evidence: CurrentLearningFact[]; requirements: CurrentLearningFact[];
  requirementStatus: 'available' | 'unknown';
}
export type ExplorationSchoolExample = {
  id: number; name: string; sourceYears: number[]; evidence: CurrentLearningFact[];
  admission: ExplorationAdmission; note: string;
}
export type ExplorationCompleteness = ReturnType<typeof learningCompleteness>
export type ExplorationMajorCard = StandardMajor & {
  status: 'available' | 'pending' | 'unavailable'; completeness: ExplorationCompleteness;
  admission: ExplorationAdmission; savedState: 'saved' | 'excluded' | 'target' | null; note: string | null;
  curriculum: CurrentLearningFact[]; learningActivities: CurrentLearningFact[];
  careerDirections: ExplorationCareerDirection[]; schoolExamples: ExplorationSchoolExample[];
  dataGaps: string[];
}
export type ExplorationCoverage = {
  reviewedMajorCount: number; completeMajorCount: number; incompleteMajorCount: number;
  displayedCount: number; excludedMajorCount: number; subjectNotMetMajorCount: number;
  sourceYears: number[]; lastReviewedAt: string | null;
}
export type ExplorationList = {
  mode: 'exploration'; cards: ExplorationMajorCard[]; coverage: ExplorationCoverage;
  admissionYear: number; generatedAt: string; orderNote: string; dataGaps: string[];
}
export type ExplorationCatalog = {
  items: ExplorationMajorCard[]; total: number; page: number; pageSize: number;
  categories: string[]; coverage: ExplorationCoverage; admissionYear: number; generatedAt: string;
}
export type ExplorationMajorDetail = {
  identity: StandardMajor; status: ExplorationMajorCard['status']; completeness: ExplorationCompleteness;
  requestedScope: { schoolId: number | null; sourceYear: number | null };
  materialStatus: 'available' | 'missing';
  facts: Record<LearningEvidenceKind, CurrentLearningFact[]>;
  otherInstances: CurrentLearningFact[]; careerDirections: ExplorationCareerDirection[];
  schoolExamples: ExplorationSchoolExample[]; admission: ExplorationAdmission;
  unavailableEvidence: LearningEvidenceGap[]; savedState: ExplorationMajorCard['savedState']; note: string | null;
  dataGaps: string[]; nextAction: string; generatedAt: string;
}

export async function buildExplorationList(db: LearningEvidenceDatabase, context: ExplorationContext): Promise<ExplorationList> {
  const validated = explorationContextSchema.parse(context)
  const now = new Date()
  return createExplorationList(await loadCurrentLearningEvidence(db, { now }), validated, now)
}
export async function loadExplorationCatalog(db: LearningEvidenceDatabase, context: ExplorationContext, query: ExplorationCatalogQuery = {}): Promise<ExplorationCatalog> {
  const validated = explorationContextSchema.parse(context)
  const parsedQuery = explorationCatalogQuerySchema.parse(query)
  const now = new Date()
  return createExplorationCatalog(await loadCurrentLearningEvidence(db, { now }), validated, parsedQuery, now)
}
export async function loadExplorationDetail(db: LearningEvidenceDatabase, context: ExplorationContext, majorId: number,
  scopeQuery: ExplorationDetailScope = {}): Promise<ExplorationMajorDetail | null> {
  const validated = explorationContextSchema.parse(context)
  const parsedId = z.number().int().positive().safe().parse(majorId)
  const scope = explorationDetailScopeSchema.parse(scopeQuery)
  const now = new Date()
  return createExplorationDetail(await loadCurrentLearningEvidence(db, { majorIds: [parsedId], now }), validated, parsedId, scope, now)
}

export function createExplorationList(snapshot: LearningEvidenceSnapshot, context: ExplorationContext, now = new Date()): ExplorationList {
  const cards = allCards(snapshot, context, now)
  const eligible = cards.filter(card => card.status === 'available' && card.savedState !== 'excluded' && card.admission.status !== 'not_met')
  // Completeness is a content threshold, not a personal-fit or employment rank.
  const displayed = [...eligible.filter(card => card.completeness.complete), ...eligible.filter(card => !card.completeness.complete)].slice(0, 9)
  return {
    mode: 'exploration', cards: displayed, coverage: coverage(snapshot, cards, displayed.length),
    admissionYear: context.admissionYear, generatedAt: now.toISOString(),
    orderNote: '完整资料优先；各组按专业类别、代码和 ID 浏览，顺序不表示适合度',
    dataGaps: [
      ...(displayed.length < 9 ? [`当前可浏览 ${displayed.length} 个专业，按实际审核资料展示`] : []),
      ...(cards.some(card => card.status === 'available' && !card.completeness.complete) ? ['部分专业的课程、学习活动或职业方向材料待补充'] : []),
      ...(cards.some(card => card.status === 'available' && card.admission.status === 'unknown') ? [`${context.admissionYear} 年当前范围的选科要求尚有缺口，未知不表示不限`] : []),
    ],
  }
}
export function createExplorationCatalog(snapshot: LearningEvidenceSnapshot, context: ExplorationContext,
  query: ExplorationCatalogQuery = {}, now = new Date()): ExplorationCatalog {
  const parsed = explorationCatalogQuerySchema.parse(query)
  const cards = allCards(snapshot, context, now)
  const reviewed = cards.filter(card => card.status === 'available')
  // With a name search, standard identities without usable materials remain
  // visible as pending/unavailable. An empty default directory is not fiction.
  const candidates = parsed.search ? cards : reviewed
  const filtered = candidates.filter(card => (!parsed.search || card.name.includes(parsed.search)) &&
    (!parsed.category || card.category === parsed.category))
  const items = filtered.slice((parsed.page - 1) * parsed.pageSize, parsed.page * parsed.pageSize)
  return { items, total: filtered.length, page: parsed.page, pageSize: parsed.pageSize,
    categories: [...new Set(reviewed.map(card => card.category))], coverage: coverage(snapshot, cards, items.length),
    admissionYear: context.admissionYear, generatedAt: now.toISOString() }
}

export function createExplorationDetail(snapshot: LearningEvidenceSnapshot, context: ExplorationContext, majorId: number,
  scopeQuery: ExplorationDetailScope = {}, now = new Date()): ExplorationMajorDetail | null {
  const identity = snapshot.majors.find(major => major.id === majorId)
  if (!identity) return null
  const scope = explorationDetailScopeSchema.parse(scopeQuery)
  const requestedScope = { schoolId: scope.schoolId ?? null, sourceYear: scope.sourceYear ?? null }
  const facts = snapshot.facts.filter(fact => fact.majorId === majorId)
  const inScope = (fact: CurrentLearningFact) => (requestedScope.schoolId === null || fact.scope.schoolId === requestedScope.schoolId) &&
    (requestedScope.sourceYear === null || fact.source.year === requestedScope.sourceYear)
  const selected = facts.filter(inScope)
  const unavailableEvidence = snapshot.gaps.filter(gap => gap.majorId === majorId &&
    (requestedScope.schoolId === null || gap.scope?.schoolId === requestedScope.schoolId) &&
    (requestedScope.sourceYear === null || gap.sourceYear === requestedScope.sourceYear))
  const selectedSnapshot = { ...snapshot, facts: selected, gaps: unavailableEvidence }
  const card = createCard(identity, selectedSnapshot, context, now, requestedScope.schoolId)
  const materialStatus = selected.some(fact => learningKinds.has(fact.kind)) ? 'available' : 'missing'
  const dataGaps = [...card.dataGaps,
    ...(materialStatus === 'missing' && (requestedScope.schoolId !== null || requestedScope.sourceYear !== null)
      ? ['指定学校或材料年份的学习资料缺失，其他范围材料仅作为另外的实例'] : []),
  ]
  const grouped = Object.fromEntries(factKinds.map(kind => [kind, selected.filter(fact => fact.kind === kind)])) as Record<LearningEvidenceKind, CurrentLearningFact[]>
  return { identity, status: card.status, completeness: card.completeness, requestedScope, materialStatus,
    facts: grouped, otherInstances: facts.filter(fact => !inScope(fact)),
    careerDirections: card.careerDirections, schoolExamples: card.schoolExamples,
    admission: admissionFor(selectedSnapshot, majorId, context, requestedScope.schoolId, now),
    unavailableEvidence, savedState: card.savedState, note: card.note,
    dataGaps: [...new Set(dataGaps)], nextAction: nextAction(card.completeness, context, materialStatus, requestedScope), generatedAt: now.toISOString() }
}

const factKinds: LearningEvidenceKind[] = ['curriculum', 'learning_activity', 'learning_prerequisite', 'course_prerequisite',
  'admission_requirement', 'career_direction', 'career_requirement']
const learningKinds = new Set<LearningEvidenceKind>(['curriculum', 'learning_activity', 'learning_prerequisite', 'course_prerequisite'])
function stableOrder(left: StandardMajor, right: StandardMajor) {
  return compareText(left.category, right.category) || compareText(left.code, right.code) || left.id - right.id
}
function compareText(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0 }
function allCards(snapshot: LearningEvidenceSnapshot, context: ExplorationContext, now: Date) {
  return [...snapshot.majors].sort(stableOrder).map(major => createCard(major, snapshot, context, now))
}
function createCard(identity: StandardMajor, snapshot: LearningEvidenceSnapshot, context: ExplorationContext, now: Date,
  admissionSchoolId: number | null = null): ExplorationMajorCard {
  const facts = snapshot.facts.filter(fact => fact.majorId === identity.id)
  const gaps = snapshot.gaps.filter(gap => gap.majorId === identity.id)
  const completeness = learningCompleteness(facts.map(learningFactEvidence), now)
  const admission = admissionFor(snapshot, identity.id, context, admissionSchoolId, now)
  const saved = context.savedItems?.find(item => item.itemType === 'major' && item.itemId === identity.id)
  const careerDirections = makeCareerDirections(facts)
  const schoolExamples = makeSchoolExamples(snapshot, facts, identity.id, context, now)
  const status = facts.length ? 'available' : gaps.some(gap => ['withdrawn', 'expired', 'rejected', 'conflicting', 'invalid'].includes(gap.status)) ? 'unavailable' : 'pending'
  return { ...identity, status, completeness, admission, savedState: saved?.state ?? null, note: saved?.note ?? null,
    curriculum: facts.filter(fact => fact.kind === 'curriculum'), learningActivities: facts.filter(fact => fact.kind === 'learning_activity'),
    careerDirections, schoolExamples, dataGaps: [...new Set([
      ...completeness.missing,
      ...(status === 'pending' ? ['资料待补充；不代表专业不存在或就业差'] : []),
      ...(admission.status !== 'known' ? [admission.reason] : []),
      ...(!schoolExamples.length ? ['具体专业的学校学习实例待补充'] : []),
      ...(careerDirections.some(direction => direction.requirementStatus === 'unknown') ? ['部分职业方向的读研、考证或准入门槛材料待补充'] : []),
      ...gaps.map(gap => gap.reason),
    ])] }
}
function admissionFor(snapshot: LearningEvidenceSnapshot, majorId: number, context: ExplorationContext,
  schoolId: number | null, now: Date): ExplorationAdmission {
  const facts = snapshot.facts.filter(fact => fact.majorId === majorId)
  const conflicts = snapshot.gaps.filter(gap => gap.majorId === majorId && gap.kind === 'admission_requirement' && gap.status === 'conflicting' &&
    gap.scope?.schoolId === schoolId && gap.scope?.province === context.province && gap.scope?.subjectGroup === context.subjectGroup &&
    gap.scope?.admissionYear === context.admissionYear)
  const result: AdmissionEvidenceResult = conflicts.length
    ? { status: 'conflicting', evidenceIds: conflicts.flatMap(gap => gap.evidenceId ? [gap.evidenceId] : []), reason: '当前范围的招生选科材料存在冲突，需核验' }
    : evaluateAdmissionEvidence(facts.map(learningFactEvidence), { ...context, schoolId }, now)
  return { ...result, admissionYear: context.admissionYear,
    reason: result.status === 'unknown' ? `${context.province} ${context.subjectGroup} ${context.admissionYear} 年${schoolId === null ? '专业范围' : '该学校'}的选科材料待核验，未知不表示不限` : result.reason,
    evidence: result.status === 'conflicting' ? [] : facts.filter(fact => result.evidenceIds.includes(fact.id)) }
}
function makeCareerDirections(facts: CurrentLearningFact[]): ExplorationCareerDirection[] {
  const directions = new Map<number, CurrentLearningFact[]>()
  for (const fact of facts) if (fact.kind === 'career_direction' && fact.jobDirection && fact.careerMappingStatus === 'approved') {
    directions.set(fact.jobDirection.id, [...(directions.get(fact.jobDirection.id) ?? []), fact])
  }
  return [...directions.entries()].sort(([left], [right]) => left - right).slice(0, 3).map(([id, evidence]) => {
    const requirements = facts.filter(fact => fact.kind === 'career_requirement' && (fact.jobDirectionId === id || fact.jobDirectionId === null))
    return { id, name: evidence[0]!.jobDirection!.name, evidence, requirements,
      requirementStatus: requirements.length ? 'available' : 'unknown' }
  })
}
function makeSchoolExamples(snapshot: LearningEvidenceSnapshot, facts: CurrentLearningFact[], majorId: number,
  context: ExplorationContext, now: Date): ExplorationSchoolExample[] {
  const schools = new Map<number, CurrentLearningFact[]>()
  for (const fact of facts) if (fact.scope.level === 'school' && fact.school && learningKinds.has(fact.kind)) {
    schools.set(fact.school.id, [...(schools.get(fact.school.id) ?? []), fact])
  }
  return [...schools.entries()].sort(([left], [right]) => left - right).slice(0, 2).map(([id, evidence]) => ({
    id, name: evidence[0]!.school!.name, sourceYears: [...new Set(evidence.map(fact => fact.source.year))].sort(), evidence,
    admission: admissionFor(snapshot, majorId, context, id, now),
    note: '仅为该学校对应年份的学习实例，不能据此认定当前可报或可达',
  }))
}
function coverage(snapshot: LearningEvidenceSnapshot, cards: ExplorationMajorCard[], displayedCount: number): ExplorationCoverage {
  const reviewed = cards.filter(card => card.status === 'available')
  const dates = snapshot.facts.flatMap(fact => fact.review.reviewedAt ? [fact.review.reviewedAt] : []).sort()
  return { reviewedMajorCount: reviewed.length, completeMajorCount: reviewed.filter(card => card.completeness.complete).length,
    incompleteMajorCount: reviewed.filter(card => !card.completeness.complete).length, displayedCount,
    excludedMajorCount: reviewed.filter(card => card.savedState === 'excluded').length,
    subjectNotMetMajorCount: reviewed.filter(card => card.admission.status === 'not_met').length,
    sourceYears: [...new Set(snapshot.facts.map(fact => fact.source.year))].sort(), lastReviewedAt: dates.at(-1) ?? null }
}
function nextAction(completeness: ExplorationCompleteness, context: ExplorationContext, materialStatus: ExplorationMajorDetail['materialStatus'],
  requestedScope: ExplorationMajorDetail['requestedScope']) {
  if (materialStatus === 'missing' && (requestedScope.schoolId !== null || requestedScope.sourceYear !== null)) return '到指定学校官网查找对应年份的专业培养方案，核对课程章节。'
  if (!completeness.curriculum) return '到意向学校官网查找这个专业的培养方案，核对课程章节。'
  if (!completeness.activities) return '打开已有培养材料，核对实验、项目或实践安排所在章节。'
  if (!completeness.directions) return '在该专业的官方介绍中核对一个职业方向及其依据。'
  return `打开 ${context.admissionYear} 年本省官方选科材料，核对这个专业在意向学校的要求。`
}
