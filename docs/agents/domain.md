# Domain Docs

本仓库使用单一领域上下文。

## Before exploring

- 阅读根目录 `CONTEXT.md` 中与任务相关的术语。
- 阅读 `docs/adr/` 中触及当前改动的架构决策。
- 使用领域词汇中的规范名称；不要重新引入 `_Avoid_` 中的同义词。

## Layout

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

若实现与现有 ADR 冲突，必须显式指出并先更新决策，不能静默覆盖。
