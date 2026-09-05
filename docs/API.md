# 当前接口说明

核对日期：2026-09-05。本文描述仓库实际路由；产品要求以 [SPEC](SPEC.md) 为准。变更接口时同时更新本页、服务端、[前端客户端](../src/api.ts)及相关测试。

开发 API 默认在 `http://127.0.0.1:3000`，前端通过 Vite 的 `/api` 代理访问。以下路径均包含 `/api`。业务访问无登录与档案归属隔离。

## 响应与标识

常规 JSON 响应：

```json
{ "success": true, "data": {}, "error": null, "requestId": "请求标识" }
```

- 档案 ID、顾问会话 ID、客户端消息 ID 为 UUID；学校、专业、模考和消息 ID 为正整数。
- JSON 请求使用 `Content-Type: application/json`，全局请求体上限为 100 KB。
- 422 通常表示输入无效或缺少规划位次；404 表示目标不存在；403 用于本机维护限制；500 返回通用服务错误。
- PDF 成功返回 `application/pdf`，不是 JSON。下载失败先检查状态码与类型。
- 下文“旧接口差距”列出尚未统一的行为；客户端不能假定所有错误均可直接解析为 JSON。

## 基础数据

| 方法 | 路径 | 参数与用途 |
| --- | --- | --- |
| GET | `/api/health` | 检查数据库连接 |
| GET | `/api/schools` | `province`、`level`、`q` 可选；`page=1`、`pageSize=24`，最大 100；q 搜索校名或城市 |
| GET | `/api/schools/:id` | 可选 `profileId`；统一学校详情，无档案也可浏览基础信息 |
| GET | `/api/map/provinces` | 省份聚合及正式院校名单来源日期 |
| GET | `/api/admin/data-status` | 招生覆盖、年份和来源状态 |
| GET | `/api/admin/school-data-quality` | 学校事实覆盖及分页缺口，查询字段见 schools.ts 的 dataQualityQuerySchema |

学校搜索不支持独立的专业筛选参数。列表返回 items、分页和总数信息；前端不得用固定数量替代总数。

## 档案与模考

| 方法 | 路径 | 请求或返回 |
| --- | --- | --- |
| GET | `/api/profiles` | 返回最近更新的最多 50 份档案，当前没有分页参数 |
| POST | `/api/profiles` | 创建档案，字段见下方 |
| GET | `/api/profiles/:id` | 读取档案 |
| DELETE | `/api/profiles/:id` | 永久删除目标档案及关联记录 |
| PATCH | `/api/profiles/:id/rank` | `{ provinceRank: 正整数 }`，最大 2,000,000；同步当前模考位次 |
| GET | `/api/profiles/:id/score-snapshots` | 读取模考轨迹，当前返回数组、没有分页 |
| POST | `/api/profiles/:id/score-snapshots` | `examName`、`examDate`、`score`、`provinceRank`，可选 note |
| DELETE | `/api/profiles/:id/score-snapshots/:snapshotId` | 删除模考，必要时恢复上一条为当前坐标 |

创建字段：`studentName` 为 1—32 字，`province` 为河南/山东/河北，`subjectGroup` 为非空科类，`selectedSubjects` 为最多 3 个选科，`score` 为 100—750 的整数或 null，`provinceRank` 为正整数或 null，`planningMode` 为 exploration/application（默认 application）。application 不能缺分数；没有可靠位次时不能生成冲稳保。

模考名称最多 64 字，日期为 YYYY-MM-DD，分数为 100—750 整数，位次为正整数（最大 2,000,000）或 null，备注最多 200 字。新模考设为当前坐标。

没有通用的 `PATCH /api/profiles/:id`，也没有复制、重命名档案接口。

## 工作台、收藏与推荐

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/profiles/:id/profession-dashboard` | 专业卡、学校候选、规划位次、模考轨迹、profileSummary 与 savedItems |
| PUT | `/api/profiles/:id/saved-items` | `{ itemType, itemId, state, note? }` |
| PATCH | `/api/profiles/:id/saved-items/:itemType/:itemId/note` | `{ note: 字符串或null }`，清除备注用 null |
| DELETE | `/api/profiles/:id/saved-items/:itemType/:itemId` | 移除收藏/排除状态 |
| POST | `/api/profiles/:id/recommendations/generate` | 按当前规划位次重新生成并覆盖该档案最新推荐快照 |
| GET | `/api/profiles/:id/recommendations` | 已保存快照或 null |
| GET | `/api/profiles/:id/report.pdf` | 基础档案与已保存快照的 PDF |

itemType 为 major/school，state 为 saved/excluded/target，itemId 为正整数。note 最多 500 字；PUT 不传 note 时保留已有备注，传 null 时清除。备注不参与推荐规则。

`POST /api/profiles/:id/recommendations` 不是生成接口；必须带 `/generate`。家庭简报由前端根据学校详情与收藏生成，没有单独的公开分享接口。

## 顾问

| 方法 | 路径 | 参数 |
| --- | --- | --- |
| GET | `/api/profiles/:id/advisor/conversations` | page 默认 1、pageSize 默认 20，最大 50 |
| POST | `/api/profiles/:id/advisor/conversations` | `{ focus?, initialMessage, clientMessageId }`，首次发送并创建会话 |
| GET | `/api/profiles/:id/advisor/conversations/:conversationId/messages` | beforeId 可选；pageSize 默认 50，最大 50 |
| POST | `/api/profiles/:id/advisor/conversations/:conversationId/messages` | `{ message, clientMessageId }` |
| DELETE | `/api/profiles/:id/advisor/conversations/:conversationId` | 删除该档案内的目标会话 |
| POST | `/api/profiles/:id/advisor/comparison` | `{ schoolIds: [整数ID] }`，2—4 所且不重复，不写聊天历史 |
| GET | `/api/profiles/:id/advisor/messages` | 旧消息读取接口 |
| POST | `/api/profiles/:id/advisor/messages` | 旧发送入口，`{ message, focus? }`；新交互使用会话接口 |

focus 可省略；传入时为 `{ type: "school", schoolId }` 或 `{ type: "major", majorId }`。不要发送学校招生事实或自己构造来源。消息去掉首尾空白后为 2—2,000 字。重试同一次发送必须复用原 clientMessageId。

详情入口只建立前端草稿，用户首次发送时才调用创建会话接口。证据链接由服务端生成，AI 不得自编。回复的 mode 用来区分外部 AI 与本地解释，不代表事实核验等级。

## 就业与维护

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/employment/status` | 已保存就业统计及健康状态 |
| POST | `/api/employment/sync-if-stale` | 兼容空操作，固定返回 triggered=false、reason=manual-only |
| GET | `/api/admin/employment/sources` | 本机来源管理读取 |
| PUT | `/api/admin/employment/sources` | 本机来源元数据更新，字段见 employment.ts 的 sourceSchema；不能代替来源许可审核 |
| POST | `/api/admin/employment/sync` | 本机显式触发采集，启用来源前先审核许可 |

就业管理和同步路由检查请求来源是否为服务器 loopback 地址；远程请求会被拒绝。请在本机开发 API 上调用，不构造代理头规避限制。数据质量页面不提供上传入口。

招生导入使用 [维护指南](MAINTENANCE.md) 中的 JSON 脚本；没有 `/api/admin/imports`、commit 或 rollback HTTP 路由。

## 历史兼容与旧接口差距

- `GET /api/profiles/:id/preferences`、`PUT /api/profiles/:id/preferences` 仅保留历史兼容，不参与当前 UI、推荐、顾问和 PDF。测评题目接口已删除，请求应返回 404。
- GET profiles 只取前 50 条，模考轨迹未分页；这与“所有列表强制分页”的目标仍有差距，不能把上限写成完整分页能力。
- 推荐快照 GET 对未找到的档案/快照都可能返回 null，收藏 DELETE 对不存在项也可返回成功；尚未全部满足统一的档案存在校验要求。
- PDF 的部分 404 为纯文本；未匹配路由使用 Express 默认 404，未统一为 JSON。新路由仍必须遵守统一错误结构。
- 每日 AI/PDF 额度尚未实现，不能依赖一个不存在的额度查询或限额响应。
