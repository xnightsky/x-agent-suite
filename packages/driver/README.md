# @x-agent-suite/driver

Agent 驱动基座：子进程与 PTY 的通用封装，供上层 harness 或消费者直接使用。

## 模块

- `proc.ts` — `JsonlProcess`：按 LF 分帧消费 stdout JSONL，stderr 环形缓冲，优雅关闭。
- `pty.ts` — `PtyProcess`：基于 `node-pty` / `@lydell/node-pty` 分配 TTY，提供屏幕快照。
- `pty-screen.ts` — `@xterm/headless` 屏幕缓冲封装。
- `queue.ts` — 异步队列：支持阻塞消费、错误传播与优雅结束。
- `jsonl-framing.ts` — 严格 LF 分帧；U+2028 / U+2029 不断行。
- `mock.ts` — 内存 mock driver，供单元测试使用。

## 设计纪律

- 只负责进程/PTY 生命周期与字节流分帧，不解析业务 JSONL 语义。
- 所有错误显式抛带上下文的 `Error`；`close` 幂等。
- Windows 保留系统 ConPTY；`node-pty@1.1.0` 通过 pnpm patch 在控制台枚举失败时回退 shell PID，清理辅助进程不向 stderr 泄漏异常。适用范围与删除条件见[依赖补丁说明](../../patches/README.md)。
