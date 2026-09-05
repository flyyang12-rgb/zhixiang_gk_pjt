# 知向 · 高考志愿规划

知向帮助学生与家长根据可核验的招生和就业证据比较专业、学校。主流程只有“基础信息 → 专业与学校”，不提供测评或家庭偏好问卷，AI 只解释已有证据。

**这是公开共享工具。所有访客都能查看、修改和永久删除全部档案、收藏及顾问聊天。** 本地开发连接同一个数据库时，操作也会影响其他访客。只填写愿意公开的信息。

## 先看哪份文档

| 你要做什么 | 文档 |
| --- | --- |
| 第一次安装、启动 | 本页下方 |
| 建档、记录模考、比较收藏、问顾问、导出报告 | [使用指南](docs/USER_GUIDE.md) |
| 配置数据库、更新数据、排查故障、备份与部署 | [维护指南](docs/MAINTENANCE.md) |
| 运行测试并清理本次测试档案 | [测试指南](docs/TESTING.md) |
| 接入或修改接口 | [接口说明](docs/API.md) |
| 了解产品规则、已实现与待实现内容 | [SPEC](docs/SPEC.md)、[需求与验收](docs/REQUIREMENTS.md) |
| 让 Agent 开发与交付 | [AGENTS.md](AGENTS.md)、[领域术语](CONTEXT.md)、[架构决策](docs/adr/) |

## 首次安装（Windows）

前置条件：Node.js 22.x（至少 22.12）及 npm、可访问的 Supabase PostgreSQL 连接。当前 Vite 的 Node 支持范围为 `^20.19.0 || >=22.12.0`。运行端到端测试还需要 Google Chrome；普通访问可用常见浏览器。

1. 在项目根目录打开 PowerShell，确认工具可用：

   ```powershell
   node --version
   npm --version
   ```

2. 首次复制配置；已有 `.env` 时直接编辑，避免覆盖：

   ```powershell
   Copy-Item .env.example .env
   ```

   将 `DATABASE_URL` 替换为维护者提供的连接串。保持 `DATABASE_SSL=true`、`DB_POOL_MAX=1`。不要提交真实配置，不要给服务端变量加 `VITE_` 前缀。

3. 双击 `setup-local.cmd`，或在 PowerShell 运行：

   ```powershell
   .\setup-local.cmd
   npx playwright install chromium
   ```

   安装脚本只安装依赖并检查 `.env` 是否存在；不会测试数据库连接。第二条命令安装服务端导出 PDF 所需的浏览器。缺少它时，网页可能正常但 PDF 生成失败。

4. 双击 `start-local.cmd`，或运行：

   ```powershell
   npm run dev
   ```

   打开 [本地网站](http://localhost:5173)。保持启动窗口运行；停止时在该窗口按 Ctrl+C。

5. 检查 API 与数据库是否连通：

   ```powershell
   curl.exe --noproxy "*" http://127.0.0.1:3000/api/health
   ```

   正常响应包含 `success: true` 和 `database: "connected"`。失败按维护指南排查，不要重复初始化数据库。

已有正式库的日常使用无需 `db:init` 或重新导入数据。只有新建空的开发/测试数据库时，按维护指南显式初始化。

## 可选：启用外部 AI

在 `.env` 中填写维护者确认可用的 OpenAI 兼容配置：

```dotenv
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=
AI_MODEL=deepseek-v4-flash
```

模型名需与所用服务实际可用模型一致。修改后重启 API。未配置 Key，或请求超时、限流、输出不合规时，顾问使用本地解释；这不影响查看学校与专业证据。配置外部 AI 后，会向该服务发送回答所需的最少档案与会话上下文。

## 当前能力与限制

- 没有分数、位次时可选择“目标探索”；后续记录可靠全省位次，会自动开启学校冲稳保，无需重建档案。
- 规划位次使用最近最多 5 次有效全省位次的中位数；专业每档最多 3 个，学校冲稳保每档最多 2 所，证据不足时少展示。
- 地图、工作台和收藏统一打开学校详情抽屉；收藏支持备注、2—4 校比较和 1—4 校“给爸妈看”简报。
- 顾问入口只预填问题，第一次发送才保存会话；学校、专业、招生和就业事实每轮从当前库读取。
- 全国院校名单及部分山东、河南、河北 2023—2025 招生数据可用，不能理解为三省全部年份、科类和批次完整覆盖。镜像来源与缺失范围须披露。
- 招聘数据仅由维护者手动更新。健康来源少于 2 个、超过 7 天或质量异常时停止就业排名，仍可浏览其他证据。
- PDF 读取基础档案和已保存候选快照，不自动更新候选，也不包含完整收藏备注；没有快照时不能得到完整候选报告。
- 档案复制/重命名、候选手动排序、完整历史版本、AI/PDF 每日额度尚未实现，详见 SPEC 状态表。

所有结果仅用于分析与家庭讨论，不构成录取、就业、收入或升学承诺。

## 开发与交付

```powershell
npm test
npm run build
```

浏览器测试另运行 `npm run test:e2e`，会写数据库；先完成 [测试环境准备](docs/TESTING.md)。

前端为 Vue 3 + Vite，后端为 Express + TypeScript，服务端通过 `pg` 访问 Supabase。仓库已有 Vercel 入口与路由配置；部署状态及 PDF 运行环境需独立验收。旧 MySQL/Docker 运行方式已经退役。数据导入、回滚和上线检查统一见维护指南。
