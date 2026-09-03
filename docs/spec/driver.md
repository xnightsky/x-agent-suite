# 子进程与 PTY 基座

`@x-agent-suite/driver` 提供两类进程驱动能力：

- `JsonlProcess`：headless 子进程，stdout 按 JSONL 消费。
- `PtyProcess`：PTY 子进程，屏幕缓冲用于 TUI 同步。

两者复用同一生命周期骨架：spawn 握手、SIGTERM→SIGKILL 分级、stderr 环形缓冲、`AsyncQueue` 背压。

## JsonlProcess

### 职责

- spawn 子进程；
- stdout 严格按 LF 分帧，逐行解析为 JSON；
- stderr 维护环形缓冲，失败时提供尾部诊断；
- send 向 stdin 写 JSONL；
- close 先 SIGTERM，超时后 SIGKILL。

### 严格 LF 分帧

`node:readline` 会把 `U+2028` / `U+2029` 也视为换行，而 LLM 消息正文可能包含这两个字符。因此 `JsonlProcess` 使用基于 `node:string_decoder` 的显式分帧器：

- 仅以 `\n` 作为记录分隔符；
- 容忍并剥除行尾可选的 `\r`；
- 不将 `U+2028` / `U+2029` 视为换行；
- 超长行显式抛错并附上下文；检查覆盖未分隔残留、同一 chunk 内已分隔完整行和 `end()` 残留。

### 接口

```ts
export interface JsonlProcess {
  start(): Promise<void>;
  send(line: unknown): void;
  lines(): AsyncIterable<unknown>;
  stderrTail(): string;
  close(reason?: string): Promise<void>;
}
```

### 关键纪律

- `closeStdinAfterStart`：某些 CLI 在 stdin 为 pipe 且 prompt 已作 argv 传入时仍会阻塞等 stdin EOF，需要启动后即关闭 stdin。
- 重复 start 显式抛错；send 到已关闭进程抛错。

## PtyProcess

### 职责

PTY 版只替换两处：

- 输入侧：`spawn` → `pty.spawn`（固定 `cols` / `rows` / `TERM`）；
- 输出侧：JSONL 行解析 → 屏幕缓冲快照 + `waitForScreen(regex, timeoutMs)`。

### 接口

```ts
export interface PtyProcess {
  start(): Promise<void>;
  write(data: string): void;
  screen(): string;
  waitForScreen(match: RegExp, timeoutMs: number): Promise<void>;
  close(reason?: string): Promise<void>;
}
```

### 屏幕断言纪律

**断言绝不落在屏幕文本上。** Ink 等全屏 TUI 会重复输出历史帧，`strip-ansi` 不维护屏幕状态，容易导致假阳性。

| 用途                             | 手段                              |
| -------------------------------- | --------------------------------- |
| 同步（等待就绪、等待提示符出现） | 屏幕缓冲正则匹配                  |
| 断言                             | 被测系统侧记录 + 消费者自定义证据 |

## 宿主适配纪律

每个宿主 CLI 都是不同的 carrier。driver 负责把宿主私有输出归一成 `Observation`，判据只看 `Observation`。

### driver 必须交付的四样东西

新增一个宿主，对应的 driver / parser 必须给齐：

1. **命令序列** —— 宿主实际执行的命令或 tool call 名，供判据做路由命中 / 禁止命令检查；
2. **助手文本** —— 不含命令的纯文本，供判据做子串匹配；
3. **耗尽标志** —— `exhausted` 与超时，区分「跑完了但没做对」和「没跑完」；
4. **cleanup 前证据** —— workspace 销毁前收集的文件态 / 游标 / 被测系统侧记录。

第 4 条是硬顺序约束：sandbox 一旦 cleanup，artifact 判据就永久失去证据。

### 失败分类前缀

driver 必须让判据能区分框架级失败与领域失败，靠 reason 前缀实现：

| 前缀           | 含义                              |
| -------------- | --------------------------------- |
| `[payload]`    | driver 未返回可解析的 Observation |
| `[driver-env]` | 环境准备失败，或宿主非零退出      |
| `[timeout]`    | 宿主进程超时被 kill——轨迹不可判   |
| `[config]`     | 场景声明缺失，判据无法判定        |
| 无前缀         | **真实领域失败**——这才是成绩单    |

只有无前缀的失败才计入领域结论。混淆这一层，报告会把管道故障读成能力缺陷。

### 数据单向流动

```text
scenario → driver → Observation → criterion → report
```

每一跳只准向右传数据，不准向左回调。driver 不问「这个场景该不该过」，判据不问「宿主是怎么跑的」。

## AsyncQueue

`JsonlProcess` 与 `PtyProcess` 内部使用 `AsyncQueue` 做事件背压：

- 生产者 push 不阻塞；
- 消费者按序迭代；
- `undefined` 可作为合法元素入队，不承担“队列为空”哨兵语义；
- close 时向等待中的迭代器抛 `QueueClosedError`。

## 技术选型

| 依赖                                | 用途              | 说明          |
| ----------------------------------- | ----------------- | ------------- |
| `node-pty`（或 `@lydell/node-pty`） | 分配 PTY 拉起宿主 | devDependency |
| `@xterm/headless`                   | 虚拟屏幕缓冲      | devDependency |

Windows 有官方 prebuilt；Linux CI 可用 `@lydell/node-pty` 绕开工具链。

Windows 关闭系统 ConPTY 时，`node-pty@1.1.0` 会 fork 辅助进程枚举控制台进程树。本库通过 pnpm patch 将该辅助进程的 `AttachConsole` 失败降级为现有的 shell PID 回退；正常枚举和主 PTY 错误仍保持原行为，且清理阶段不会向测试 stderr 泄漏辅助进程堆栈。适用范围、上游状态和删除条件见[依赖补丁说明](../../patches/README.md)。

## 文件清单

```text
packages/driver/src/
├── proc.ts            # JsonlProcess
├── pty.ts             # PtyProcess
├── pty-screen.ts      # 屏幕快照、光标、变化事件
├── jsonl-framing.ts   # 严格 LF 分帧器
└── queue.ts           # AsyncQueue
```

## 验收标准

- `JsonlProcess` 能通过含 `U+2028` / `U+2029` / `\r\n` 的 JSONL 回归测试，完整或残留超长行均在交付前失败。
- `PtyProcess` 能拉起至少一个宿主 TUI，并用 `waitForScreen` 稳定等到就绪提示。
- Windows ConPTY 枚举助手在无效或已退出 PID 下安静回退，测试 stderr 不出现辅助进程异常。
- 重复 start / send 到已关闭进程均显式抛错。
- 屏幕文本只用于同步，不进入断言。
