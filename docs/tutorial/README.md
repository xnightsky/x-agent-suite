# x-agent-suite 使用教程

这套框架的玩法不是“运行一个万能命令”，而是按测试目标组合基础模块：消费者提供被测宿主的适配与领域判断，x-agent-suite 提供驱动、隔离、观测、矩阵和报告机制。

## 先记住一条主链

```text
Driver
  └─ sendPrompt / inject
       └─ Observation
            └─ checks / 消费者 Criterion
                 └─ ScenarioResult
                      └─ runMatrix（可选）
                           └─ Markdown + JSON report
```

测试真实 Agent CLI 时，在 Driver 前增加三块：

```text
HarnessProfile + LlmBackend + Sandbox
                    │
                    ▼
             HarnessDriver
```

- `HarnessProfile`：消费者描述怎样启动、配置和解析某个宿主。
- `LlmBackend`：选择本地 fixture 或显式授权的 live provider。
- `Sandbox`：把 HOME、cwd 和环境变量隔离到一次运行内。

## 当前能力边界

当前版本是一组可组合的库，不是完整评测产品：

- `Registry`、`ScenarioSpec`、`Criterion` 已有类型契约；框架尚未提供运行时 Registry 和通用 Scenario DSL runner。
- `runMatrix` 已可运行，但 `createDriver` 和 `runScenario` 仍由消费者注入。
- 统一的 `x-agent-suite run/matrix` CLI 仍在路线图阶段。
- 源码仓各包为 private workspace 包；外部消费者当前通过本地版本化制品使用。

因此，教程里的 `examples/tutorial/support.ts` 是明确的**消费者侧胶水**，不会从框架包导出。

## 按目标选择玩法

| 目标                           | 详细教程                                              | 默认风险                             |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------ |
| 学会 Driver、评分和报告闭环    | [Mock → Report](./recipes/mock-report.md)             | 离线、安全                           |
| 驱动自己的 JSONL 子进程        | [Sandbox → JSONL](./recipes/sandbox-jsonl.md)         | 离线、安全                           |
| 验证模型 wire 与工具轮次       | [Fake Provider](./recipes/fixture-backend.md)         | loopback、安全                       |
| 横向比较 driver 和 prompt 变体 | [Matrix → Report](./recipes/matrix-report.md)         | 离线、安全                           |
| 驱动 headless Agent CLI        | [Headless Fixture](./recipes/headless-fixture.md)     | 合成示例安全；真实宿主有前置条件     |
| 验证多轮、入站或长驻会话       | [Long-lived](./recipes/long-lived.md)                 | 合成示例安全；真实实现取决于消费者   |
| 复用 JSON-RPC 长驻 wire 基座   | [Long-lived Wire](./recipes/long-lived-wire.md)       | 假 peer 链安全；真实宿主取决于消费者 |
| 覆盖 TUI 审批/交互             | [PTY / TUI](./recipes/pty.md)                         | 合成示例安全；真实宿主需隔离         |
| 使用真实模型渠道               | [Live Guard](./recipes/live-guard.md)                 | guard 安全；token 用例高风险         |
| 用 Pi 验证真实 PTY 路径        | [Pi PTY Integration](./recipes/pi-pty-integration.md) | 真实宿主；fake provider；默认 skip   |
| 用 Pi PTY 打真实 provider/model | [Pi Live PTY](./recipes/pi-live-pty.md)               | 真实宿主+借用渠道；真实 token；仅显式运行 |
| 对照真实 provider tool calling | [Live Token Smoke](./recipes/live-token-smoke.md)     | 真实 token/费用/出站；仅显式运行     |

完整工具表见[模块手册](./modules.md)，支持/有条件/尚未实现的组合见[组合手册](./combinations.md)。AI 或自动检查先读 [`catalog.json`](./catalog.json)，需要逐符号覆盖时按其中 `toolsFile` 加载 [`tools.json`](./tools.json)，不应从路线图反推当前 API。

## 10 分钟跑通第一条链

安装依赖后运行：

```bash
pnpm install
pnpm tutorial
```

命令执行以下步骤：

1. 启动 `MockDriver` 并发送 prompt。
2. 获得结构化 `Observation`。
3. 执行 dry 与 fuzzy 检查，组装 `ScenarioResult`。
4. 写出 Markdown 结论表和 JSON 明细。
5. 在 stdout 打印产物路径与通过状态。

默认产物位于 `.tmp/tutorial/mock-report/`。下一步通常是把 `MockDriver` 替换为自己的 Driver，保留后半段评分和报告代码。

## 九条默认安全教程命令

```bash
pnpm tutorial
pnpm tutorial:sandbox
pnpm tutorial:fixture
pnpm tutorial:matrix
pnpm tutorial:headless
pnpm tutorial:long-lived
pnpm tutorial:long-lived-wire
pnpm tutorial:pty
pnpm tutorial:live:guard

# 一次验证全部安全教程
pnpm tutorial:check
```

这些命令都不读取真实 CLI 凭据、不调用真实模型、不要求外部 Agent CLI。headless 与 PTY 命令使用合成测试宿主演示机制；live 命令只验证默认阻断和脱敏。

## 两条 opt-in 真实证据

```bash
pnpm tutorial:pty:pi       # 默认 skip；E2E_PI_PTY=1 才启动真实 Pi，仍为零 token
pnpm itest:token:tutorial  # 默认 skip；还需单次授权、carrier 与私密配置
pnpm itest:token:pi-pty    # 默认 skip；还需单次授权、carriers.pi 借用声明与宿主登录态
```

真实宿主走 `*.ittest.ts`，真实 provider 走只能显式运行的 `*.token.ittest.ts`。PTY、headless、smoke 只是文件 stem/catalog 标签，不再增加终止后缀；完整规则见[测试分层规范](../spec/testing.md)，决策证据见[后缀调研](../research/test-file-naming-taxonomy.md)。

## 消费者需要提供什么

| 接缝                        | 什么时候提供                            | 框架怎样使用                               |
| --------------------------- | --------------------------------------- | ------------------------------------------ |
| `AgentDriver`               | 已有结构化进程/协议适配时               | 统一调用 `start/sendPrompt/events/close`   |
| `HarnessProfile`            | 需要框架拉起真实 CLI 时                 | 写配置、拼参数、解析 JSONL、映射工具名     |
| `ScenarioSpec` / `Scenario` | 表达多轮输入和依赖时                    | 当前由消费者自己的 runner 解释             |
| `Criterion`                 | 领域 pass/fail 不能由通用 checks 表达时 | 当前由消费者自己的 runner 调用             |
| artifact collector          | 需要被测系统侧客观证据时                | 放进 `ScenarioResult.artifact` 后写报告    |
| driver/profile registry     | 同时维护多种实现时                      | 当前由消费者持有；运行时 Registry 尚未落地 |

## 阅读顺序

1. 跑 `pnpm tutorial`，确认能得到报告。
2. 从[模块手册](./modules.md)找到要替换的组件。
3. 从[组合手册](./combinations.md)确认组合前提和风险。
4. 复制最接近的可执行示例到消费者仓库，替换消费者拥有的 profile、scenario、criterion 和 server 入口。
5. 默认使用 fixture；只有确定需要真实渠道证据时才进入 live。

## 安全停点

- fixture 只降低账号与费用风险，不是完整网络或文件系统沙箱。
- live 必须获得单次明确授权，使用专用 API key/企业凭据，并限制费用、token、并发和超时。
- PTY 只用于 headless/长驻协议覆盖不了的 TUI 独占路径。
- `harness` 中标为 `debt` 的公开 helper 是迁移遗留，不代表框架正式内建具体宿主。
