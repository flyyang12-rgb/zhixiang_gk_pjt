# 知向 · 高考志愿推荐

一个以专业就业证据和专业组历史位次为核心的高考志愿规划工具。

## 本地运行

首次运行先复制 `.env.example` 为 `.env`，填写本机 MySQL 8 的账号密码，然后双击：

```powershell
setup-local.cmd
```

以后双击 `start-local.cmd`，浏览器访问 `http://localhost:5173`。本地开发不需要 Docker；需要在一台 Linux 服务器上私有试用时，可使用仓库内的 Docker Compose 配置。面向陌生用户正式开放前，仍须增加账号隔离、HTTPS、访问审计和加密备份。

顾问支持 DeepSeek 的 OpenAI 兼容接口。在 `.env` 中配置 `AI_BASE_URL=https://api.deepseek.com`、`AI_API_KEY` 和 `AI_MODEL=deepseek-v4-flash` 后生效；15 秒超时、限流或输出越界时自动回退到同样通俗的本地解释。API Key 只允许保存在 `.env`，不要写入前端代码或提交到版本库。

## Docker Compose 私有服务器部署

该方式在同一台 Linux 服务器上运行四个容器：Nginx 前端、Express API、一次性数据库初始化任务和 MySQL 8。宿主机只开放网站端口；API 与 MySQL 只在 Compose 内部网络可访问。MySQL 数据保存在命名卷 `zhixiang_mysql_data`，重建容器不会删除该卷。

服务器需要已安装 Docker Engine 与 Docker Compose v2。推荐使用独享的 2 核 4 GiB 实例；2 GiB 只能作为没有其他常驻服务的私有试用下限。Compose 已限制 MySQL、API 和 Nginx 的内存、进程数与日志大小，但在共享的小内存服务器上生成 PDF 或与 RabbitMQ 等服务并行运行仍可能进入 Swap 并显著变慢。不要再在宿主机安装 Node.js、Nginx 或 MySQL，也不要把 3000、3306 端口加入云安全组。

首次部署：

```bash
cd /home/doujiao/zhixiang_gk_pjt
cp .env.docker.example .env.docker
chmod 600 .env.docker
nano .env.docker
mkdir -p .deploy
chmod 700 .deploy
docker run --rm -i httpd:2.4-alpine htpasswd -niB zhixiang > .deploy/nginx.htpasswd
chmod 604 .deploy/nginx.htpasswd
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

`.env.docker` 中的 `DB_PASSWORD` 与 `MYSQL_ROOT_PASSWORD` 必须使用两个不同的长随机密码。`AI_API_KEY` 可以暂时留空。生成网页访问密码时，`htpasswd` 会交互式要求输入两遍密码；不要把密码写进命令或聊天记录。`.deploy` 目录保持 `700`，阻止宿主机其他普通用户进入；哈希文件使用 `604`，让容器内的非 root Nginx 工作进程能够只读校验密码。

首次启动会创建基础结构。随后按实际数据范围显式导入审核数据：

```bash
docker compose --env-file .env.docker run --rm db-init npm run data:schools
docker compose --env-file .env.docker run --rm db-init npm run data:school-links
docker compose --env-file .env.docker run --rm db-init npm run data:featured-majors
docker compose --env-file .env.docker run --rm db-init npm run data:major-outlook
docker compose --env-file .env.docker run --rm db-init npm run data:shandong
docker compose --env-file .env.docker run --rm db-init npm run data:henan
docker compose --env-file .env.docker run --rm db-init npm run data:henan-group-majors -- data/henan-group-majors.json
docker compose --env-file .env.docker run --rm db-init npm run data:hebei
docker compose --env-file .env.docker run --rm db-init npm run data:audit
```

检查状态与日志：

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=100 api
docker compose --env-file .env.docker logs --tail=100 web
docker compose --env-file .env.docker logs --tail=100 db
```

更新代码后重新构建；该操作保留数据库卷：

```bash
git pull --ff-only
docker compose --env-file .env.docker up -d --build
```

备份数据库：

```bash
mkdir -p backups
docker compose --env-file .env.docker exec -T db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction zhixiang' > backups/zhixiang-$(date +%F-%H%M%S).sql
chmod 600 backups/*.sql
```

恢复会覆盖同名记录，只能在确认备份文件和目标环境后执行：

```bash
docker compose --env-file .env.docker exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" zhixiang' < backups/要恢复的文件.sql
```

停止容器使用 `docker compose --env-file .env.docker down`。不要添加 `--volumes`，除非明确要永久删除 MySQL 数据。当前 Basic Auth 只适合少量受信任人员私有试用，不等于多用户账号隔离；正式公网运营仍属于后续安全建设范围。

## 当前能力

- 全国院校分布示意地图，支持按 985 / 211 / 一本 / 二本 / 专科筛选
- 学校搜索、分页列表与地图联动；点击学校在右侧查看属性、优势专业、本省招生记录和来源
- 省份、科类和选科录入；志愿填报模式支持分数与位次
- 目标探索与志愿填报双模式；目标探索无需分数和位次即可建档，后续形成规划位次会自动开启学校推荐，无需重建档案
- 从数据库已审核专业池展示最多 9 张专业卡片（每档最多 3 张），每专业最多 3 个经人工审核的就业方向
- 硬条件过滤后同时参考近期招聘、本科直接就业入口、可达院校、近期稳定性和带官方来源的未来发展证据；有效因子少于两个或证据覆盖低于 50% 时显示“暂不评分”，不把未知显示成 0
- 基于山东、河南、河北可比制度年份的学校/招生单元冲稳保（每档最多 2 所）；河南 2025 单年专业组的冲刺参考上限为位次比 1.15，统一标记低置信度，并与具体专业分层展示
- 专业收藏/排除、学校目标收藏均保存在本地
- 记录模考分数与全省位次轨迹；学校推荐使用最近最多 5 次有效位次的中位数，显示样本数和波动，并在专业卡直接预览可核验学校，不做高考趋势预测
- 收藏项可写家庭讨论备注，备注不会改变专业排序或冲稳保
- 选择 1—4 所学校可打开手机全屏“给爸妈看”简报并复制纯文本，不生成公网链接
- “我的收藏”可选择 2—4 所院校紧凑比较，并在卡片下方自动给出三行 AI 对比结论；AI 异常时回退本地规则分析
- 主流程收敛为“基础信息 → 专业与学校”，不设置测评或答题环节
- 专业和学校均提供三条本地证据解读，可将具体问题预填给规划顾问
- 从专业或学校详情进入顾问时只建立本地草稿并预填问题，第一次发送才保存；同一会话记住前文，刷新后可继续，并按当前历史会话返回对应详情
- 聊天记录分页展示类型、最后消息、消息数和更新时间，支持手机端查看、失败幂等重发和二次确认删除
- 网站启动时只读取已保存的最近 30 天招聘统计，不自动采集外部数据；只有本机管理员明确手动同步，来源不足或超过 7 天会停止就业排名
- AI 顾问用高中毕业生和不熟悉术语的父母也能听懂的短句回答；简单问题直接聊，不强套四段模板、不复读前文、不绕到无关专业，复杂比较才展开说明。可以批评错误选择但不攻击学生或家庭；不冒充任何真人
- 学校会话仍会逐轮理解问题：想学某专业时核对该校的具体专业证据；指出重复或答非所问时会承认并重新回答，不再重放学校模板
- AI 只解释本地规则结果；聊天保存在本机 MySQL，配置外部 AI 后只发送回答所需的最少上下文，不发送密码、Key 或无关学生信息
- 历史测评与家庭偏好仅作旧档案兼容保留，不参与当前推荐、顾问或 PDF
- 地图、顾问、学校详情和本地数据维护按需加载，首屏不下载 ECharts
- 一键导出 PDF 家庭讨论报告
- 本地 MySQL 8 数据库结构设计

## 项目文档

- `docs/SPEC.md`：经过领域术语统一的可执行需求规格
- `docs/REQUIREMENTS.md`：完整产品需求与验收场景
- `CONTEXT.md`：项目领域通用语言
- `docs/adr/`：关键架构决策记录

## 数据维护

```powershell
npm run data:schools   # 教育部全国高校名单
npm run data:school-links                       # 导入仓库内已核验的官网与招生官网
npm run data:school-links:auto -- --concurrency 12 # 自动发现并核验缺失链接，报告写入 .scratch
npm run data:featured-majors # 导入带认定类型、年份、发布方和官方来源的优势专业证据
npm run data:major-outlook # 导入带发布方、有效期和官方来源的专业未来发展证据
npm run data:employment-sources -- data/employment-sources.json # 导入已获许可的招聘源
npm run data:shandong # 山东 2023—2025 官方 XLS
npm run data:henan    # 河南 2023—2025；改革前年份单独标记，镜像来源显式披露
npm run data:henan-group-majors -- data/henan-group-majors.json # 导入经官方目录核验的专业组成员
npm run data:hebei    # 河北 2023—2025 投档 XLSX + 官方一分一档位次
npm run data:admissions -- data/admission-import.example.json # 生成任意批次标准 JSON 的预检批次
npm run data:admissions -- data/verified-batch.json --commit # 人工确认后事务提交
npm run data:admissions:rollback -- <batch-id> # 只回滚指定已提交批次
npm run data:audit # 生成 .scratch/data-completion/audit-report.json 审计快照
```

河南 2023 为已核验重点院校样本，2024 为考试院数据公开镜像，2025 为官方查询链接对应公开镜像；系统不会把改革前文理科与 2025 物理/历史类直接平均。河北 2023 投档表使用标注考试院来源的公开镜像，位次表仍来自考试院。上述限制会在数据状态、候选结果与 PDF 中披露；所有历史投档数据仅作分析，不构成录取承诺。

当前数据库并非“三省全部批次已经补齐”：现有正式记录集中在本科普通主批次，专科、提前批、专项、定向、征集，河南 2023/2024 完整数据和河南 2025 专业组成员仍按审计范围标记为待核验。`npm run data:audit` 是交付覆盖结论的唯一实时快照；只有状态为 `verified` 的具体范围可称为已核验，`pending` 不能按 0 或“已覆盖”处理。

通用招生导入格式见 `data/admission-import.example.json`。原始文件必须先保存在 `data/raw/<province>/<year>/`，导入器登记 SHA-256 和来源清单；院校只按正式名称或 `school_aliases` 中已核验别名匹配。默认命令只预检，必须人工查看逐行结果后添加 `--commit`。特殊资格批次即使提交成功也只供学校详情浏览，不参与冲稳保。

招聘源配置默认必须为 `enabled: false`。只有确认来源条款允许自动读取、无需登录或验证码且页面提供结构化 `JobPosting` 数据后，才可启用。系统不会绕过 412、登录、验证码或访问控制。学校链接输入格式参见 `data/school-links.example.json`；自动发现只把候选与核验报告写入 `.scratch/`，不会修改用户可见数据库。人工复核后将记录写入 `data/school-links.json`，再运行显式导入。优势专业格式参见 `data/featured-majors.example.json`；官方名称无法映射标准专业库时仍可用于学校事实展示，但不会进入专业推荐关系。招聘来源格式参见 `data/employment-sources.example.json`。

## 上线前检查

1. 招聘状态必须至少有 2 个健康来源，最后成功时间不超过 7 天。
2. 学校官网和招生官网只能导入经过来源核验的地址，不能根据校名猜域名。
3. 公网部署必须增加账号隔离、HTTPS、访问审计、删除机制和加密备份。
4. 推荐结果必须展示数据年份、来源与不确定性，并明确不构成录取承诺。
