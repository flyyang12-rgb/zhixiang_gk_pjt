# Issue tracker: Local Markdown

本仓库没有 Git 远程 Issue Tracker。规格与任务使用本地 Markdown，保存在 `.scratch/`。

## Conventions

- 每项功能一个目录：`.scratch/<feature-slug>/`。
- 可选规格文件：`.scratch/<feature-slug>/spec.md`。
- 实现票据必须一票一文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，按依赖顺序从 `01` 编号。
- 每张票在顶部记录 `Blocked by` 与 `Status`；依赖全部完成后才可执行。
- 新票默认状态为 `ready-for-agent`；执行中为 `in-progress`；验收完成为 `completed`。
- 需要保留补充讨论时，追加到文件末尾的 `## Comments`。

## Publishing

当技能要求发布票据时，在对应功能目录下创建一票一文件；不得把所有票据合并成一个 Markdown 文件。

## Working the frontier

- 扫描 `issues/`，只执行所有依赖均为 `completed` 的票据。
- 开始执行前将状态改为 `in-progress`。
- 完成验收标准、勾选清单并记录验证结果后，将状态改为 `completed`。
- 不关闭、覆盖或改写来源规格。
