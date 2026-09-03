# PTY / TUI 专项教程

PTY 只用于 headless 或结构化长驻协议无法触达的 TUI 门槛，例如首次信任、审批框或只能在终端输入的流程。

## 运行合成 PTY

```bash
pnpm tutorial:pty
```

源码：[`examples/tutorial/07-pty.test.ts`](../../../examples/tutorial/07-pty.test.ts)。它拉起合成 Node TUI，证明 PTY 机制但不证明任何真实宿主，因此按规则命名为 `*.test.ts`。

预期摘要包含 `ready: true`、`promptSeen: true`、`injectMode: "followUp"` 和 `cleaned: true`。

## 一轮输入的时序

```text
start
  → 等 ptyReadyPattern
inject(text)
  → 写文本
  → 等屏幕回显 marker
  → 写 Enter
  → 等 screen + I/O idle（必要时叠加 prompt/FS）
  → 返回 Observation.text 屏幕快照
close
  → PTY → teardown → backend → sandbox
```

profile 至少要声明 `ptyArgs`；稳定性较差的真实 TUI 还应声明 `ptyReadyPattern`、`ptyPromptPattern`、动画剔除规则和初始对话框处理序列。

## 真实宿主 itest 参照

教程目录现在直接提供真实宿主零-token PTY 用例：[`examples/tutorial/09-pi-pty.ittest.ts`](../../../examples/tutorial/09-pi-pty.ittest.ts)。完整拆解见 [Pi PTY Integration](./pi-pty-integration.md)。它默认 skip，只有显式提供宿主前置条件时运行：

```bash
E2E_PI_PTY=1 pnpm tutorial:pty:pi
```

该文件是 `*.ittest.ts`，原因是它拉起真实宿主 CLI；使用的模型端点仍是 `FakeProviderBackend`，所以不会烧 token，并可进入 `pnpm itest` 的默认收口（缺前置条件时 skip）。

## 证据边界

- 屏幕文本用于 ready、回显和 idle 同步。
- 真实工具成功必须来自结构化遥测、server 记录或 artifact，不能靠 prompt/屏幕上出现“成功”字样。
- 当前 `PtyAgentDriver` 的屏幕方案不提供结构化 inbound，`waitInbound` 会显式拒绝。
- PTY 目录必须可丢弃、最小权限；需要绕过审批时还要禁止公网出站并获得单次明确授权。

如果 PTY 同时连接真实 provider，就不再是普通 itest，必须改名为 `*.token.ittest.ts` 并只允许显式运行；是否放进 `tests/token/` 由仓库组织需要决定。
