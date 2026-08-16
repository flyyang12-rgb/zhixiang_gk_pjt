import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/zhixiang'),
  DATABASE_SSL: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(1),
  AI_BASE_URL: z.string().optional().default(''),
  AI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default(''),
})

export const config = envSchema.parse(process.env)
