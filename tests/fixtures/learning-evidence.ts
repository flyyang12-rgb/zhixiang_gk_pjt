import type { LearningEvidence } from '../../server/learning-evidence-contract.js'

// Synthetic material only. These URLs, reviewer and hashes are not evidence and
// must never be copied to data/ or imported as formal content.
export const evidenceNow = new Date('2026-09-26T00:00:00Z')
export function learningEvidenceFixture(overrides: Partial<LearningEvidence> = {}): LearningEvidence {
  return {
    id: '10000000-0000-4000-8000-000000000001', factKey: 'test-curriculum', majorId: 1,
    kind: 'curriculum', content: '合成测试课程，不是正式专业事实',
    source: { id: 1, artifactId: '20000000-0000-4000-8000-000000000001',
      title: '合成测试材料', url: 'https://test.example.edu/plan#curriculum', year: 2025,
      publisher: '合成测试学校', publisherType: 'university', sha256: 'a'.repeat(64),
      collectedAt: '2026-09-20T00:00:00Z' },
    locator: { kind: 'section', value: '合成课程章节' },
    scope: { level: 'school', schoolId: 1, province: null, subjectGroup: null, admissionYear: null },
    review: { status: 'verified', reviewer: '合成测试审核人', reviewedAt: '2026-09-21T00:00:00Z',
      conclusion: 'verified', reason: '合成测试审核记录；不代表人工审核了真实事实' },
    batch: { id: '30000000-0000-4000-8000-000000000001', checksum: 'b'.repeat(64), status: 'active' },
    validUntil: null, jobDirectionId: null, careerMappingStatus: null, condition: null,
    ...overrides,
  }
}

export function admissionEvidenceFixture(overrides: Partial<LearningEvidence> = {}) {
  return learningEvidenceFixture({ kind: 'admission_requirement',
    scope: { level: 'major', schoolId: null, province: '河南', subjectGroup: '物理类', admissionYear: 2026 },
    condition: { type: 'subjects', mode: 'all', subjects: ['物理', '化学'] }, ...overrides })
}
