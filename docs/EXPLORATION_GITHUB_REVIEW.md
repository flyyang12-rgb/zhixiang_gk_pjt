# 无位次专业探索：GitHub 项目核验与对照

日期：2026-09-26。本报告记录第一轮对照（当时 PRD 0.3）；当前规则看 [SPEC](SPEC.md)、[探索 PRD](EXPLORATION_PRD.md) 和 [实施任务](EXPLORATION_TASKS.md)。后续 [逐条精细审查](EXPLORATION_ALIGNMENT.md) 检查 58 条功能要求并修订至 0.4，具体差异以该审查为准。

## 1. 结论

继续“了解学习内容与职业路径 → 自主收藏 → 比较 → 保存家庭讨论”的方向。公开项目提供了可检查的目录、事实引用、课程条件和资料更新机制；本轮未找到已经验证中国高考家庭完整探索闭环、可以直接替代知向的项目。

对我们是否适用的判断是：这条流程与已经选定的无可靠位次场景一致，实现方法有外部源码可参考。它的使用效果、两步流程是否容易理解、家庭能否从资料说出专业区别，仍需真实材料和学生/家长走查。GitHub 仓库存在、测试通过和 Star 数都不能证明“最优”。

本轮细化四项要求：逐事实定位与人工审核；分开学习条件和招生资格；资料变更不丢收藏；各入口共用当前有效证据。继续现有 Vue/Express/PostgreSQL 技术栈，首期不增加大型路径图、毕业学分规划或问卷评分。

第二轮发现的限制：Career Tree 目录包含全部 4 个标记 needs_review 的节点，事实 URL 规范化会删除锚点；SUrriculum 的目录加载器可从指定学期回退无学期文件，不能当作已经验证范围隔离；WPI 对有效 0 值也会走随机补分。上述机制均须按知向规则重新实现相应边界，不能从本报告的“可参考”推导为需求已对齐。

## 2. 核验方法与范围

- 搜索公开 GitHub 仓库，选择职业路径、大学课程要求和中国高考三类相邻项目。
- 克隆四个仓库的浅副本，固定实际 HEAD，读对应源码及数据，不将 README 的功能清单当成已经运行的证据。
- 对可独立执行的机制运行有限验证；没有运行的构建、网站和完整测试明确列出。
- 参考副本、审阅脚本和示例输出位于本工作区 `.scratch/github-comparison/`，不随仓库提交。来源链接固定到提交，可以在另一工作区重新核对。
- 本轮没有运行知向的业务验收；没有访问或修改真实学生数据，也没有将外部专业资料导入正式数据库。

| 项目 | 固定提交 / 提交日期（UTC） | 实际场景 | 对我们的参考范围 |
| --- | --- | --- | --- |
| [Career Tree](https://github.com/mhardik003/career-tree/tree/e3fdfcc635e4478411a09db144296eb15eeb1893) | e3fdfcc / 2026-08-12 | 印度教育与职业路径浏览 | 目录、稳定身份、分节事实和来源；较接近探索资料组织 |
| [SUrriculum](https://github.com/BEFICENT/surriculum/tree/98033f8f6539f1b492b064c16228bfa71b3ffe19) | 98033f8 / 2026-09-25 | Sabancı 大学课程和毕业要求规划 | 学校/项目/入学学期范围、条件解析与未知状态 |
| [WPI Roadmap](https://github.com/WPI-Roadmap/client-side/tree/b4b5f1297d6b49febd68688ae48f8b7dba909ec4) | b4b5f12 / 2024-01-15 | WPI 学生课程图与专业要求 | 学习结构表达；原型限制较多 |
| [gaokao-adi](https://github.com/xiapuyang/gaokao-adi/tree/1ceb984233a97fb564c46d1aed59e8d484ce2b33) | 1ceb984 / 2026-06-27 | 中国高考专业测评与评分报告 | 检查相邻方案为何与本期边界冲突 |

四个项目的制度、用户阶段和事实来源不同。表中“参考”是本次代码对照判断，未宣称其经过知向用户验证。

## 3. 逐项目观察

### Career Tree：资料浏览机制可参考，事实审核需要另外证明

- [目录组件](https://github.com/mhardik003/career-tree/blob/e3fdfcc635e4478411a09db144296eb15eeb1893/career-tree/components/v2/CareerDirectory.tsx#L14) 实际按名称/别名搜索、按类型筛选，以稳定节点 ID 进入详情。显示结果最多 100 条，超出后要求收窄搜索，没有知向所需的服务端分页。
- [事实模型](https://github.com/mhardik003/career-tree/blob/e3fdfcc635e4478411a09db144296eb15eeb1893/pipeline/facts.py#L69) 要求单条简要事实、章节分别附来源；[事实组件](https://github.com/mhardik003/career-tree/blob/e3fdfcc635e4478411a09db144296eb15eeb1893/career-tree/components/v2/NodeFacts.tsx) 展示逐项链接和资料日期。比只在页面底部挂官网链接更容易追溯。
- [导出脚本](https://github.com/mhardik003/career-tree/blob/e3fdfcc635e4478411a09db144296eb15eeb1893/pipeline/export_frontend.py#L25) 计算源内容摘要并稳定导出；[读取模块](https://github.com/mhardik003/career-tree/blob/e3fdfcc635e4478411a09db144296eb15eeb1893/career-tree/lib/v2/data.ts) 读取已提交的快照。说明资料浏览可以与运行时 AI 分开。
- [资料生成脚本](https://github.com/mhardik003/career-tree/blob/e3fdfcc635e4478411a09db144296eb15eeb1893/pipeline/enrich.py#L89) 将模型返回的结构化资料写入节点。[发布检查](https://github.com/mhardik003/career-tree/blob/e3fdfcc635e4478411a09db144296eb15eeb1893/pipeline/lint.py#L45) 检查引用和结构，本轮没有验证它能证明每个摘要的事实含义及人工批准。

**适用于知向：**逐事实引用、稳定专业 ID、有效材料共用读取。知向审核必须核对原材料位置、学校及年份；来源链接和模型记录不等同审核通过。印度资料不能作为中国专业或招生事实。

### SUrriculum：范围与未知状态比图形表现更值得参考

- [使用说明](https://github.com/BEFICENT/surriculum/blob/98033f8f6539f1b492b064c16228bfa71b3ffe19/README.md#L65) 将主修、辅修和双专业要求关联各自的入学/适用学期；[项目上下文](https://github.com/BEFICENT/surriculum/blob/98033f8f6539f1b492b064c16228bfa71b3ffe19/scripts/app/program_context.js#L438) 加载指定专业与学期的材料，而不是把一套要求套给所有学生。
- [先修条件策略](https://github.com/BEFICENT/surriculum/blob/98033f8f6539f1b492b064c16228bfa71b3ffe19/scripts/requisites/expression-policy.js) 解析 AND/OR、最低成绩和可同时修读等条件；[协调逻辑](https://github.com/BEFICENT/surriculum/blob/98033f8f6539f1b492b064c16228bfa71b3ffe19/scripts/course_requisites.js#L176) 明确保留 unknown、met、unmet 及原因。
- 部分缺失课程条件允许继续规划，这是该产品自己的学习规划策略。知向可允许继续浏览，同时必须保持“报考资格待核验”，不能把 unknown 解释成“不限”或“可报”。

**适用于知向：**学校/年份范围、条件类型、未知原因。大学课程先修与高考选科资格是不同事实；不能把“学这门课需要某知识”转换成招生硬限制。毕业进度、排课、成绩单导入不属于知向首期。

### WPI Roadmap：有真实图形实现，也有不能接受的补值

- [Flow.js](https://github.com/WPI-Roadmap/client-side/blob/b4b5f1297d6b49febd68688ae48f8b7dba909ec4/src/components/Dashboard/Flow.js) 用 React Flow 与 ELK 实现课程节点布局；[专业要求组件](https://github.com/WPI-Roadmap/client-side/blob/b4b5f1297d6b49febd68688ae48f8b7dba909ec4/src/components/Dashboard/Requirements/Requirements.js#L52) 有具体的计算机课程分组规则。
- [评分取值](https://github.com/WPI-Roadmap/client-side/blob/b4b5f1297d6b49febd68688ae48f8b7dba909ec4/src/components/Dashboard/Flow.js#L53) 和 [课程卡片](https://github.com/WPI-Roadmap/client-side/blob/b4b5f1297d6b49febd68688ae48f8b7dba909ec4/src/components/DataParse/ClassCard.js#L34) 在找不到课程/教师评分时使用随机数。该代码不能作为可靠性范例。
- [README](https://github.com/WPI-Roadmap/client-side/blob/b4b5f1297d6b49febd68688ae48f8b7dba909ec4/README.md) 说明项目来自 2024 黑客松，LLM 推荐仍在待做清单，完整生产发布仍有工作要完成。

**适用于知向：**可以用学习结构帮助解释专业。先使用已有详情的课程/活动条目；大型图形是否更容易理解需要单独验证。知向保留未知，不能补随机分、默认分或借色彩暗示适合度。

### gaokao-adi：工程可运行，产品规则与我们不同

- [评分引擎](https://github.com/xiapuyang/gaokao-adi/blob/1ceb984233a97fb564c46d1aed59e8d484ce2b33/scripts/score_engine.py) 从专业基线、问答与用户条件计算个人分数、档位和排序；[入口](https://github.com/xiapuyang/gaokao-adi/blob/1ceb984233a97fb564c46d1aed59e8d484ce2b33/scripts/run_assessment.py) 可从 JSON 生成 Markdown/HTML 报告。
- [README](https://github.com/xiapuyang/gaokao-adi/blob/1ceb984233a97fb564c46d1aed59e8d484ce2b33/README.md) 明确说算法为反推复刻；[专业数据](https://github.com/xiapuyang/gaokao-adi/blob/1ceb984233a97fb564c46d1aed59e8d484ce2b33/references/majors_admission_2024.json#L1) 使用通用选科口径、经验数据和估计权重，不能据此核验知向的逐省、逐校、逐年招生资格。

**适用于知向：**确定性报告可以不依赖运行时 AI；现有知向简报纯函数即可承接。其问卷、个人评分、主观排序和专业参数不进入我们的探索方案。

## 4. 对照已定需求

| 知向需求 | 本轮得到的证据 | 判断与行动 |
| --- | --- | --- |
| E01 无成绩建档、两步入口 | 外部项目用户阶段不同，没有核验知向建档流程 | 保持原设计，靠 S01 实际验证 |
| E02 无评分目录与搜索 | Career Tree 有可搜索目录和 ID 详情 | 支持该机制可实现；知向仍做服务端分页，保持确定顺序 |
| E03 课程、活动、职业路径与来源 | Career Tree 分节引用；SUrriculum 按学期管理课程条件 | 加事实定位、人工审核和条件类型；保留学校实例范围 |
| E04 两三个专业并排比较 | 本轮未验证到可直接覆盖此需求的实现 | 保持确定性比较；必须用两个真实专业走查，不能靠参考项目宣称有效 |
| E05 收藏与家庭备注 | Career Tree 稳定节点身份可参考；家庭备注闭环未核验 | 保持现有收藏表，补改名/撤回资料的回归 |
| E06 可复制探索简报 | gaokao-adi 示例证明确定性渲染可执行，报告含义与我们不同 | 复用知向简报逻辑，只展示证据、未知与备注 |
| E07 可选顾问解释 | Career Tree 浏览用已提交数据；WPI 的 LLM 推荐未完成 | 资料与顾问分开，当前有效证据每轮读取，本地解释保持可用 |
| E08 获得位次后开启招生比较 | 外部课程/职业项目未验证中国制度；ADI 数据为通用口径 | 沿用知向已有制度与位次规则，做独立回归 |

## 5. 已纳入实施票的四项细化

| 细化 | 为什么需要 | 需求 / 任务 | 具体验收 |
| --- | --- | --- | --- |
| 事实 → 材料 → 页码/章节，登记核验人及结论 | 引用结构只能检查有链接，不能证明摘要正确 | E03；01/02/04/05 | 从比较中的事实能定位原文；AI 生成记录不冒充人工审核 |
| 学习知识、课程先修、招生资格、职业准入分开 | 不同条件的制度和范围不同 | E02/E03；01/03/04/06 | S05 中课程知识要求不触发高考资格过滤 |
| 名称修订保持 ID，撤回材料保留收藏备注 | 浏览名称和材料会变化，家庭记录不能跟着消失 | E05；01/03/04/07 | S07 改名与撤回后仍找回原记录，失效事实显示缺口 |
| 内容批次、源校验值和统一读取 | 多个入口各自读旧资料会产生互相矛盾的回答 | E03/E06/E07；01/02/03/05/06/07 | S09 更新资料后详情、简报与当轮顾问使用同一有效材料标识 |

内容标识用于当前来源追踪和一致性检查。完整历史快照、历史浏览及可复现推荐仍按 SPEC 的既有待实现事项管理，不在这次细化中扩建。

## 6. 本次实际验证结果

| 项目 | 执行内容 | 结果 | 没有证明的事项 |
| --- | --- | --- | --- |
| Career Tree | 自编只读脚本检查 registry ID、边引用、facts 和来源列表 | 677 个唯一节点、1,505 条边，无悬空引用；677 节点有 facts，7,010 条事实/章节均有来源列表；677 条 facts 记录模型信息，4 节点标记 needs_review | 没有执行上游完整 lint/build/tests、核验所有来源网页或每条事实含义；needs_review 也不是统一的人工审核凭证 |
| SUrriculum | 上游条件策略与项目上下文两个测试文件 | 7 项通过，0 失败，0 跳过 | 没有运行全套测试、网站或当前大学规则核验；不证明适用于中国高考 |
| WPI Roadmap | 源码核对 | 课程图形与随机补分路径存在 | 未运行依赖安装、构建、UI 或远端 API，不能宣称生产可用 |
| gaokao-adi | 自带 `examples/adi_input.json` 的公开示例，经 run() 生成 Markdown/HTML | 两种文件生成成功 | 没有执行全套测试；报告生成不证明模型或专业参数正确 |

复核命令（参考副本须固定到上述提交；均无需外部 AI Key）：

```powershell
# 当前知向工作区；自编脚本只核对结构，未检查事实真伪
python .scratch/github-comparison/verify_samples.py career-tree
python .scratch/github-comparison/verify_samples.py gaokao-adi

# 在 SUrriculum 参考副本中执行；没有安装项目依赖
node --test tests/unit/course-requisite-expression-policy.test.js tests/unit/program-context.test.js
```

许可证文件分别为 [Career Tree MIT](https://github.com/mhardik003/career-tree/blob/e3fdfcc635e4478411a09db144296eb15eeb1893/LICENSE)、[SUrriculum GPL-3.0](https://github.com/BEFICENT/surriculum/blob/98033f8f6539f1b492b064c16228bfa71b3ffe19/LICENSE)、[gaokao-adi MIT](https://github.com/xiapuyang/gaokao-adi/blob/1ceb984233a97fb564c46d1aed59e8d484ce2b33/LICENSE)。WPI client-side 未找到本仓库许可文件，README 徽章链接到别的项目。本轮仅分析实现方法，没有复制外部实现代码到产品。

## 7. 接下来怎样验证是否适合我们

1. 完成任务 01 的证据契约，保证范围、条件类型和逐事实来源都能表达。
2. 任务 02 审核两个真实专业；任务 03 可在契约确定后并行实现目录与详情。先用这两个条目验证比较字段，资料缺口直接保留。
3. 任务 04/05 接通收藏、备注、比较和简报，用无 AI、无位次场景完成探索闭环。
4. 任务 07 观察学生与家长是否能说出有来源的差别、一个未知项，并重新找回讨论记录。未得到这些结果，继续修资料和流程，不能通过增加功能数量宣布成功。

当前业务实施仍未开始。本报告完成的是外部源码核验和需求细化，不是产品上线验收。
