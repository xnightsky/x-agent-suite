# AGENTS.ai.md

## AI 协作规则

- 进入仓库后先在根目录运行 `rg --files --max-depth 1 -g 'AGENTS.md' -g 'AGENTS.*.md'`。
- 必须同时读取根 `AGENTS.md`；后续若新增 `AGENTS.<platform>.md`，仅在命中对应平台时读取。
- 进入子目录前检查该边界是否有局部 `AGENTS.md` 或 `AGENTS.*.md`。
- 非破坏性探索优先于实现；变更前说明目标、范围和预期影响。
- 发现边界冲突、设计冲突、阶段切口冲突或隐藏的全局一致性风险时，第一时间用 `**[冲突提示]**` 高亮提示用户。

## 文档与 Superpowers 产物

- 项目文档分层以 `docs/README.md` 为准，行为变化原地更新对应的 architecture、spec、tutorial 或 research 文档。
- Brainstorming 设计稿写入 `docs/spec/*.md`，覆盖 skill 默认的 `docs/superpowers/specs/`。
- Writing Plans 与 Executing Plans 的执行计划写入 `.tmp/plans/*.md`；`.tmp/` 已被 Git 忽略，计划不进入版本库。
- 禁止创建 `docs/superpowers/` 层级。
- 用户显式指定产物路径时，以用户指定路径为准。
