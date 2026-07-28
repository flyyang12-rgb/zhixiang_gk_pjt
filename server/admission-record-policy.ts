import { createHash } from 'node:crypto'

export type AdmissionUnitType = 'exact_major' | 'major_group' | 'school_line'
export type EducationLevel = '本科' | '专科'

export type AdmissionRecordIdentity = {
  schoolId: number
  provinceId: number
  year: number
  subjectGroup: string
  educationLevel: EducationLevel
  admissionCategory: string
  batch: string
  planType: string
  unitType: AdmissionUnitType
  unitCode?: string | null
  rawUnitName: string
}

const mainBatchPatterns = [
  /^普通本科批$/,
  /^本科批$/,
  /^本科一批$/,
  /^普通高职（专科）批$/,
  /^普通专科批$/,
  /^专科批$/,
  /^常规批第1次$/,
]

export function buildAdmissionRecordKey(input: AdmissionRecordIdentity) {
  const identity = [
    input.schoolId,
    input.provinceId,
    input.year,
    normalize(input.subjectGroup),
    input.educationLevel,
    normalize(input.admissionCategory),
    normalize(input.batch),
    normalize(input.planType),
    input.unitType,
    normalize(input.unitCode ?? ''),
    normalize(input.rawUnitName),
  ].join('\u0000')
  return createHash('sha256').update(identity).digest('hex')
}

export function recommendationEligibility(input: { admissionCategory: string; batch: string; planType: string; minRank: number | null | undefined }) {
  if (!Number.isFinite(input.minRank) || Number(input.minRank) <= 0) return { eligible: false, reason: '缺少可靠最低位次' } as const
  if (normalize(input.admissionCategory) !== '普通类') return { eligible: false, reason: '非普通类记录仅供浏览' } as const
  if (!/^普通计划$/.test(normalize(input.planType))) return { eligible: false, reason: '资格计划仅供浏览' } as const
  if (!mainBatchPatterns.some(pattern => pattern.test(normalize(input.batch)))) return { eligible: false, reason: '特殊批次仅供浏览' } as const
  return { eligible: true, reason: null } as const
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, '').replace(/[()]/g, character => character === '(' ? '（' : '）')
}
