export type StudentProfile = {
  id: string
  studentName: string
  province: string
  subjectGroup: string
  selectedSubjects: Array<'物理'|'历史'|'化学'|'生物'|'政治'|'地理'>
  score: number
  provinceRank: number | null
  planningMode: 'exploration' | 'application'
  currentStage: 'recommendation'
  updatedAt: string
}

export type ProfileInput = Omit<StudentProfile, 'id' | 'currentStage' | 'updatedAt'>

export type DecisionFactor = 'majorFit' | 'schoolLevel' | 'career' | 'city' | 'cost' | 'distance'
export type ProfilePreferences = {
  postgraduateTendency: 'employment' | 'open' | 'planned' | 'uncertain'
  familyConditions: {
    annualBudget: string
    employmentTiming: string
    industryResources: string
    familyBusiness: string
    studySupport: string
    locationAcceptance: string
    highCostCity: string
  }
  studentRanking: DecisionFactor[]
  parentRanking: DecisionFactor[]
  finalWeights: Record<DecisionFactor, number>
  status?: 'completed'
  updatedAt?: string
}

export type School = { id: number; name: string; province: string; city: string; level: string; schoolType: string; features: Record<string, unknown> }
export type SchoolDetail = {
  school: School & { officialUrl:string|null;admissionsUrl:string|null;linksVerifiedAt:string|null;linksSourceUrl:string|null }
  featuredMajors:Array<{id:number;majorId:number|null;name:string;category:string|null;majorCode:string|null;educationLevel:'本科'|'高职';recognitionType:string;recognitionYear:number|null;sourceYear:number;sourceUrl:string;publisher:string;verifiedAt:string}>
  recommendedMajors:Array<{name:string;basis:string;evidenceLevel:'admission'|'orientation';sourceUrl:string|null}>
  admissionContext:null|{profileProvince:string;subjectGroup:string;provinceRank:number|null;years:number[];records:Array<{id:number;year:number;educationLevel:'本科'|'专科';admissionCategory:string;batch:string;planType:string;eligibilityRequirement:string|null;recommendationEligible:boolean;recommendationExclusionReason:string|null;unitType:'exact_major'|'major_group'|'school_line';unitName:string;unitCode:string|null;subjectRequirement:string|null;minScore:number|null;minRank:number|null;risk:'冲'|'稳'|'保'|null;confidence:'低'|'中'|'高';sourceUrl:string|null;publisher:string|null}>}
  interpretation:Array<{label:string;text:string}>
  isSaved:boolean
}
export type ProvinceMapData = { name: string; schoolCount: number; keyUniversityCount: number; vocationalCount: number }
export type DataCoverage = { province: string; subjectGroup: string; years: number[]; recordCount: number;totalRecordCount:number }
export type DataCoverageDetail={province:string;year:number;subjectGroup:string;educationLevel:'本科'|'专科';admissionCategory:string;batch:string;unitType:'exact_major'|'major_group'|'school_line';recordCount:number;recommendationEligibleCount:number;auditedGapCount:number;sourceStatus:'verified'|'pending'}
export type DataYearStatus = { province: string; year: number; recordCount: number;recommendationEligibleCount:number; subjectGroups: string[];educationLevels:string[];batches:string[]; publisher: string; sourceUrl: string; updatedAt: string }
export type RecommendationCandidate = { schoolId: number; schoolName: string; province: string; city: string; level: string; officialUrl:string; admissionsUrl:string; linksSourceUrl:string; unitId:number;unitName:string;unitType:'exact_major'|'major_group'|'school_line';subjectRequirement:string|null;sourceUrl:string; referenceRank: number; bestRank: number; programCount: number; dataYears: number[]; confidence: '低'|'中'|'高'; risk: '冲'|'稳'|'保'; ruleScore: number; majors: Array<{name:string;minRank:number;fit:string}>; reasons:string[] }
export type RecommendationSource = { title: string; sourceUrl: string; sourceYear: number; publisher: string }
export type RecommendationResult = { generatedAt: string; sourceYear: number|null; dataYears?: number[]; sources?: RecommendationSource[]; candidates: RecommendationCandidate[]; warning: string }

type ApiResponse<T> = {
  success: boolean
  data: T
  error: string | null
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  const result = await response.json() as ApiResponse<T>
  if (!response.ok || !result.success) throw new Error(result.error ?? '请求失败')
  return result.data
}

export async function createProfile(input: ProfileInput) {
  return request<{ id: string }>('/api/profiles', { method: 'POST', body: JSON.stringify(input) })
}

export async function getProfile(id: string) {
  return request<StudentProfile>(`/api/profiles/${id}`)
}

export async function getProfiles() {
  return request<StudentProfile[]>('/api/profiles')
}

export async function deleteProfile(id: string) {
  return request<{ id: string }>(`/api/profiles/${id}`, { method: 'DELETE' })
}

export async function updateProvinceRank(id: string, provinceRank: number) {
  return request<{ provinceRank: number }>(`/api/profiles/${id}/rank`, { method: 'PATCH', body: JSON.stringify({ provinceRank }) })
}

export type ScoreSnapshot={id:number;examName:string;examDate:string;score:number|null;provinceRank:number|null;note:string|null;isCurrent:boolean;createdAt?:string}
export function getScoreSnapshots(profileId:string){return request<ScoreSnapshot[]>(`/api/profiles/${profileId}/score-snapshots`)}
export function addScoreSnapshot(profileId:string,input:{examName:string;examDate:string;score:number;provinceRank:number|null;note?:string|null}){return request<ScoreSnapshot>(`/api/profiles/${profileId}/score-snapshots`,{method:'POST',body:JSON.stringify(input)})}
export function deleteScoreSnapshot(profileId:string,snapshotId:number){return request<{id:number;restoredSnapshotId:number|null}>(`/api/profiles/${profileId}/score-snapshots/${snapshotId}`,{method:'DELETE'})}

export async function getPreferences(profileId: string) {
  return request<ProfilePreferences | null>(`/api/profiles/${profileId}/preferences`)
}

export async function savePreferences(profileId: string, preferences: ProfilePreferences) {
  return request<ProfilePreferences>(`/api/profiles/${profileId}/preferences`, {
    method: 'PUT',
    body: JSON.stringify(preferences),
  })
}

export async function getProvinceMapData() {
  return request<ProvinceMapData[]>('/api/map/provinces')
}

export async function getDataStatus() {
  return request<{ schoolCount: number; provinceCount: number; coverage: DataCoverage[];coverageDetails:DataCoverageDetail[]; yearStatus: DataYearStatus[] }>('/api/admin/data-status')
}

export type AuditStatusCounts={verified:number;unavailable:number;notApplicable:number;pending:number;missing:number}
export type SchoolDataQuality={summary:{totalSchools:number;officialWebsite:AuditStatusCounts;admissionsWebsite:AuditStatusCounts;featuredMajors:AuditStatusCounts;admissionYears:AuditStatusCounts};items:Array<{id:number;name:string;province:string;city:string;level:string;linksVerifiedAt:string|null;missing:string[];facts:Array<{factType:string;status:'verified'|'unavailable'|'not_applicable'|'pending';reason:string|null;sourceUrl:string|null;checkedAt:string|null}>}>;totalPending:number;page:number;pageSize:number}
export function getSchoolDataQuality(filters:{page?:number;pageSize?:number;q?:string;province?:string;level?:string;year?:number;factType?:string;status?:string}={}){const params=new URLSearchParams(Object.entries(filters).filter(([,value])=>value!==undefined&&value!=='').map(([key,value])=>[key,String(value)]));return request<SchoolDataQuality>(`/api/admin/school-data-quality?${params}`)}

export async function getSchools(filters: { province?: string; level?: string; q?: string; page?: number } = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))
  return request<{ items: School[]; total: number; page: number; pageSize: number }>(`/api/schools?${params}`)
}

export async function getSchoolDetail(schoolId:number,profileId?:string){
  const params=profileId?`?profileId=${encodeURIComponent(profileId)}`:''
  return request<SchoolDetail>(`/api/schools/${schoolId}${params}`)
}

export async function generateRecommendations(profileId: string) {
  return request<RecommendationResult>(`/api/profiles/${profileId}/recommendations/generate`, { method: 'POST' })
}

export async function getRecommendations(profileId: string) {
  return request<RecommendationResult|null>(`/api/profiles/${profileId}/recommendations`)
}

export type AdvisorFocus = { type:'school';schoolId:number;schoolName:string }|{type:'major';majorId:number;majorName:string}
export type AdvisorEvidenceRef={title:string;year:number|null;publisher:string;url:string}
export type AdvisorMessage = { id?:number;role:'user'|'assistant';content:string;createdAt:string;mode?:string;focus?:AdvisorFocus;clientMessageId?:string;replyToMessageId?:number;status?:'pending'|'complete'|'failed';evidenceRefs?:AdvisorEvidenceRef[];retryText?:string }
export type AdvisorConversation={id:string;title:string;focus:AdvisorFocus|null;createdAt:string;updatedAt?:string;messageCount:number;lastMessagePreview:string}
export type AdvisorConversationPage={items:AdvisorConversation[];total:number;page:number;pageSize:number}
export type AdvisorMessagePage={items:AdvisorMessage[];nextCursor:number|null}
export type AdvisorSendResult={conversation?:AdvisorConversation;userMessage:AdvisorMessage;assistantMessage:AdvisorMessage;mode:string;focus:AdvisorFocus|null;evidenceRefs:AdvisorEvidenceRef[]}
export async function getAdvisorMessages(profileId:string){ return request<AdvisorMessage[]>(`/api/profiles/${profileId}/advisor/messages`) }
export async function sendAdvisorMessage(profileId:string,message:string,focus?:AdvisorFocus){ return request<AdvisorMessage>(`/api/profiles/${profileId}/advisor/messages`,{method:'POST',body:JSON.stringify({message,focus:focus?(focus.type==='school'?{type:'school',schoolId:focus.schoolId}:{type:'major',majorId:focus.majorId}):undefined})}) }
function publicAdvisorFocus(focus?:AdvisorFocus|null){return focus?(focus.type==='school'?{type:'school',schoolId:focus.schoolId}:{type:'major',majorId:focus.majorId}):undefined}
export function createAdvisorConversation(profileId:string,message:string,clientMessageId:string,focus?:AdvisorFocus|null){return request<AdvisorSendResult>(`/api/profiles/${profileId}/advisor/conversations`,{method:'POST',body:JSON.stringify({focus:publicAdvisorFocus(focus),initialMessage:message,clientMessageId})})}
export function getAdvisorConversations(profileId:string,page=1,pageSize=20){return request<AdvisorConversationPage>(`/api/profiles/${profileId}/advisor/conversations?page=${page}&pageSize=${pageSize}`)}
export function getConversationMessages(profileId:string,conversationId:string,beforeId?:number,pageSize=50){const cursor=beforeId?`&beforeId=${beforeId}`:'';return request<AdvisorMessagePage>(`/api/profiles/${profileId}/advisor/conversations/${conversationId}/messages?pageSize=${pageSize}${cursor}`)}
export function sendConversationMessage(profileId:string,conversationId:string,message:string,clientMessageId:string){return request<AdvisorSendResult>(`/api/profiles/${profileId}/advisor/conversations/${conversationId}/messages`,{method:'POST',body:JSON.stringify({message,clientMessageId})})}
export async function deleteAdvisorConversation(profileId:string,conversationId:string){const response=await fetch(`/api/profiles/${profileId}/advisor/conversations/${conversationId}`,{method:'DELETE'});if(!response.ok){const result=await response.json().catch(()=>null) as ApiResponse<null>|null;throw new Error(result?.error??'删除会话失败')}}
export type SchoolComparisonAnalysis={content:string;mode:'ai'|'local'}
export async function getSchoolComparisonAnalysis(profileId:string,schoolIds:number[]){return request<SchoolComparisonAnalysis>(`/api/profiles/${profileId}/advisor/comparison`,{method:'POST',body:JSON.stringify({schoolIds})})}
export function downloadReport(profileId:string){ window.location.href=`/api/profiles/${profileId}/report.pdf` }

export type ProfessionFactor = { value:number|null;weight:number;evidence:string }
export type ProfessionJob = { id:number;name:string;employmentCategory:string;requiresPostgraduate:boolean;requiresCertificate:boolean;directEntry:boolean }
export type ProfessionSchool = { id:number;name:string;level:string;city:string;officialUrl:string|null;admissionsUrl:string|null;linksVerifiedAt:string|null;linksSourceUrl:string|null;risk?:'冲'|'稳'|'保';medianRank?:number;variability?:number;confidence?:'高'|'低';programName?:string;years?:number[];disciplineRating?:string|null;isFeatured?:boolean;evidenceYears?:number;latestYear?:number }
export type ProfessionCard = { id:number;code:string;name:string;category:string;band:'优先了解'|'值得比较'|'谨慎报考';totalScore:number;evidenceCoverage:number;confidence:'低'|'中'|'高';schoolMatchStatus:'verified'|'group_only'|'unavailable';jobCount:number;provinceCount:number;sourceCount:number;factors:{coverage:ProfessionFactor;directEntry:ProfessionFactor;schoolAccess:ProfessionFactor;stability:ProfessionFactor};jobs:ProfessionJob[];schools:ProfessionSchool[] }
export type SavedItem = { itemType:'major'|'school';itemId:number;state:'saved'|'excluded'|'target';note?:string|null;itemName?:string|null }
export type AdmissionUnitCandidate={schoolId:number;schoolName:string;province:string;city:string;level:string;officialUrl:string;admissionsUrl:string;linksSourceUrl:string;unitId:number;unitName:string;unitType:'exact_major'|'major_group'|'school_line';subjectRequirement:string|null;referenceRank:number;risk:'冲'|'稳'|'保';confidence:'低'|'中'|'高';dataYears:number[];sourceUrl:string}
export type AdmissionEvidence={years:number[];unitType:'exact_major'|'major_group'|'school_line'|null;confidence:'低'|'中'|'高'|'无';recordCount:number;note:string}
export type ProfileSummary={studentName:string;planningMode:'exploration'|'application';province:string;subjectGroup:string;score:number;provinceRank:number|null}
export type ProfessionDashboard = { mode:'exploration'|'application';profileSummary:ProfileSummary;scoreSnapshots:ScoreSnapshot[];employment:{healthySources:number;lastSuccessAt:string|null;staleDays:number|null;usable:boolean;windowDays:number};schoolCandidates:AdmissionUnitCandidate[];admissionEvidence:AdmissionEvidence;cards:ProfessionCard[];savedItems:SavedItem[] }
export function getProfessionDashboard(profileId:string){return request<ProfessionDashboard>(`/api/profiles/${profileId}/profession-dashboard`)}
export function saveDashboardItem(profileId:string,item:SavedItem){return request<SavedItem>(`/api/profiles/${profileId}/saved-items`,{method:'PUT',body:JSON.stringify(item)})}
export function removeDashboardItem(profileId:string,itemType:'major'|'school',itemId:number){return request<{itemType:string;itemId:number}>(`/api/profiles/${profileId}/saved-items/${itemType}/${itemId}`,{method:'DELETE'})}
export function updateDashboardItemNote(profileId:string,itemType:'major'|'school',itemId:number,note:string|null){return request<{itemType:string;itemId:number;note:string|null}>(`/api/profiles/${profileId}/saved-items/${itemType}/${itemId}/note`,{method:'PATCH',body:JSON.stringify({note})})}
export function syncEmploymentIfStale(){return request<{triggered:false;reason:'manual-only'}>('/api/employment/sync-if-stale',{method:'POST'})}
