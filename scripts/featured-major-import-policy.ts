import { z } from 'zod'

const schema=z.object({
  schoolName:z.string().trim().min(2).max(128),
  majorName:z.string().trim().min(2).max(128),
  majorCode:z.string().trim().max(16).optional().nullable(),
  educationLevel:z.enum(['本科','高职']),
  recognitionType:z.string().trim().min(4).max(128),
  recognitionYear:z.number().int().min(1990).max(new Date().getFullYear()).optional().nullable(),
  sourceYear:z.number().int().min(1990).max(new Date().getFullYear()),
  sourceUrl:z.string().url().refine(value=>new URL(value).protocol==='https:',{message:'优势专业来源必须使用 HTTPS'}),
  publisher:z.string().trim().min(2).max(128),
  verifiedAt:z.string().datetime(),
})
export type FeaturedMajorInput=z.input<typeof schema>
export type PreparedFeaturedMajor=z.output<typeof schema>&{businessKey:string}

export function prepareFeaturedMajorRecord(input:FeaturedMajorInput):PreparedFeaturedMajor{
  const record=schema.parse(input)
  return {...record,businessKey:[record.schoolName,record.majorName,record.recognitionType,record.recognitionYear??`source-${record.sourceYear}`].join('\u0000')}
}
