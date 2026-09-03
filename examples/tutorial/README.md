# 可执行教程

这里以前只有领域中立的机制示例，现在补齐两条 opt-in 真实证据：Pi profile 仍位于测试/消费者边界，任何具体宿主知识都不进入 `packages/*/src/`。

| 示例                            | 命令                        | 证明什么                                |
| ------------------------------- | --------------------------- | --------------------------------------- |
| `01-mock-report.test.ts`        | `pnpm tutorial`             | Driver → Observation → checks → report  |
| `02-sandbox-jsonl.test.ts`      | `pnpm tutorial:sandbox`     | sandbox → JSONL 进程 → cleanup          |
| `03-fixture-backend.test.ts`    | `pnpm tutorial:fixture`     | loopback fake provider 的工具轮与文本轮 |
| `04-matrix.test.ts`             | `pnpm tutorial:matrix`      | carrier × variant → report              |
| `05-headless-fixture.test.ts`   | `pnpm tutorial:headless`    | profile + fixture + HarnessDriver       |
| `06-long-lived.test.ts`         | `pnpm tutorial:long-lived`  | 多轮 inject + inbound + close           |
| `07-pty.test.ts`                | `pnpm tutorial:pty`         | 合成 TUI 的 ready/回显/提交/idle/清理   |
| `08-live-guard.test.ts`         | `pnpm tutorial:live:guard`  | live 默认阻断、零网络与诊断脱敏         |
| `09-pi-pty.ittest.ts`           | `pnpm tutorial:pty:pi`      | 真实 Pi TUI + fake provider，零 token   |
| `10-live-smoke.token.ittest.ts` | `pnpm itest:token:tutorial` | 真实 provider 的最小 tool-calling 对照  |

前八个机制示例通过教程测试运行器执行，并把稳定的 `TUTORIAL_SUMMARY` 摘要写到 stdout。会生成报告或请求 dump 的示例默认写到 `.tmp/tutorial/<recipe>/`。

一次执行全部离线示例：

```bash
pnpm tutorial:check
```

`09` 默认 skip，设置 `E2E_PI_PTY=1` 才启动真实 Pi；`10` 不进任何默认 runner，并要求单次授权值、carrier 和私密 live 配置。PTY/headless/smoke 等词只描述玩法，真正决定执行车道的终止后缀仍只有 `*.test.ts`、`*.ittest.ts` 和 `*.token.ittest.ts`。每个示例的逐步拆解见[教程入口](../../docs/tutorial/README.md)，命名取舍见[后缀调研](../../docs/research/test-file-naming-taxonomy.md)。
