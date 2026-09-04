# pi 适配笔记

> RPC/MCP 探测版本：pi 0.84.2，pi-mcp-adapter 2.6.1；PTY 回归版本：pi 0.84.3

## 1. 通道选择

pi 提供 `--mode rpc`，是自有 JSONL 行协议 over stdio，**不是 JSON-RPC**。

命令面：`prompt`、`steer`、`follow_up`、`abort`、`new_session`、`get_state`、`get_messages` 等；事件流含 `agent_start` / `turn_start` / `message_*` / `tool_execution_start|update|end` / `agent_settled` 等。

严格 LF 分帧：上游文档明确警告 Node `readline` 不合规（U+2028 / U+2029 会被误断行）。这与 `JsonlProcess` 的严格 LF 分帧要求一致。

## 2. 注入语义

pi 的 RPC 模式在 agent 正在流式输出时，`prompt` 命令**必须**显式指定 `streamingBehavior`：

| 取值       | 投递时机                                               |
| ---------- | ------------------------------------------------------ |
| `steer`    | 当前 assistant 轮的工具调用执行完毕、下次 LLM 调用之前 |
| `followUp` | agent 完全停止后                                       |

`injectMode` 必须由 profile 固定声明，运行时不得切换。

`inject` 恒带 `streamingBehavior`：pi 源码证实仅流式中校验该字段，空闲态携带无副作用。

## 3. Windows spawn 陷阱

`spawn("pi.cmd")` 直接抛 `EINVAL`（Node ≥18.20 对 `.cmd` 的 shell 强制，CVE-2024-27980 修复）。

稳妥路径：

```ts
spawn(process.execPath, [
  "<pi-package>/dist/cli.js",
  "--mode", "rpc",
  ...
])
```

## 4. MCP 接线：pi-mcp-adapter

pi 核心**无内置 MCP client**，MCP 靠第三方扩展 pi-mcp-adapter。

三个实测变量：

1. **`directTools: true` 注册时序**：冷缓存首个会话不生效——模型侧仅见 `mcp` proxy 工具；adapter 后台连接 server 并写 `$PI_CODING_AGENT_DIR/mcp-cache.json`，**第二个会话起**直接工具才出现。e2e 必须先跑 warm-up 或预置缓存。
   - 注意：adapter 会先写空壳 `{"servers":{}}`，连接完成后才回填工具清单；只判文件存在性会拿到空缓存，直接工具缺失。实现以缓存含目标 server 非空工具清单为就绪条件。
2. **project trust 不拦截 MCP 配置**：未信任 cwd 的项目级 `.mcp.json` 在非交互 RPC 模式下仍被 adapter 直接加载并连接。稳妥位 `$PI_CODING_AGENT_DIR/mcp.json` 实测可用。
3. **工具命名前缀**：`<server>_<tool>`（实测 `probe_probe_ping`）；资源自动生成 `<server>_get_<resource>` 读取工具。

## 5. 入站通知不转发

pi-mcp-adapter **不会**把 MCP `resources/updated` 等 server→client 通知注入活跃会话。

实测：MCP server 在 `tools/call` 返回后发出 `notifications/resources/updated`，RPC 事件流在 `agent_settled` 后 3s 内新增 0 条事件；下一轮 prompt 发往 LLM 的 messages 中无任何通知内容；adapter 源码仅注册自家自定义通知 handler。

因此入站场景采用 driver 侧 `steer` 显式注入一条携带通知内容的 prompt 作为兜底。

## 6. 沙箱目录

pi 无专用 sandbox 开关。`$PI_CODING_AGENT_DIR` 指向 driver 自建的 `homeDir/pi-agent`，并从继承环境剥离同名变量。

## 7. 轮次结算

`agent_settled` 结算**所有**活跃轮次——steer 注入与在跑轮次共享同一终点。各轮 `Observation` 只含自己注册之后的事件；`ToolCall.input` 由同 `toolCallId` 的 `tool_execution_start.args` 配对补齐。

## 8. 自检

start 末尾发 `get_state` 验证双向通道（不需要 LLM），失败显式抛错并自动 close 回收资源。

## 9. 长驻 vs TUI

pi 的 RPC 与 TUI 共享同一个 `createAgentSessionRuntime`，interactive 模块头自述 "delegating business logic to AgentSession"。因此 RPC 测出的工具调用结论可外推到 TUI 业务逻辑，但 TUI 独占的交互审批、Ctrl-C、resize 等路径仍需 PTY 层覆盖。

### 9.1 PTY 回归落地

消费者侧测试 profile 位于 `packages/harness/tests/fixtures/profiles/pi.ts`，不从 harness 包导出。其 PTY 基线具备以下约束：

- Windows 不直接 spawn `pi.cmd`，由 `resolveHarnessCommand` 定位全局包的 `dist/bundle/cli.js`，再用 `process.execPath` 拉起；POSIX 仍走 PATH 中的 `pi`。
- `PI_CODING_AGENT_DIR` 指向沙箱配置目录，`models.json` 与 `settings.json` 把 provider/model 固定到 harness backend；fixture 使用本机 `127.0.0.1` fake provider，不读真实登录态、不消耗模型 token。
- ready 匹配使用 footer 中固定 provider 标记 `(xas)`。Pi 0.84.3 的 footer 显示模型 id 而不是 `models.json.name`，不能用自定义 display name 作为同步点。
- 项目存在 `.pi/settings.json` 等需信任的本地资源时会出现 `Trust project folder?`；默认选项就是 `Trust`，profile 写入 `\r` 后继续等待 ready。空 cwd（无任何项目本地资源）不触发该对话框（机制与参数出口见 §10）。
- 启动参数显式包含 `--no-skills`。Windows 临时 cwd 位于真实用户目录下，Pi 会沿 cwd 祖先搜索 `.agents/skills`；仅覆盖 `HOME` / `USERPROFILE` 仍可能把真实用户 skills 带进会话。
- `--no-session` 禁止落盘会话，`--no-context-files` 禁止读取项目指令；`PI_SKIP_VERSION_CHECK=1` 与 `PI_TELEMETRY=0` 抑制无关启动流量。不能使用 `--offline`，否则全新沙箱在 `injectServer=true` 时无法安装固定版本的 pi-mcp-adapter 2.29.0。

真实 CLI 集成测试默认跳过，显式运行方式：

```powershell
$env:E2E_PI_PTY = "1"
pnpm tutorial:pty:pi
Remove-Item Env:E2E_PI_PTY
```

```bash
E2E_PI_PTY=1 pnpm tutorial:pty:pi
```

该测试强制触发 trust 对话框，完成一轮 fake provider 文本响应，验证真实用户 skills 未进入 Observation，并确认关闭后沙箱 home/cwd 已删除。它不验证 pi-mcp-adapter、工具审批、Ctrl-C 或 resize；这些仍分别由 RPC/adapter 测试与后续 PTY 专项覆盖。

### 9.2 真实渠道 PTY（live 分支）

PtyAgentDriver 的 backend 传 `LiveBackend` 即进入 live 分支：沙盒 `models.json` 按借用渠道生成（baseUrl 取 `harnessBaseUrl` 宿主原值，apiKey 为借用 token），真实 TUI 按声明的 provider/model 打真实端点。渠道声明来自真实 home 的 `~/.env.e2e.yaml`（`carriers.pi` + `from: harness`，多 provider 宿主可用 `provider` 选择借用目标）。0.84.4 + kimi-coding OAuth 实测通过（footer 显示声明模型，一轮约 6s）。入口为 token 级精确脚本 `pnpm itest:token:pi-pty`，见[教程](../../docs/tutorial/recipes/pi-live-pty.md)。

## 10. Project Trust（信任对话框）出口

Project Trust 是输入加载门卫，不是沙盒：防仓库在用户批准前静默改写 pi 的设置/扩展。触发条件（0.84.4 实测）：交互式启动 + cwd 含需信任的项目本地资源（`.pi/settings.json`、项目 packages、项目 `.agents/skills` 等；裸 `.pi` 目录不算）+ `~/.pi/agent/trust.json` 无该目录或父目录的保存决定 → 按全局 `defaultProjectTrust`（默认 `"ask"`）弹问。**空 cwd 不触发**——harness 沙盒 cwd 自控内容，本就不在弹窗路径上。

出口一览：

| 方式 | 作用域 | 语义 |
| ---- | ------ | ---- |
| `--approve` / `-a` | 单次运行 | 跳过提问，信任项目本地文件 |
| `--no-approve` / `-na` | 单次运行 | 跳过提问，忽略项目本地文件 |
| `-p` / `--mode json` / `--mode rpc` | 非交互模式 | 不弹；无保存决定时 ask/never 忽略、always 信任 |
| `defaultProjectTrust: "always"/"never"` | 全局 settings.json | 改兑底行为 |
| `/trust` 或预写 `trust.json` | 按目录持久 | 保存的决定直接生效 |

注意 `--approve` 会同时信任项目的其它本地资源，仅用于 cwd 内容自控的沙盒。profile 现有 `ptySetupSequence` 写 `\r`（选中默认 Trust）已足够；如需消除对话框时序依赖，可改为给 `ptyArgs` 加 `--approve`。
