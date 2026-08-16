import { config } from './config.js'
import app from './app.js'

app.listen(config.PORT, () => {
  console.log(`知向 API 已启动：http://localhost:${config.PORT}`)
})
