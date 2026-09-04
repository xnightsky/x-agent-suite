# 自研 Fake Provider 与 HarnessProfile

## 目标

把 Agent CLI 接到被测系统上，用自研的假 LLM 端点替代真实 backend，实现零 token 的 preflight 测试。

## 为什么不用外部 mock 库

被测对象是**独立 CLI 子进程**，进程内拦截方案（`nock` / `msw` / `@pollyjs/core`）管不到 spawn 出去的子进程，结构性排除。

外部 mock 库（如 `@copilotkit/aimock`）虽然活跃，但不被采用，理由：

- 期望响应形态由**我们规定**（必须调某个工具、参数必须匹配），本身就是断言的一部分，手写更精确；
- 轮次判定只需一个判据（请求体里有无 tool result），用不上多维匹配；
- 自研端点可把请求体原样落盘，探测期可诊断性更高；
- 端点是明文 HTTP + loopback，不需要 TLS/MITM 能力。

## LlmBackend 抽象

```ts
export interface LlmBackend {
  readonly mode: "fixture" | "live";
  /** live 模式已解析渠道的结构化品牌：start() 成功后可读，此前为 undefined。 */
  readonly liveChannel?: LlmLiveChannel;
  start(): Promise<{ baseUrl: string; apiKey: string }>;
  stop(): Promise<void>;
}
```

`liveChannel` 是跨制品身份判定的唯一合法接缝：制品化分发（bundle 内联、双包安装、peer 重复）下同一进程可能存在多个 `LiveBackend` 类对象，`instanceof` 不保证唯一，harness 的 live 分支只读品牌字段，不做类身份判定。

## FakeProviderBackend

按 harness profile 声明的 wire 类型，起一个绑 `127.0.0.1`、端口 0 的 `node:http` server。

```ts
export type WireProtocol =
  "openai-responses" | "openai-chat" | "anthropic-messages" | "gemini-generate";

export interface FixtureTurn {
  readonly toolCall?: { name: string; namespace?: string; args: unknown };
  readonly text?: string;
}

export interface FixtureProviderOptions {
  readonly wire: WireProtocol;
  readonly script: readonly FixtureTurn[];
  readonly dumpPath?: string;
}
```

### 轮次判定不用全局计数器

宿主可能重试或起多个会话，计数器会错位。按请求体判定：

- `openai-responses`：`input` 中是否含 `function_call_output`；
- `anthropic-messages`：body 中是否含 `tool_result`；
- `openai-chat`：`messages` 中是否含 `role: "tool"`；
- `gemini-generate`：body 中是否含 `functionResponse`。

### 端口与网络

- 端口 0 + loopback：某些宿主官方要求非 HTTPS 必须指向 loopback，且随机端口天然支持并发隔离。
- 请求体全量落盘（不截断）。

## LiveBackend

`LiveBackend` 直连私密配置区声明的真实 provider，从响应 usage 提取 token 数供成本估算。显式凭据与 `credential: harness` 互斥；借用凭据前必须再次通过 `borrowChannel` 取得规范渠道，并确认 `wire`、`baseUrl`、`provider` 未被重定向。它在解析渠道和凭据后提供稳定的 `Redactor` seam；transport/解析异常、`Error.cause`、`AggregateError.errors`、stack 和响应载荷在离开 backend 前均递归脱敏。脱敏同时识别任意长度的直接值、URL 归一/编码值及终端跨行值；结构化键碰撞使用无敏感信息的稳定后缀保留全部字段。

### live 渠道解析优先级

live 渠道按以下固定顺序解析（高优先级在前）：

1. **env 字段覆盖**：`E2E_LIVE_<CARRIER>_BASE_URL|MODEL|API_KEY|API_KEY_ENV|WIRE`，字段级叠加在文件声明之上（任一字段来自 env，`source` 即记为 `env`）；
2. **显式文件**：`E2E_LIVE_CONFIG_PATH` 指向的 YAML（`source: explicit-path`）；
3. **repo 级**：仓库根 `.env.e2e.yaml`（被 .gitignore 的 `.env*` 规则覆盖；`source: repo-local`）；
4. **home 级**：`~/.env.e2e.yaml`（跨仓库共享的用户级声明；`source: home-dot`）；
5. **历史 home 路径**：`~/.config/x-agent-suite/.env.e2e.yaml`（`source: user-home`）；
6. **宿主默认渠道**：文件内 `from: harness` 声明在 load 阶段经 `borrowChannel` 借用宿主 CLI 自己的 settings（默认 provider/model）；宿主 CLI 的内置 provider（不落盘用户 models 配置的那部分）由 harness 包内的内置注册表快照兜底，`models` 配置中的同名条目恒优先于快照。裸 `from: harness`（不写 wire/baseUrl/model/provider）语义即「整体使用宿主默认渠道」；yaml 显式字段覆盖借用值，未给显式凭据时隐含 `credential: harness`；
7. **代码显式指定**：`new LiveBackend({ channel })` 直接传入完整 `LiveChannel`，构造期旁路上述全部文件/借用解析，适用于极少数需要场景级定点渠道的用例。

1–5 是 `loadLiveConfig` / `resolveLiveChannel` 的文件发现与覆盖链（命中即停）；6 发生在文件声明内部；7 不经过文件链。缺文件、缺 carrier 或借用失败均返回显式「未配置」结果（不抛异常），live 用例据此 skip，不判红。

## createLlmBackend

```ts
export function createLlmBackend(
  mode: string,
  options: {
    wire: WireProtocol;
    script: readonly FixtureTurn[];
    dumpPath?: string;
  },
): LlmBackend;
```

按 `E2E_LLM_MODE` 选择实现，默认 `fixture` → `FakeProviderBackend`。

## HarnessDriver 启动流程

1. `llmBackend.start()` 拿 base URL / apiKey 与可选 `Redactor`。
2. `createSandbox(profile)`（含 `stripEnv`、代理变量剥离，见 [sandbox.md](./sandbox.md)）。
3. `profile.writeConfig(sandbox, serverSpec)` 写入宿主配置与门槛放行文件。
4. 合并子进程 env。
5. `JsonlProcess` 拉起 `profile.command + profile.headlessArgs(prompt)`。

`sendPrompt` 消费子进程 stdout JSONL，经 `profile.createParser` 归一成 `Observation`；`close` 关进程并清理 sandbox。
启动失败时，driver 在 sandbox 创建后立即登记所有权，并逐阶段尝试停止进程/backend 与清理 sandbox；关闭阶段任一错误会在全部阶段结束后聚合抛出。backend 提供 `Redactor` 时，headless/PTY driver 在暴露异常链、stderr、屏幕、事件和 `Observation` 前统一应用；matrix skip 原因与报告写盘另有同类型 seam 作为末端防线。

## HarnessProfile 关键字段

```ts
export interface HarnessProfile {
  name: string;
  command: string;
  headlessArgs: (prompt: string, ctx: HarnessArgsContext) => string[];
  wire: WireProtocol;
  baseUrlEnv: string;
  apiKeyEnv?: string;
  extraEnv?: Record<string, string>;
  stripEnv: readonly string[];
  sandbox?: HarnessSandboxOptions;
  toolName: (server: string, tool: string) => string;
  toolNamespace?: (server: string) => string;
  writeConfig: (
    sandbox: SandboxContext,
    ctx: WriteConfigContext,
  ) => Promise<void>;
  createParser: () => (
    line: unknown,
  ) => ParsedEvent | readonly ParsedEvent[] | null;
  supportsFixture: boolean;
}
```

`HarnessArgsContext.mode` 为 `"fixture" | "live"`。fixture 专用模型覆盖只能在 fixture 模式加入参数；live 模式应使用真实配置或省略覆盖。具体 profile 由消费者注册，不从 `@x-agent-suite/harness` 内建导出。

Live 响应解析同时接受 LF/CRLF SSE 事件分隔；非流式 Chat Completions 的多个无 `index` 工具调用按数组位置保留。错误原因脱敏除渠道字面量外，还必须包含从 `apiKeyEnv` 或借用钩子解析出的实际凭证。`writeScenarioReports` 接受可选 `redact`，递归清洗 Markdown 与 JSON 的全部字符串，且脱敏后的 `stamp` 必须重新通过安全路径段校验。

`toolName` / `toolNamespace` 必须存在，因为不同宿主向模型暴露的工具命名互不相同。fixture 脚本里只写裸工具名，下发前由 profile 补齐。

不同宿主的工具名形态示例：

| 宿主风格       | 模型侧名字                                      |
| -------------- | ----------------------------------------------- |
| namespace 型   | `namespace: "mcp__<server>"` + `name: "<tool>"` |
| 扁平双下划线型 | `mcp__<server>__<tool>`                         |
| 扁平单下划线型 | `mcp_<server>_<tool>`                           |

## Preflight 测试

目标：验证一个真实 harness 能正常启动、加载被测系统、发起一次工具调用并拿到结果，且不污染真实配置。

断言纪律：**不得依赖退出码或末条文本。** 某些宿主在工具调用失败时仍 exit 0。断言必须落在：

1. 结构化事件的 `status`；
2. 工具的实际返回值；
3. 消费者自定义证据。

preflight 失败时应 **skip 该 harness 的后续 scenario 并记录原因**，而非判红整个套件。

## 文件清单

```text
packages/llm-fixture/src/
├── factory.ts                # createLlmBackend
├── fake-provider.ts          # FakeProviderBackend
├── live.ts                   # LiveBackend
├── live-config.ts            # 私密配置区加载
├── live-credential.ts        # 凭据解析与借用渠道验证
├── live-types.ts             # live 配置公开类型
├── redact.ts                 # secret 归一与结构化脱敏
├── live-wires.ts             # live 请求构造
├── live-parse.ts             # live 响应解析
├── sniff-gate.ts             # 嗅探门禁
├── wire-openai-responses.ts
├── wire-openai-chat.ts
├── wire-anthropic-messages.ts
└── wire-generate-content.ts

packages/harness/src/
├── driver.ts                 # createHarnessDriver
├── backend-context.ts        # backend/sandbox 共享上下文
├── pty-driver.ts             # PTY 长驻 driver
├── pty-io.ts                 # PTY 启动、就绪与回显
├── redaction.ts              # 生命周期错误脱敏
├── mcp-config.ts             # buildMcpServerSpec
└── resolve-command.ts        # resolveHarnessCommand
```

具体 profile 位于消费者仓库；本库测试夹具仅验证契约行为，不属于包的运行时导出。

## 验收标准

- `FakeProviderBackend` 四种 wire 均能在随机 loopback 端口启动并被对应宿主接受。
- 各端临时配置生成正确，含各自的门槛放行项。
- 至少一端 preflight 在 fixture 模式下通过，零 token；断言基于结构化结果。
- 测试结束后临时目录被删除。
- LF/CRLF SSE、多工具非流式响应，以及跨行凭证在异常链、driver 输出、matrix 与报告中的脱敏均有零网络回归测试。
- 任一宿主 preflight 失败时降级为 skip 并记录原因。
