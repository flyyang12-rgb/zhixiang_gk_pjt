# 现有服务器部署

本轮用户指定现有Linux服务器发布，不使用Vercel。运行架构为Nginx网页 → Express API → PostgreSQL；旧MySQL应用保留作回退。决定见[ADR0012](adr/0012-existing-server-postgres-release.md)。

## 目录与秘密配置

- 源码与发布目录独立于旧版，使用准确Git提交或经过验证的构建包。
- `deploy/server/compose.yaml`固定项目名`zhixiang-exploration`，不会操作旧`zhixiang`项目或其他服务。
- `POSTGRES_PASSWORD`在服务器生成并只保存在权限600的私密环境文件；使用URL安全随机字符。`RELEASE_ID`标识当前构建，`HTTP_PORT`默认18088且只绑定127.0.0.1。
- `API_BASE_IMAGE`、`WEB_BASE_IMAGE`可指定已核对的服务器缓存镜像；默认使用Playwright运行时和Nginx。构建前确认运行用户`pwuser`及浏览器/中文字体。所有外部AI变量仅在API运行时注入，不进入构建包。
- `.env`、`.env.docker`、备份、数据库导出、`.scratch`、测试报告、真实档案和聊天均不提交或上传GitHub。

## 首次发布流程

1. 检查旧版Git状态、容器、代理、端口与内存；记录当前应用提交。不要在旧MySQL目录直接拉main，不停止其他项目。
2. 将旧MySQL一致性备份与知向代理副本放在仓库外的服务器受控目录，目录700、文件600。核对备份完成与恢复路径，未备份不迁移。
3. 在开发机独立测试环境完成`npm test`、`npm run build`及`npm run test:e2e:exploration`。本轮宽/窄README预览与素材审计也须通过。
4. 将`dist`、`server-dist`、`vendor`、`package.json`、锁文件、schema及`deploy/server`打成明确白名单包，记录Git提交和文件散列；不把整个工作区打包。
5. 在新版独立目录配置私密环境；先启动新PostgreSQL，再构建API与Web：

   ```bash
   docker compose --env-file /path/to/private-release.env -f deploy/server/compose.yaml up -d db
   docker compose --env-file /path/to/private-release.env -f deploy/server/compose.yaml build api web
   ```

6. MySQL 驱动只装入专用迁移镜像：`docker build --build-arg API_BASE_IMAGE=zhixiang-api:latest --target migration -f deploy/server/Dockerfile -t zhixiang-exploration-migration:exploration-20260926 .`。日常 API 镜像只安装生产依赖。全新目标才可执行`deploy/server/migrate-legacy.mjs`。它限定旧容器`zhixiang-db-1`与新容器`zhixiang-exploration-db-1`，拒绝非空PostgreSQL目标，使用旧MySQL只读一致性快照和新PostgreSQL事务。连接仅从服务器私密环境注入，不通过CLI传密码。`--same-host-profiles`仅用于本次已授权的同服务器记录保留，不用于向远程服务上传旧档案。输出只有逐表数量和成功/失败阶段，不输出内容或SQL错误。
7. 核对逐表数量、外键、身份序列及空学习证据表。未审核候选不会被导入；不要为展示效果补造课程或把pending改verified。
8. 启动API/Web，先检查loopback18088：网页、`/api/health`、来源查询、新建准确测试档案、探索缺口、收藏备注、顾问本地降级和精确删除。PDF另核对真实运行环境，不以容器启动宣称通过。
9. 备份知向域名的原代理文件后，只将该域名 upstream 从旧端口切换到18088；`nginx -t`通过再reload。外网复验资源、接口、移动端和运行版本；失败恢复原代理，不删旧数据卷。

## 后续更新与回退

应用更新复用新版PostgreSQL卷，**不再运行首次MySQL迁移**。只部署验证过的新构建、核对新增迁移、重建API/Web并复验。结构变更先备份并使用幂等SQL；不得运行全库初始化覆盖已有记录。

代码回退可选择前一新版镜像。切回旧MySQL版时恢复原代理并reload，旧容器和卷仍在；新版期间产生的记录不会自动出现于旧MySQL，先备份并明确数据差异。禁止`docker compose down -v`或批量清理镜像/卷。

## 已知边界

内容审核与家庭走查仍待完成，首次上线可能只显示“资料待补充”。历史完整端到端套件与实际外部AI未验收；每日AI/PDF额度尚未实现。仅有HTTP入口时不能宣传HTTPS可用，应核对有效证书；不通过关闭TLS验证掩盖证书问题。

本轮提交、实际部署版本和验证结果在完成后记录于本页及[测试指南](TESTING.md)，不写密钥或真实档案内容。
