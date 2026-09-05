---
status: superseded-in-part
---

> 运行形态与访问模型已由 [ADR 0010](0010-supabase-postgres-public-hosting.md) 取代。以下保留历史背景，不作为 MySQL、Docker 或私密档案的当前实现依据。


# 采用本地优先、可迁移公网的 Web 架构

MVP 使用 Vue 3 前端、Express 后端和本地 MySQL，而不是纯静态页面、桌面专用架构或 Docker。这样能在现有 Windows 与 MySQL 环境中一键运行，同时保持 API、数据访问和前端边界清晰，后续可直接将同一应用部署为普通用户通过网址访问的公网服务。

2026-08-07 补充：本地开发决策保持不变；Linux 私有服务器的可选 Docker Compose 部署由 ADR 0009 约束。
