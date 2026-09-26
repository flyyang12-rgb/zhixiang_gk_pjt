import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const runId = process.env.EXPLORATION_UI_RUN_ID
assert.match(runId ?? '', /^[a-f0-9-]{36}$/)
const path = '.scratch/exploration-first/ui-web-runtime.json'
let stop
const stopping = new Promise(resolve => { stop = resolve })
const server = await createServer({
  configFile: false, envDir: false, plugins: [vue(), {
    name: 'isolated-exploration-shutdown',
    configureServer(instance) {
      // Register before Vite's final 404 middleware.
      instance.middlewares.use((request, response, next) => {
        if (request.url === '/__exploration-test/shutdown' && request.method === 'POST' && request.headers['x-test-run-id'] === runId) {
          response.statusCode = 202
          response.end('stopping'); stop(); return
        }
        next()
      })
    },
  }],
  server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3104' } },
})
try {
  await server.listen()
  await mkdir('.scratch/exploration-first', { recursive: true })
  await writeFile(path, JSON.stringify({ runId }))
  console.log('独立探索 UI 网页已启动')
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
  await stopping
} finally {
  await server.close()
  try {
    const runtime = JSON.parse(await readFile(path, 'utf8'))
    if (runtime.runId === runId) await unlink(path)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
