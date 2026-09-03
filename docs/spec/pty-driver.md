# PTY 驱动层

> 仅用于覆盖长驻通道**测不到**的 TUI 交互路径。主干路线见 [long-lived-driver.md](./long-lived-driver.md)。

## 定位

PTY 层是「延后但必要」：TUI 行为进入测试议程时只能按 PTY 测；但 PTY 的必要范围比字面意思要小，审批类交互大部分可经长驻协议程序化覆盖。

真正只能 PTY 验的最小清单：

1. **项目 trust 交互提示**：TUI 独占，非交互模式不弹提示。
2. **OAuth 交互流**：TUI 独占。
3. **键盘中断语义**：TUI 下 `escape` / `ctrl+c` 与协议层 `abort` 代码路径不同。
4. **resize 重绘 / 主题 / custom 组件渲染**：仅存在于 TTY。
5. **内置 TUI 斜杠命令**：仅交互模式可执行。

明确不在清单内：扩展对话框（`select` / `confirm` / `input`）的**逻辑**——对话框逻辑 TUI / 长驻协议共享，仅渲染与键鼠交互为 TUI 独占。

## 目标与边界

**只做一件事**：验证只存在于 TTY 会话的交互路径。

| 覆盖                          | 不覆盖                           |
| ----------------------------- | -------------------------------- |
| 交互式审批 / 信任门槛         | 工具是否被调用（长驻通道已覆盖） |
| Ctrl-C 中断语义               | 消息是否送达                     |
| terminal resize、全屏重绘行为 | 模型输出质量                     |

## 关键纪律：屏幕文本只用于同步

**断言绝不落在屏幕文本上。** Ink 等全屏重绘会重复输出历史帧，`strip-ansi` 不维护屏幕状态，断言会假阳性。

| 用途                             | 手段                              |
| -------------------------------- | --------------------------------- |
| 同步（等待就绪、等待提示符出现） | 屏幕缓冲正则匹配                  |
| 断言                             | 被测系统侧记录 + 消费者自定义证据 |

## 技术选型

### 选 `node-pty` + `@xterm/headless`，不引 expect 框架

- `node-pty`（或 `@lydell/node-pty`）：分配 PTY 拉起宿主。
- `@xterm/headless`：虚拟屏幕缓冲，喂 PTY 原始字节，读 `buffer.active` 得屏幕矩阵，天然吸收光标移动重绘。

两者均为 devDependency，不进运行时。

### PtyProcess 接口

```ts
export interface PtyProcess {
  start(): Promise<void>;
  write(data: string): void;
  screen(): string;
  waitForScreen(match: RegExp, timeoutMs: number): Promise<void>;
  close(reason?: string): Promise<void>;
}
```

`PtyProcess` 是 `JsonlProcess` 的兄弟类：复用同一生命周期骨架，仅替换 spawn 与输出解析。

## Idle 判定维度

`PtyScreenWatcher.waitForIdle()` 返回 `{ reason: "screen" | "io" | "prompt" | "fs" | "timeout" }`：

1. **屏幕差异**：剔除 spinner/动画帧后，归一化文本稳定。
2. **I/O 静默**：自上次屏幕变化起稳定一段时间。
3. **光标提示符**：光标所在行匹配 `promptPattern` 且光标稳定。
4. **FS 变更频率**：可选文件系统 watcher，文件无变更时 reason 提升为 `"fs"`。
5. **硬超时**：watcher 返回 `"timeout"`，driver 立即以 `[timeout]` 错误拒绝当前轮次，不生成可评分的普通 Observation。

`dispose()` 会清除并拒绝全部进行中的 `waitForIdle()`，随后解除屏幕订阅；关闭 driver 不会留下轮询访问已释放 PTY。

## 初始对话框处理

`HarnessProfile.ptySetupSequence` 允许 profile 声明启动交互序列：

```ts
ptySetupSequence: [
  {
    match: /Trust this folder\?/,
    input: "\u001b[A\r",
    description: "选择 Trust this folder",
  },
];
```

`PtyAgentDriver.start()` 在等 `ptyReadyPattern` 的同时轮询 setup sequence，匹配即写入对应按键。

## 提交键时序

实测发现：写入 prompt 文本与写入 `\r` 之间必须留稳定间隔，否则长输入的回车会被丢弃。原因是 TUI 框架需要时间消费输入缓冲。

因此 `PtyAgentDriver` 先等文本回显，再附加 `SUBMIT_SETTLE_MS` 才写提交键。

## 已知代价

| 代价                                               | 缓解                                     |
| -------------------------------------------------- | ---------------------------------------- |
| 全屏重绘使文本跨帧断裂                             | 用屏幕缓冲而非流式文本；匹配用宽松包含   |
| 逐字符写入后需确认回显                             | `waitForScreen` 统一处理，不用固定 sleep |
| Windows conpty 退出码不可预测                      | 该平台仅跑同步类断言，不依赖退出码       |
| Windows 关闭时可能输出 `AttachConsole failed` 噪音 | 不影响功能；断言不依赖 stderr            |
| 换行位置随 `cols`/`rows`/`TERM` 变化               | 三者在 profile 中固定                    |
| 断言天然脆于结构化事件                             | 严格遵守：只同步，不断言                 |

## 与主干纪律的差异

主干纪律要求断言不落在屏幕文本上。PTY 专项在用户需要观察 TUI 输出以定位问题时，屏幕文本本身即为待观测对象。因此：

- PTY 调试测试默认 skip，不进入主干回归；
- 断言仅做宽松关键字匹配，不精确比对；
- 工具调用状态仍优先走结构化通道。

## 文件清单

```text
packages/driver/src/
├── pty.ts            # PtyProcess
└── pty-screen.ts     # 屏幕快照、光标、变化事件

packages/harness/src/
├── pty-watcher.ts    # 多维度 idle 判定
├── pty-driver.ts     # PtyAgentDriver
├── pty-cleanup.ts    # 聚合清理
└── resolve-command.ts # ptyCommand 解析
```

## 验收标准

- `PtyProcess` 能拉起至少一个宿主 TUI，并用 `waitForScreen` 稳定等到就绪提示。
- `PtyScreenWatcher` 能在真实 TUI 输出后判定 idle，reason 不为 timeout。
- `PtyScreenWatcher.dispose()` 立即终止活动等待；硬超时由 driver 显式拒绝。
- `PtyAgentDriver` 能处理初始对话框并进入就绪状态。
- PTY 调试测试默认 skip，不阻塞主干回归。
- `cols` / `rows` / `TERM` 在 profile 中固定。
