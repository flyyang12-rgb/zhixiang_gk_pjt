import { readFile } from 'node:fs/promises'

export default async function teardown() {
  const results = await Promise.allSettled([
    stopOwnedService('.scratch/exploration-first/ui-test-runtime.json', 3104),
    stopOwnedService('.scratch/exploration-first/ui-web-runtime.json', 5174),
  ])
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
  if (failures.length) throw new AggregateError(failures, '本次独立测试环境清理失败')
}

async function stopOwnedService(path, port) {
  let runtime
  try { runtime = JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  if (runtime.runId !== process.env.EXPLORATION_UI_RUN_ID) throw new Error('测试运行身份不同，拒绝关闭其他服务')
  const response = await fetch(`http://127.0.0.1:${port}/__exploration-test/shutdown`, {
    method: 'POST', headers: { 'x-test-run-id': runtime.runId }, signal: AbortSignal.timeout(5000),
  })
  if (!response.ok || await response.text() !== 'stopping') throw new Error('独立测试服务关闭失败')
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await readFile(path) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('独立测试库清理未完成，须核对本次运行身份')
}
