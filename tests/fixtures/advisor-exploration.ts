import { createExplorationDetail, type ExplorationMajorDetail } from '../../server/major-exploration.js'
import { parseCurrentLearningEvidence } from '../../server/learning-evidence-repository.js'
import { learningEvidenceFixture, evidenceNow } from './learning-evidence.js'
import type { LearningEvidence } from '../../server/learning-evidence-contract.js'
import type { AdvisorReplyContext } from '../../server/advisor-reply.js'

export function advisorLearningDetail(options: { state?: 'verified'|'pending'|'withdrawn'; saved?: boolean; note?: string|null; curriculum?: string } = {}): ExplorationMajorDetail {
  const facts: LearningEvidence[] = [
    learningEvidenceFixture({ majorId: 12, content: options.curriculum ?? '合成课程：材料观察与记录' }),
    learningEvidenceFixture({ majorId: 12, id: '10000000-0000-4000-8000-000000000002', factKey: 'activity', kind: 'learning_activity', content: '合成学习活动：实验记录与团队讨论' }),
    learningEvidenceFixture({ majorId: 12, id: '10000000-0000-4000-8000-000000000003', factKey: 'career', kind: 'career_direction', jobDirectionId: 1, careerMappingStatus: 'approved', content: '合成职业方向：资料分析' }),
    learningEvidenceFixture({ majorId: 12, id: '10000000-0000-4000-8000-000000000004', factKey: 'prerequisite', kind: 'course_prerequisite', content: '合成课程先修：完成基础观察课程' }),
  ].map(fact => options.state==='withdrawn' ? { ...fact, batch: { ...fact.batch, status: 'withdrawn' } }
    : options.state==='pending' ? { ...fact, review: {status:'pending', reviewer:null, reviewedAt:null, conclusion:null, reason:null} } : fact)
  const snapshot = parseCurrentLearningEvidence([{ id: 12, code: '990012', name: '合成专业十二', category: '工学' }],
    facts.map(evidence => ({ evidence, school: { id: 1, name: '合成测试学校' }, job_direction: evidence.jobDirectionId ? { id:1,name:'合成资料分析方向' } : null })), evidenceNow)
  return createExplorationDetail(snapshot, { province: '河南', subjectGroup: '物理类', selectedSubjects: ['物理','生物','地理'], admissionYear: 2026,
    savedItems: options.saved ? [{ itemType:'major',itemId:12,state:'saved',note:options.note??null }] : [] }, 12, {}, evidenceNow)!
}

export function advisorLearningContext(detail:ExplorationMajorDetail|null=advisorLearningDetail()):AdvisorReplyContext {
  return { profile:{studentName:'合成测试',province:'河南',subjectGroup:'物理类',score:null,provinceRank:null},
    dashboard:{mode:'exploration',cards:[],planningCoordinate:{rank:null},savedItems:[],employment:{usable:false}} as unknown as AdvisorReplyContext['dashboard'],
    schoolDetail:null,focusedMajor:null,majorDetail:detail }
}
