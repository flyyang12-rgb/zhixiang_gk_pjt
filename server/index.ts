import cors from 'cors'
import express from 'express'
import { ZodError } from 'zod'
import { config } from './config.js'
import { database } from './database.js'
import { profilesRouter } from './profiles.js'
import { preferencesRouter } from './preferences.js'
import { schoolsRouter } from './schools.js'
import { recommendationsRouter } from './recommendations.js'
import { advisorRouter } from './advisor.js'
import { reportsRouter } from './reports.js'
import { employmentRouter } from './employment.js'
import { professionDashboardRouter } from './profession-dashboard.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '100kb' }))
app.use((request, response, next) => {
  response.locals.requestId = crypto.randomUUID()
  response.setHeader('X-Request-Id', response.locals.requestId)
  next()
})

app.get('/api/health', async (_request, response, next) => {
  try {
    await database.query('SELECT 1')
    response.json({ success: true, data: { database: 'connected' }, error: null, requestId: response.locals.requestId })
  } catch (error) {
    next(error)
  }
})

app.use('/api/profiles', profilesRouter)
app.use('/api', preferencesRouter)
app.use('/api', schoolsRouter)
app.use('/api', recommendationsRouter)
app.use('/api', advisorRouter)
app.use('/api', reportsRouter)
app.use('/api', employmentRouter)
app.use('/api', professionDashboardRouter)

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const requestId = response.locals.requestId
  if (error instanceof ZodError) {
    response.status(422).json({ success: false, data: null, error: error.issues[0]?.message ?? '输入内容不正确', requestId })
    return
  }

  console.error(`[${requestId}]`, error instanceof Error ? error.message : 'Unknown error')
  response.status(500).json({ success: false, data: null, error: '服务暂时不可用，请稍后再试', requestId })
})

app.listen(config.PORT, () => {
  console.log(`知向 API 已启动：http://localhost:${config.PORT}`)
})
