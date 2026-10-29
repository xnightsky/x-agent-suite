# @x-agent-suite/driver

Agent 驱动基座：子进程与 PTY 的通用封装，供上层 harness 或消费者直接使用。

## 用途与边界

- 负责：进程/PTY 生命周期、stdout 分帧、异步队列、协议无关 JSON-RPC wire、内存 mock driver。
- 不负责：业务 JSONL 语义（由消费端的 parser 解释）、具体宿主 profile、场景编排与判据。

## 模块

- `proc.ts` — `JsonlProcess`：按 LF 分帧消费 stdout JSONL，stderr 环形缓冲，优雅关闭。
- `pty.ts` — `PtyProcess`：基于 `node-pty` / `@lydell/node-pty` 分配 TTY，提供屏幕快照。
- `pty-screen.ts` — `@xterm/headless` 屏幕缓冲封装。
- `queue.ts` — 异步队列：支持阻塞消费、错误传播与优雅结束。
- `jsonl-framing.ts` — 严格 LF 分帧；U+2028 / U+2029 不断行。
- `mock.ts` — 内存 mock driver，供单元测试使用。

## 公开入口

入口为 [`src/index.ts`](./src/index.ts)（workspace 全量导出）。核心子路径 `@xnightsky/x-agent-suite/driver` 按 [`packaging/entries/driver.ts`](../../packaging/entries/driver.ts) 只暴露零原生符号：`JsonlProcess`、`LfFramer`、`AsyncQueue`、`MockDriver`，以及 `@x-agent-suite/contracts` 的驱动类型（`AgentDriver` / `LongLivedAgentDriver` / `Observation` 等）。

- `PtyProcess` / `createPtyScreen`：需安装独立制品 `@x-agent-suite/pty-driver`（依赖 `node-pty` / `@xterm/headless`）。
- `JsonRpcPeer` / `LongLivedJsonRpcDriver`：目前仅 workspace 源码可用，未纳入核心子路径导出。

## 最小示例

子进程 + LF 分帧，零网络、零 token：

```ts
import { JsonlProcess } from "@x-agent-suite/driver";

const proc = new JsonlProcess({
  command: process.execPath,
  args: ["-e", "console.log(JSON.stringify({ type: 'text' }))"],
  closeStdinAfterStart: true,
});
try {
  await proc.start();
  for await (const line of proc.lines()) {
    console.log(line); // 已按 LF 分帧并 JSON.parse
  }
} finally {
  await proc.close();
}
```

更多：[`examples/tutorial/06-long-lived-wire.test.ts`](../../examples/tutorial/06-long-lived-wire.test.ts)（长驻 JSON-RPC）、
[`examples/tutorial/07-pty.test.ts`](../../examples/tutorial/07-pty.test.ts)（PTY）。

## 设计纪律

- 只负责进程/PTY 生命周期与字节流分帧，不解析业务 JSONL 语义。
- 所有错误显式抛带上下文的 `Error`；`close` 幂等。
- Windows 保留系统 ConPTY；`node-pty@1.1.0` 通过 pnpm patch 在控制台枚举失败时回退 shell PID，清理辅助进程不向 stderr 泄漏异常。适用范围与删除条件见[依赖补丁说明](../../patches/README.md)。

## 依赖与边界

- 依赖：[`@x-agent-suite/contracts`](../contracts/README.md)（类型）。
- 被 [`@x-agent-suite/harness`](../harness/README.md) 依赖；也供消费者直接使用。

## 分发形态

对外有**两个**制品（均由 `pnpm artifacts:pack` 产出，见 [`docs/spec/packaging.md`](../../docs/spec/packaging.md)）：

- 核心聚合包 `@xnightsky/x-agent-suite`：零原生，按 `packaging/entries/*.ts` 暴露子路径（如 `@xnightsky/x-agent-suite/driver`）。
- 独立 PTY 制品 `@x-agent-suite/pty-driver`：承载原生终端能力（依赖 `node-pty` / `@xterm/headless`），需要交互式 TUI 时显式安装。

workspace 私有包（`@x-agent-suite/*`，`private: true` + `workspace:*` 互引）**不单独发布 npm**；且其 `src/index.ts` 全量导出**不等于**核心子路径的全量导出，两者差异以 `packaging/entries/*.ts` 为准。

## 命令（在仓库根执行）

```bash
pnpm --filter @x-agent-suite/driver test       # 包级单元测试
pnpm --filter @x-agent-suite/driver typecheck  # 包级类型检查
pnpm test                                      # 全仓单元测试（收口见 pnpm check）
```

## 文档

- [`docs/spec/driver.md`](../../docs/spec/driver.md)：驱动契约与生命周期语义。
- [`docs/spec/long-lived-driver.md`](../../docs/spec/long-lived-driver.md)：长驻注入与入站事件。
- [`patches/README.md`](../../patches/README.md)：`node-pty` 补丁说明。
