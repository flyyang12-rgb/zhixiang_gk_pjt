import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default('zhixiang'),
  DB_USER: z.string().default('zhixiang_app'),
  DB_PASSWORD: z.string().min(1, '请在 .env 中配置 DB_PASSWORD'),
  AI_BASE_URL: z.string().optional().default(''),
  AI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default(''),
})

export const config = envSchema.parse(process.env)
