# 安装、配置与维护

日常操作见 [使用指南](USER_GUIDE.md)，开发约束见 [AGENTS.md](../AGENTS.md)。以下命令均从仓库根目录运行。

## 环境与配置

Windows 使用 Node.js 22.x（至少 22.12）及 npm。首次安装可用 setup-local.cmd；已有锁文件且需要复现依赖时用 `npm ci`。不要为了排错删除或改写锁文件。

| 变量 | 当前行为 |
| --- | --- |
| PORT | 默认 3000；改变后须同步 Vite API 代理及测试健康检查地址 |
| DATABASE_URL | 首选 PostgreSQL 连接串，只能在服务端配置 |
| POSTGRES_URL | DATABASE_URL 为空时的后备变量，可由托管集成提供；不会覆盖非空 DATABASE_URL |
| DATABASE_SSL | 默认 true；真实远程数据库保持启用 |
| DB_POOL_MAX | 默认 1，可接受 1—20；先排查连接未释放或嵌套获取，不靠扩大连接池掩盖问题 |
| AI_BASE_URL | OpenAI 兼容接口地址；不含密钥 |
| AI_API_KEY | 为空时使用本地顾问解释 |
| AI_MODEL | 按服务可用模型填写；.env.example 提供示例默认值 |
| DOTENV_CONFIG_PATH | dotenv 支持的配置文件路径；测试可指向 .env.test.local，程序不自动选择测试库 |

数据库变量都为空时，当前代码会回退本机开发地址，而不是自动连接正式 Supabase。不要依赖该回退。环境中已设置的变量优先于 dotenv 文件，修改文件后须重启 API。

从 Supabase 项目的 Connect 界面取得准确连接串，不猜测主机名。持续运行的本地服务可使用直连；IPv4 网络无法访问直连时使用 session pooler；Serverless 应用可使用 transaction pooler。迁移和备份使用官方适用的连接模式。来源：[Supabase 连接说明](https://supabase.com/docs/guides/database/connecting-to-postgres)。

连接串中的密码特殊字符需要 URL 编码。不要输出完整连接串排错，也不要把它放进截图、命令历史、前端变量或提交。测试配置和私密备份均不入库。

## 启动与更新

```powershell
npm ci
npx playwright install chromium
npm run dev
```

- 网页默认为 http://localhost:5173，API 为 http://localhost:3000。
- 首次安装 Chromium 后仍要单独准备 Google Chrome，端到端测试使用 Chrome 通道。
- 修改 .env 后，先在自己启动的服务窗口按 Ctrl+C，再重新启动；不结束不属于本任务的进程。
- 更新代码前检查本地修改，正常拉取并解决冲突，不通过重置覆盖用户文件。
- `npm run build` 检查类型并生成 dist 与 server-dist；`npm start` 只启动编译后的 API，不托管前端静态目录。单独运行 API 不等于网站部署完成。

检查数据库连接：

```powershell
curl.exe --noproxy "*" http://127.0.0.1:3000/api/health
```

## 空数据库与已有数据库

正式共享库已初始化。日常启动不要运行 db:init、批量导入、清空表或旧 MySQL 迁移。

只有已经确认目标是新的开发/测试库时，才配置该库连接并运行：

```powershell
npm run db:init
```

该命令执行 schema.sql 与 employment-seed.sql，不代表全国学校及三省招生数据已导入，也不是仅检查连通性的命令。初始化后按测试需求显式导入审核过的公共资料；不得复制真实档案、模考或聊天到测试输入。

旧公共数据迁移命令 `npm run data:migrate-public-from-mysql` 只用于已批准的一次性迁移，不是初始化或启动前提，不迁移学生档案和聊天。

## 数据维护入口与只读检查

- 浏览 http://localhost:5173/admin/data-quality 查看学校事实覆盖与缺口。维护页没有普通导航入口，也没有 CSV 上传功能。
- `GET /api/admin/data-status` 查看招生来源与年份，`GET /api/employment/status` 查看岗位样本状态。
- 运行下方命令生成覆盖审计快照：

```powershell
npm run data:audit
```

输出位于 .scratch/data-completion/audit-report.json。覆盖结论必须注明此次审计时间；verified 才能称为已核验，pending 不等于 0 条、不等于已覆盖。代码中出现 2023—2025 的处理分支，也不能证明数据库已完整导入。

## 官方资料导入

原始来源只读保留，记录采集日期、发布方、官方入口、必要镜像披露和校验值。禁止根据搜索摘要、组名或 AI 推测缺失招生事实。

| 命令 | 用途 |
| --- | --- |
| `npm run data:schools` | 教育部全国高校名单 |
| `npm run data:school-links` | 导入 data/school-links.json 中人工核验的官网与招生网 |
| `npm run data:school-links:auto -- --concurrency 12` | 发现候选，仅写 .scratch，不更新学校正式链接 |
| `npm run data:featured-majors` | 导入有官方认定依据的优势专业 |
| `npm run data:major-outlook` | 导入有来源、有效期的专业发展证据 |
| `npm run data:employment-sources -- data/employment-sources.json` | 导入已审核招聘来源配置 |
| `npm run data:shandong` | 山东专用招生导入 |
| `npm run data:henan` | 河南专用招生导入 |
| `npm run data:henan-group-majors -- data/henan-group-majors.json` | 官方专业组成员映射 |
| `npm run data:hebei` | 河北投档及一分一档数据 |

除学校链接自动发现外，上述导入可能直接写数据库。先检查脚本输入及目标库，不把下面通用导入的预检保护套用于所有命令。

输入格式参见 [学校链接示例](../data/school-links.example.json)、[优势专业示例](../data/featured-majors.example.json)、[就业来源示例](../data/employment-sources.example.json)。

### 通用招生 JSON：预检、提交、回滚

1. 将原始文件放在 data/raw/<province>/<year>/，根据 [标准格式](../data/admission-import.example.json) 制作 JSON。示例仅供格式参考，rawFile 必须指向真实可读文件。
2. 预检：

   ```powershell
   npm run data:admissions -- data/verified-batch.json
   ```

   预检会登记来源、原始文件、预检批次和审计状态，**不是完全不写库**；尚不提交正式招生记录。保存输出 batchId 并核对 raw、valid、duplicate、unmatched、rejected 及逐行结果，四类之和必须等于 raw。

3. 完成人工复核后显式提交：

   ```powershell
   npm run data:admissions -- data/verified-batch.json --commit
   ```

   这会重新生成预检并提交该次批次；以后需要回滚时使用这次输出中的已提交 batchId，不使用前一次仅预检的 ID。

4. 错误批次按准确 ID 回滚；将示例值替换为本次输出：

   ```powershell
   npm run data:admissions:rollback -- "实际已提交批次ID"
   ```

   先核对批次及后续导入关系，不把招生批次回滚当成全库恢复工具。

5. 再运行 data:audit，抽样核对原始文件、标准化输入、数据库及学校详情。不得为了让审计变绿而把 pending 改成 verified。

河南 2023 是重点院校样本，2024、2025 含官方来源的公开镜像；河北 2023 投档表含标明考试院来源的镜像。官方材料无法稳定获取时须披露限制。专科、特殊批次、河南改革前完整记录及专业组成员仍须按实际审计标记缺口。普通主批次、普通计划且有可靠位次才参与冲稳保，特殊资格批次只供浏览。

### 招聘数据

来源默认禁用。确认条款允许、无需登录或验证码、结构稳定后才启用；不绕过 412 或访问控制。经审核的本机维护操作可显式同步：

```powershell
curl.exe --noproxy "*" -X POST http://127.0.0.1:3000/api/admin/employment/sync
```

就业来源管理和同步仅允许 loopback 请求。旧 sync-if-stale 路由固定返回 manual-only，不会自动采集。少于两个健康来源、超过七天或质量异常时停止就业排名；其他有证据的功能可继续使用。

## 故障排查

| 现象 | 依次检查 |
| --- | --- |
| npm/node 不可用或安装报版本错误 | 检查 Node 版本及 PATH；PowerShell 阻止 npm.ps1 时可用 npm.cmd，不必关闭全局执行策略 |
| 页面打不开 | 启动窗口是否仍运行；打开的是 5173 网页端口而非 3000 API 端口 |
| 页面能开，保存/查询失败 | 先请求 /api/health；核对数据库配置来源、项目可达性、用户名与密码，不输出密钥 |
| 连错数据库 | 检查当前终端已有 DATABASE_URL/POSTGRES_URL、DOTENV_CONFIG_PATH 及旧进程；修改文件不会更新旧进程 |
| 端口占用或测试复用了旧服务 | 确认占用者，只停止自己启动的服务；默认测试会复用已有服务 |
| localhost 请求受代理影响 | 用 curl.exe --noproxy "*"；不要为本地诊断关闭全局代理或证书校验 |
| TLS 错误 | 使用正确的 Supabase 官方连接串与项目证书配置；不通过关闭全局 TLS 校验绕过问题 |
| PDF 失败/缺少浏览器 | 在运行 API 的同一环境安装 Chromium；Linux/托管环境还需核对浏览器依赖和中文字体 |
| 顾问使用本地解释 | 确认 Key、模型、地址已生效；15 秒超时或不合规输出也会触发回退 |
| 招聘排名消失 | 检查健康来源和更新时间；审核来源后手动同步，不填模拟样本 |
| 学校或专业数量少 | 看数据审计、选科、规划位次和招生粒度，不把缺口当系统必须补齐的数字 |

对外反馈错误时提供操作步骤、时间、状态码和 requestId；日志需脱敏，不贴原始连接串、聊天或学生档案。

## 备份与恢复

仓库没有自动全库备份或一键恢复脚本，导入批次回滚不包含学生档案恢复。维护者应先核对所用数据库的备份可用性，记录最近成功备份与恢复演练时间。

备份放在仓库外受控位置，不进入 data、日志或 Git。计划性结构迁移前先备份；恢复先在独立数据库验证表结构、关联约束及抽样数据。确认目标和恢复范围后再另行执行正式恢复，不能为了测试而覆盖共享库。不要从代码仓库恢复 .env 中的真实凭据。

## 部署交接边界

当前 vercel.json 配置 Vite 构建、dist 输出、sin1 区域和 /api 重写，api/index.ts 导出 Express。提交到 GitHub 不等于线上已经通过验收。

部署时核对：

1. Vercel 服务端环境变量指向正确数据库，预览环境不要自动写正式学生档案。
2. 构建成功，网页路由及 /api/health 可用，基础查询与测试档案创建/精确删除可用。
3. 在真实运行环境验证 PDF 浏览器、中文字体、下载与函数限制；仓库配置本身不能保证 PDF 可用。
4. 确认公开共享提示、官网来源、数据年份与缺口可见；招聘不可用时正常降级。
5. AI/PDF 各每日 200 次额度尚未实现；完整备份恢复、版本快照等差距见 SPEC，不对外宣称已有保护。
6. 保留对应 Git 提交及部署版本，回退前区分代码回退与数据库恢复。

本次维护文档不新增 Docker，不配置账号隔离，也不把部署或数据库变更隐含在普通文档提交中。
