# 场景集成验证

`integrations/` 与测试目录独立，`itrepos/<name>/` 存放可复用的场景测试仓。
每个仓自己的 README 维护前置条件、安装步骤与运行命令；进入哪个仓，就按哪个仓的引导准备。

- [Cedar](./itrepos/cedar/README.md)：全局提示词、Skill 安装态触发与可选内置 Judge live smoke 验证。
- [访问痕迹证据](./itrepos/evidence/README.md)：检索、实读、引用与禁止访问的 Recall 示例，含零 token 配置验证和显式 token 入口。
- `pi.registry.ts`：共享的宿主工厂、判据及可显式选择的只读权限配置，不持有渠道或凭据。

场景资源、任务和断言由各仓或 Skill 自己的 Recall 考卷定义，直接复用 Recall 执行和报告。
真实 token 验证必须显式选择渠道并满足 live 审批，不进入 `pnpm test`、`pnpm ittest` 或 `pnpm check`。
CLI 的 PASS/FAIL 与 JSON 报告的 `hardPass` 表示行为结果；当前断言失败仍返回退出码 0，不能只检查进程退出码。
