# 场景集成验证

`integrations/` 与测试目录独立，`itrepos/<name>/` 存放可复用的场景测试仓。
每个仓库自己的 `.recall.yaml` 定义资源、任务和断言，直接使用 Recall 执行与报告，不再写一层测试驱动。

## Cedar：验证项目提示词

`itrepos/cedar/AGENTS.md` 要求回答包含 `CEDAR_READY`。
同一份考卷用相同任务执行两次：一次准备项目规则，一次通过 `context.plan: none` 不准备规则。
两次运行使用独立的临时工作区与 HOME；被测宿主不会读到考卷里的预期。
当前断言验证规则标记出现与否，尚不检查每条回复的完整格式或中文质量。

安装 CLI 后，在场景仓运行：

```bash
cd integrations/itrepos/cedar
x-agent-suite recall .recall.yaml --carrier pi \
  --registry ../../pi.registry.ts --approve-live
```

源码仓可从根目录直接运行同一个 CLI：

```bash
pnpm ittest:token:cedar --carrier pi --approve-live
```

需要固定本次完整目标时追加 `--provider kimi-coding --model kimi-for-coding`；
只指定 `--carrier pi` 时使用私密 live 配置中的该 carrier 默认目标，不在场景仓硬编码模型。
不传 `--carrier/--provider/--model` 会在执行前失败，不调用模型；未审批的 review-required 目标同样拒绝。
借用的 OAuth 过期时，先用 `pi auth check --provider kimi-coding` 通过宿主原生流程刷新，再重跑 Recall。

`pi.registry.ts` 只注册已有的 Pi Profile 与文本判据，并显式启用隔离工作区的项目规则发现；
它不选择模型、不持有凭据。当前关闭模型工具、Skill、扩展自动发现和 MCP，不需要额外执行 Plan。
以后确需模型工具副作用时，调用方才显式提供 `--plan`。

这是实际消耗 token 的真实验证，使用当前显式选择渠道的凭据，须由用户明确发起。
该入口不进入 `pnpm test`、`pnpm ittest` 或 `pnpm check`。
检查 CLI 的 PASS/FAIL 与 JSON 报告的 `hardPass`；当前 CLI 行为断言失败仍返回退出码 0，不能只检查进程退出码。
默认报告位于当前目录 `.tmp/x-agent-suite/`，可用 `--out-dir` 显式修改。
