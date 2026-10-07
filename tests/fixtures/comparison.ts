import type { ExplorationMajorDetail, ProfessionDashboard, SchoolDetail } from '../../src/api'
import { learningEvidenceFixture } from './learning-evidence'

export const comparisonProfileId = '80000000-0000-4000-8000-000000000001'
const names = ['计算机科学与技术', '数学与应用数学', '汉语言文学']
export function comparisonMajor(id: number): ExplorationMajorDetail {
  const f = (suffix: number, kind: NonNullable<Parameters<typeof learningEvidenceFixture>[0]>['kind'], content: string) => ({
    ...learningEvidenceFixture({ id: `10000000-0000-4000-8000-${String(id * 10 + suffix).padStart(12, '0')}`, majorId: id, kind, content }),
    school: { id: 1, name: '合成测试学院' }, jobDirection: null,
  })
  const course = f(1, 'curriculum', '合成测试课程：基础知识、资料分析与专题研讨。课程安排只适用于材料所注明的学校和年份。')
  const activity = f(2, 'learning_activity', '合成测试学习活动：小组讨论、实践记录与项目展示。')
  return { identity: { id, name: names[id - 1] ?? `合成专业 ${id}`, code: ['080901', '070101', '050101'][id - 1] ?? String(id), category: ['工学', '理学', '文学'][id - 1] ?? '合成类别' },
    status: 'available', materialStatus: 'available', requestedScope: { schoolId: null, sourceYear: null },
    completeness: { complete: true, curriculum: 1, activities: 1, directions: 1, missing: [] },
    facts: { curriculum: [course], learning_activity: [activity], learning_prerequisite: [], course_prerequisite: [], career_direction: [], career_requirement: [], admission_requirement: [] },
    careerDirections: [{ id, name: '合成资料分析方向', requirementStatus: 'available', evidence: [f(3, 'career_direction', '合成测试职业材料：围绕资料整理与分析开展工作。')], requirements: [f(4, 'career_requirement', '合成测试职业门槛：具体岗位条件需要逐项核验，不能认定本科可直接进入。')] }],
    otherInstances: [], schoolExamples: [], admission: { status: 'unknown', evidenceIds: [], reason: '当前省份与招生年份的选科要求待核验', admissionYear: 2026, evidence: [] },
    unavailableEvidence: [], savedState: 'saved', note: '想先核对课程安排，再讨论职业门槛。',
    dataGaps: ['当前范围选科资格待核验', '培养成本材料待补充'], nextAction: '核对材料所对应学校的最新培养方案', generatedAt: '2026-10-07T00:00:00Z' }
}
export function comparisonSchool(id: number): SchoolDetail {
  return { school: { id, name: id === 1 ? '合成探索学院' : '合成比较学院', province: '河南', city: id === 1 ? '郑州' : '洛阳', level: '本科', schoolType: '公办', features: {}, officialUrl: null, admissionsUrl: null, linksVerifiedAt: null, linksSourceUrl: null },
    featuredMajors: [], recommendedMajors: [], admissionContext: null, interpretation: [{ label: '学校定位', text: '合成测试学校，暂无经核验优势专业资料。' }], isSaved: true }
}
export function comparisonDashboard(): ProfessionDashboard {
  const majors = [1, 2, 3].map(comparisonMajor)
  const cards = majors.map(d => ({ ...d.identity, status: d.status, completeness: d.completeness, curriculum: d.facts.curriculum, learningActivities: d.facts.learning_activity, careerDirections: d.careerDirections,
    schoolExamples: [], admission: d.admission, savedState: d.savedState, note: d.note, dataGaps: d.dataGaps, nextAction: d.nextAction }))
  return { mode: 'exploration', profileSummary: { studentName: '家庭讨论', province: '河南', subjectGroup: '物理类', planningMode: 'exploration', score: null, provinceRank: null },
    planningCoordinate: { rank: null, sampleCount: 0, bestRank: null, worstRank: null, spreadRatio: null, stability: 'single' }, scoreSnapshots: [],
    employment: { healthySources: 0, lastSuccessAt: null, staleDays: null, usable: false, windowDays: 30 }, majorPool: { reviewedMajorCount: 3, displayedCount: 3, outlookEvidenceCount: 0 }, dataGaps: [], schoolCandidates: [], admissionEvidence: { years: [], unitType: null, confidence: '无', recordCount: 0, note: '暂无招生记录' }, cards: [],
    savedItems: [...majors.map(d => ({ itemType: 'major' as const, itemId: d.identity.id, itemName: d.identity.name, state: 'saved' as const, note: d.note })), ...[1, 2].map(id => ({ itemType: 'school' as const, itemId: id, itemName: comparisonSchool(id).school.name, state: 'target' as const, note: '还想核对住宿条件和城市生活成本。' }))],
    exploration: { mode: 'exploration', cards, coverage: { reviewedMajorCount: 3, completeMajorCount: 3, incompleteMajorCount: 0, displayedCount: 3, excludedMajorCount: 0, subjectNotMetMajorCount: 0, sourceYears: [2025], lastReviewedAt: '2026-09-21T00:00:00Z' }, orderNote: '按标准专业名称浏览，顺序不表示适合度', dataGaps: [], admissionYear: 2026, generatedAt: '2026-10-07T00:00:00Z' } }
}
