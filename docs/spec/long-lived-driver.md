---
title: "长驻会话驱动"
type: spec
status: active
tags: [spec, long-lived-driver]
---

# 长驻会话驱动

## 问题：一次性 headless 只覆盖一半语义

一次性 headless（`-p` / `exec` 跑完即退）只能覆盖**出站**：Agent 主动调用工具。以下语义需要会话在收到外部输入时仍存活：

| 语义                                 | 一次性 headless | 说明                     |
| ------------------------------------ | --------------- | ------------------------ |
| 出站：主动调工具                     | ✓               | 单轮内即可完成           |
| **入站：运行中收到事件并呈现给模型** | ✗               | 需要会话存活             |
| **多轮 ask / reply 往返**            | ✗               | 需要一端阻塞等待另一端   |
| **在线状态 / 成员变化**              | ✗               | 需要两端同时在线         |
| **资源通知真的进上下文**             | ✗               | 通知到达时会话可能已退出 |

## 通道选择：结构化长驻协议优先于 PTY

优先选择宿主暴露的长驻双向协议（如 ACP over stdio、RPC over stdio），而不是 PTY 驱动 TUI。原因：

- 审批类交互在协议层可程序化应答；
- 事件天然结构化，断言更稳定；
- PTY 屏幕文本断言随界面改版即碎。

PTY 仅用于覆盖 TUI 独占路径（见 [pty-driver.md](./pty-driver.md)）。

## LongLivedAgentDriver 契约

`AgentDriver.sendPrompt()` 是请求/响应式，而入站事件是异步涌入的，两者不同构。因此扩展而非改写。

```ts
export interface InboundEvent {
  readonly kind: "notification" | "tool_call" | "tool_result";
  readonly timestamp: number;
  readonly payload: unknown;
}

export type InjectMode = "steer" | "followUp";

export interface LongLivedAgentDriver extends AgentDriver {
  readonly injectMode: InjectMode;
  inject(text: string): Promise<Observation>;
  inbound(): AsyncIterable<InboundEvent>;
  waitInbound(
    match: (e: InboundEvent) => boolean,
    timeoutMs: number,
  ): Promise<InboundEvent>;
}
```

`sendPrompt` 保留：首轮 prompt 与一次性模式语义一致，便于两类 driver 共用 scenario 前半段。

## injectMode 必须固定

某些长驻协议在流式输出时要求显式指定注入时机（如 `steer` / `followUp`）。两种取值投递时机不同，同一输入会产生不同处理顺序。

约束：

1. `injectMode` 是 `readonly`，由 profile 声明，运行时不得切换。
2. 每个 profile 必须显式声明其值。
3. 若某场景需要对比两种语义，应建**两个独立 carrier 条目**（如 `host-a-steer` / `host-a-followUp`）。

## 分帧必须严格按 LF

长驻协议常以 LF 分帧。`node:readline` 会把 `U+2028` / `U+2029` 也断行，而消息正文可能含这两个字符。因此 `JsonlProcess` 使用严格 LF 分帧器（见 [driver.md](./driver.md)）。

## wire 层：JsonRpcPeer + LongLivedJsonRpcDriver

宿主通道是 JSON-RPC over stdio（如 ACP 类协议）时，框架提供协议无关的 wire 基座，消费者只注入协议 adapter：

```ts
export interface JsonRpcLongLivedAdapter {
  handshake(peer: JsonRpcPeer): Promise<unknown>;
  buildPrompt(
    session: unknown,
    text: string,
    mode: InjectMode,
  ): { method: string; params?: unknown };
  answerReverseRequest?(
    msg: JsonRpcIncomingRequest,
  ): JsonRpcReverseAnswer | Promise<JsonRpcReverseAnswer>;
  mapNotification(msg: JsonRpcNotification): NotificationMapping;
  closeRequest?(session: unknown): { method: string; params?: unknown } | null;
}
```

分工与不变量：

- `JsonRpcPeer`（协议无关）：请求 id 自增配对、超时显式拒绝并附 stderr 诊断；响应配对严格按 id 类型与值——只有数值 id 命中待完成请求，字符串 `"1"` / `"01"` / `"1e0"` 不做数值归一、不命中数值 `1`，未知 id 的应答直接丢弃；消费循环三态路由——响应归位（error 显式 reject）/ 反向请求分发 / 通知回调；未注册 handler 的反向请求回 `-32601` 防止对端挂起；流断或解析失败时显式拒绝所有悬挂请求；close 幂等且先停消费再关进程。**本层不出现任何具体协议方法名。**
- `LongLivedJsonRpcDriver`（LongLivedAgentDriver 骨架）：轮次串行化（roundChain，前一轮失败不阻塞后续）；轮次内通知经 `mapNotification` 聚合进当轮 `Observation`（`{kind:"round"}`），轮次外通知进 `inbound()`（`{kind:"inbound"}`），`{kind:"ignore"}` 丢弃；`sendPrompt` 委托首次 `inject` 语义；`waitInbound` 只等未来事件、超时显式抛错；close 幂等，先 best-effort 告别请求（`closeRequest`）再关 peer。
- sandbox / 宿主编排不进骨架：`spawn.command/args` 由消费者直接给出。
- adapter 可持有跨调用状态（如工具调用合并器）；`buildPrompt` 每轮调用一次，可作为轮次边界重置时机。adapter 抛错显式失败，不静默吞错。

`JsonRpcPeer` 在消费循环终止时、调用 `onStreamEnd` 前保存终止原因。
非法 JSONL、无法路由或其他消费故障后，即使尚未 `close()`，后续 `request()`（包括结束回调内重入）
也立即以原始 `Error` 拒绝，不分配请求 id、不创建计时器或 pending、不调用底层 `send()`。
自然 EOF 且无悬挂请求时，结束通知仍为 `error = null`，但后续请求明确以“对端流已结束”拒绝。
调用 `close()` 后仍优先返回“已关闭”错误；未调用 `start()` 时的既有行为保持不变。

`JsonRpcPeer.start()` 启动后台消费时立即观察其 Promise 的拒绝，但保留原 Promise 的失败状态。
自然 EOF 后若 `onStreamEnd` 回调抛错，即使调用方稍后才关闭，也不会因后台消费的未处理拒绝
导致进程崩溃；不安装全局 `unhandledRejection` handler，也不把消费失败转换为成功。
`JsonRpcPeer.close()` 在等待原消费 Promise 后关闭底层进程，拒绝残留请求并清除其计时器。
即使等待消费循环失败（包括 `onStreamEnd` 回调抛错），也不会跳过这些清理；
即使进程关闭失败，仍会拒绝残留请求并清除计时器。等待消费循环的异常在进程清理成功后
由 `close()` 原样拒绝；进程关闭失败时暴露该清理错误。重复或并发 `close()` 共用同一次关闭操作，
失败时也不重复执行回调或清理，调用方仍能观察到相同的失败结果。

可运行示例见 [long-lived-wire 教程](../tutorial/recipes/long-lived-wire.md)。

## 结论边界

长驻通道验证的是**协议路径**，不等于覆盖 TUI 交互路径。以下差异真实存在，长驻通道测不到：

1. 交互式审批 / 信任门槛；
2. Ctrl-C 中断语义、terminal resize；
3. 全屏重绘相关行为。

需要覆盖上述差异时，使用 PTY 层。

## 文件清单

```text
packages/contracts/src/driver.ts                # LongLivedAgentDriver / InboundEvent / InjectMode
packages/driver/src/jsonl-framing.ts            # 严格 LF 分帧器
packages/driver/src/jsonrpc-peer.ts             # 协议无关 JSON-RPC wire 层
packages/driver/src/long-lived-jsonrpc.ts       # LongLivedAgentDriver 骨架 + adapter 接缝
packages/driver/tests/fixtures/fake-jsonrpc-peer.ts # 脚本化假 JSON-RPC 服务端（测试用）
packages/harness/src/pty-driver.ts              # PTY 版长驻驱动（可选）
```

## 验收标准

- 严格 LF 分帧器通过含 `U+2028` / `U+2029` / `\r\n` 的回归测试。
- 长驻 driver 能在单会话完成 ≥2 轮 `inject`。
- 每个长驻 profile 显式声明 `injectMode`，测试中不出现运行时切换。
- 断言落在被测系统侧记录与消费者自定义证据，不依赖宿主自报文本。
- `inject` / `sendPrompt` 均返回 `Observation`（含 `ToolCall.status`）。
- wire 层：请求/响应 id 配对（严格按 id 类型与值，字符串 id 不命中数值 id）与超时显式拒绝；反向请求未注册时回 `-32601`；
  非法 JSONL、无法路由或自然 EOF 后（含结束回调内重入）的请求立即拒绝，不写进程、不创建请求计时器或残留 pending，
  故障保留原始 Error，自然 EOF 保持正常结束通知，关闭后仍报“已关闭”；
  流断或非法 JSONL 时悬挂请求显式失败且 close 仍能清理干净；结束回调抛错时仍回收进程、
  拒绝残留请求并清除计时器，close 显式暴露原错且幂等；隔离调用方子进程以结束回调信号
  等待真实自然 EOF，再跨过事件循环轮次后 close，验证后台拒绝不使进程崩溃、延迟关闭清理资源且重复关闭仍拒绝原错。
- `packages/driver/src/` 的 wire 层与骨架不出现任何具体协议方法名（由 `pnpm boundary` 与代码评审双重保证）。
