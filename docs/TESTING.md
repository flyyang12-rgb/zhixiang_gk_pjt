# 测试与验证

测试规范见 [AGENTS.md](../AGENTS.md)，当前功能与待实现项见 [SPEC](SPEC.md)。

## 选择最贴近改动的检查

| 改动 | 验证 |
| --- | --- |
| 文档 | 核对文件链接、package.json 命令、API 路由、已实现状态；git diff --check |
| 规则、映射、来源判定、测试清理工具 | 相关 Vitest，再运行 npm test |
| Vue、TypeScript、后端/API | npm run build |
| 用户流程 | 相关 Playwright；完整产品交付再运行全部端到端测试 |
| 数据导入/结构 | 独立测试库中验证幂等、事务、约束和指定批次回滚 |

```powershell
npm test
npm run build
```

规划位次当前相关测试为 tests/family-companion.test.ts，可单独运行：

```powershell
npm test -- tests/family-companion.test.ts
```

Vitest 排除 tests/e2e，现有单元测试主要使用纯函数或数据库替身；新增测试不要在模块加载时连接或修改共享库。build 检查前端类型并编译前后端，不验证数据库数据完整性。

## 准备浏览器与数据库

Playwright 默认使用本机 Google Chrome，单 worker，网页端口 5173、API 端口 3000。PDF 另外使用 Playwright Chromium：

```powershell
npx playwright install chromium
```

端到端测试会创建、更新和删除测试档案；部分测试会请求顾问和 PDF。现有配置不会自动提供隔离数据库、固定事实快照或 AI 替身。

优先准备独立测试数据库，在仓库根目录创建不提交的 .env.test.local：

1. 复制 .env.example 到 .env.test.local，填写**测试库**连接。保留远程 TLS 设置；将 AI_API_KEY 留空可验证本地降级，不能据此声称外部 AI 已测试。
2. 先停止自己运行的本地开发服务，确认没有其他任务占用 3000/5173。Playwright 的 reuseExistingServer=true 会复用已有进程；切换配置文件不改变已有进程连接的数据库。
3. 在专用 PowerShell 窗口中清除可能覆盖文件的变量，再指定配置文件：

   ```powershell
   Remove-Item Env:DATABASE_URL, Env:POSTGRES_URL, Env:AI_API_KEY -ErrorAction SilentlyContinue
   $env:DOTENV_CONFIG_PATH = '.env.test.local'
   ```

4. 只在确认目标是独立空测试库时运行 db:init，再按维护指南导入所需公共测试资料。不要复制真实学生档案或聊天，也不要为测试重置共享库。
5. 运行测试；完成后关闭该专用窗口，避免把测试环境变量带入日常开发。

如果没有独立测试库，记录端到端测试未运行及原因。只有任务已明确允许在共享库创建测试档案时，才能执行相应流程；仍只使用合成数据和本次准确 ID 清理，不重建或批量删除现有数据。

## 运行与清理

```powershell
npm run test:e2e -- tests/e2e/profile-onboarding.spec.ts
npm run test:e2e
```

仅列出测试，不启动服务器、不写数据库：

```powershell
npm run test:e2e -- --list
```

清理规则：

- 档案名称带测试标记，成功创建后立刻记录响应中的准确 ID。
- 用 try/finally 或测试 fixture 清理本次 ID；UI 创建也要在收到成功响应时登记，避免断言中途失败后漏清理。
- 不遍历历史档案按前缀删除；相同前缀可能来自其他任务或以前运行。
- 已被当前测试主动删除的 ID 可接受 404；其他清理失败须报告，不静默当成成功。
- 测试异常终止可能留下合成档案；核对本次记录后再精确处理，不在下次启动时自动扫描旧档案。

onboarding 测试使用 fixtures/created-profiles.ts 记录本次创建响应；清理工具的单元测试覆盖重复、失败与准确 ID 范围。其他测试继续使用已有的 try/finally，并遵守同一范围。

## 已知验证限制

- 一些历史端到端测试仍写死“9 个专业”、学校数量、某批次记录数、健康来源数量或旧页面文案。它们依赖当时数据，不能在正式库上补造数据来让测试通过。
- 单元测试和构建成功不等于 PDF 在 Vercel 可用，也不等于实际外部 AI、所有省份和年份已验收。
- 测评 API 删除、无位次不推荐、历史偏好隔离、不同招生粒度、学校抽屉、收藏持久化和顾问预填仍是核心验收范围。
- 对已有失败记录命令、现象、关联性和未完成项。禁止把未执行、环境阻断或跳过计为通过。

## 交付记录

记录本次 Git 提交、实际执行命令、通过/失败/未运行数量和环境限制；有数据维护时附本次审计时间及来源。提交前检查暂存内容，排除 .env、测试配置、日志、浏览器报告、备份与真实数据。

纯文档交付无需运行会修改数据库的流程。若修改测试工具，可用离线测试验证其行为，再列出 Playwright 测试确认加载正常；完整应用流程留在独立测试环境验收。
