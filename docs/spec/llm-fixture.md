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
  /** 响应前延迟亳秒数；缺省立即响应。用于制造“宿主运行中”窗口等时序场景。 */
  readonly delayMs?: number;
  /** 内容命中：请求体原文包含该字符串时优先使用本轮（先于轮次计数）。 */
  readonly whenText?: string;
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

### 多轮区分与延迟：whenText / delayMs

轮次计数在「多轮对话但后续轮不再新增 tool result」时无法区分轮次（它们携带相同的累计计数）。`whenText` 提供领域中立的内容寻址出口：脚本中首个 `whenText` 被请求体原文包含的轮次优先命中，无命中时退化为轮次计数——不声明 `whenText` 的既有脚本行为完全不变。`delayMs` 在选定轮次后、分发 wire 前统一推迟响应，用于制造「宿主运行中」窗口等时序场景，与 wire 种类无关。两者均为可选修饰，不改变 toolCall/text 恰居其一的校验。

### 端口与网络

- 端口 0 + loopback：某些宿主官方要求非 HTTPS 必须指向 loopback，且随机端口天然支持并发隔离。
- 请求体全量落盘（不截断）。

## LiveBackend

`LiveBackend` 直连私密配置区声明的真实 provider，从响应 usage 提取 token 数供成本估算。显式凭据与 `credential: harness` 互斥；借用凭据前必须再次通过 `borrowChannel` 取得规范渠道，并确认 `wire`、`baseUrl`、`provider` 未被重定向。它在解析渠道和凭据后提供稳定的 `Redactor` seam；transport/解析异常、`Error.cause`、`AggregateError.errors`、stack 和响应载荷在离开 backend 前均递归脱敏。脱敏同时识别任意长度的直接值、URL 归一/编码值及终端跨行值；结构化键碰撞使用无敏感信息的稳定后缀保留全部字段。

`LiveCompleteInput.signal?: AbortSignal` 会经 `buildLiveRequest` 透传到 `LiveRequest.signal`，默认 `createFetchTransport` 再传给 fetch；既有不传 signal 的调用不变。`@x-agent-suite/judge` 的 direct 模式复用这条取消链实现 per-attempt 真超时，borrowed 模式则由消费者 driver 工厂兑现 no-session、工具策略和 close 隔离。direct/borrowed 由通用 TargetTags 决策：唯一候选可自动选择，多候选必须显式 mode/cliRef；`from: harness` / `credential: harness` 只描述来源，不等于 direct 授权，失败不跨模式回退。详见 [judge.md](./judge.md) 与 [target-tags.md](./target-tags.md)。

### live 多模型配置契约

#### 概念与不变量

- **carrier**：宿主 CLI，同时对应 driver/profile 标识；不是套餐。
- **provider**：carrier 下的套餐或连接渠道，包含端点、wire 与凭据来源。
- **model**：provider 下允许本仓选择的模型。
- **target**：一次实际执行或验证的完整身份，即 `(carrier, provider, model)`。用户选择模型时可以省略渠道，但解析结果不得省略。
- `carriers.*.providers.*.models` 是**可选目标目录**，不要求等于宿主全量模型；`carriers.*.default` 是**显式选择该 carrier 后可展开的默认目标集合**。两者分别回答“可以选什么”与“选中该范围后默认展开什么”，default 不是无参数执行授权。
- 宿主自己的默认模型与模型范围设置（例如默认 provider/model、enabled/scoped models）只属于宿主适配层，不在本仓配置中另设 `scope_models` 或全局 `validation_targets`。

#### 配置结构

```yaml
carriers:
  pi:
    from: harness

    # 显式选择该 carrier 时默认展开的目标。
    default:
      - kimi-for-coding
      - deepseek/deepseek-v4-flash

    providers:
      kimi-coding:
        models:
          - kimi-for-coding
          - k3-256k # 可手动选择，但不默认执行。
      deepseek:
        models:
          - deepseek-v4-flash
```

provider 借用结果没有 provider 标识时，配置键仅作为本仓逻辑目录名，不视为端点覆盖；借用凭据仍必须校验 wire/baseUrl 一致。

`default` 支持字符串、目标对象及各自的列表形式：

```ts
type DefaultDeclaration =
  | string
  | string[]
  | { provider: string; model: string }
  | Array<{ provider: string; model: string }>;
```

解析规则：

1. 纯 `model` 字符串只在当前 carrier 的可选目录中查找；归一后必须恰好命中一个 `(provider, model)`，零命中或多命中均为配置错误。
2. `provider/model` 字符串按当前 carrier 已声明的 provider 前缀解析，模型名自身允许包含 `/`。
3. `{ provider, model }` 直接定位目标。所有显式 `default` 目标必须存在于当前 carrier 的可选目录，不得引用其他 carrier 的 provider。
4. 配置加载后，所有写法立即归一为 `Array<{ provider, model }>`；后续执行逻辑不感知输入简写。
5. 显式声明 `default` 会替换宿主默认目标，不与宿主默认目标合并；`default: []` 表示即使显式选中该 carrier 也没有可展开的默认目标，但仍可显式选择可选模型。
6. `from: harness` 且未声明 `default` 时，继承对应 CLI 的默认 `provider + model`，生成一个默认目标。继承目标命中显式目录时必须复用该目录已解析的完整 channel，保留 provider 级端点与凭据声明；provider-less 借用结果按模型归一到唯一逻辑 provider，多个匹配则要求显式 `default`。仅当目标不在目录中时才追加继承渠道。
7. 非 `from: harness` 且未声明 `default` 时，该 carrier 没有默认目标；不得隐式选择第一个或全部模型。

#### 显式选择与范围内默认展开

- 未提供 carrier/provider/model 任何选择参数时直接返回未配置/定义错误；即使配置只有一个 default，也不得隐式执行。
- 只选择 carrier 时，按声明顺序展开该 carrier 的 defaults，可返回多个 target，由调用方逐个编排。
- 选择 provider 时，在已选范围内继续过滤 defaults，不要求必须同时给 model；只给 provider 时可从所有 carrier 的 defaults 过滤，但不追加其他 available/default。
- 显式给出模型与渠道时，从可选目录定位完整 target；渠道必须能唯一确定 `carrier/provider`。只给模型时，完整 `provider/model`（模型名自身可含 `/`）与精确模型匹配优先于模糊匹配；按完整 target 去重后必须唯一，否则返回候选并要求补充渠道。
- 选择优先级固定为：**命令行显式选择 > 已选范围内 `default` > `from: harness` 的 CLI 默认 provider/model > 无默认目标**。任何路径都不允许“无参数执行全部 defaults”。

#### 旧格式兼容与版本

新格式不增加 `v` 字段，按 carrier 下的 `providers` 结构识别；旧单模型格式继续有效，不要求迁移现有 `~/.env.e2e.yaml`：

```yaml
carriers:
  pi:
    from: harness
    provider: kimi-coding
    model: kimi-for-coding
```

旧格式经兼容层归一为一个可选目标和一个默认目标；裸 `from: harness` 继续继承宿主默认 provider/model。同一文件允许不同 carrier 分别使用新旧格式，但同一 carrier 不得同时声明旧 `provider/model` 与新 `providers/default`，否则显式报“新旧格式混用”，不猜测优先级。只有未来删除旧格式或改变同名字段语义时，才需要引入配置版本号。

显式使用旧 `carriers.*.provider/model` 属于**兼容但弃用**：配置加载结果必须提供结构化 warning，由调用入口统一输出；每个旧格式 carrier 每次加载至多一条，不改变执行结果、skip 或退出码，且不得包含 baseUrl、凭据等敏感值。裸 `from: harness`、新格式与 `E2E_LIVE_<CARRIER>_MODEL` 运行覆盖不触发该 warning；新旧格式混用仍是错误而非 warning。旧格式暂无明确移除版本。

### live 单渠道解析优先级

`resolveLiveChannel` 按以下固定顺序解析（高优先级在前）；`resolveLiveTargets` 处理多目标选择，不叠加这些 env 字段覆盖：

1. **env 字段覆盖**：`E2E_LIVE_<CARRIER>_BASE_URL|MODEL|API_KEY|API_KEY_ENV|WIRE`，字段级叠加在文件声明之上（任一字段来自 env，`source` 即记为 `env`）；
2. **显式文件**：`E2E_LIVE_CONFIG_PATH` 指向的 YAML（`source: explicit-path`）；
3. **repo 级**：仓库根 `.env.e2e.yaml`（被 .gitignore 的 `.env*` 规则覆盖；`source: repo-local`）；
4. **home 级**：`~/.env.e2e.yaml`（跨仓库共享的用户级声明；`source: home-dot`）；
5. **历史 home 路径**：`~/.config/x-agent-suite/.env.e2e.yaml`（`source: user-home`）；
6. **宿主默认渠道**：文件内 `from: harness` 声明在 load 阶段经 `borrowChannel` 借用宿主 CLI 自己的 settings（默认 provider/model）；宿主 CLI 的内置 provider（不落盘用户 models 配置的那部分）由 harness 包内的内置注册表快照兜底，`models` 配置中的同名条目恒优先于快照。裸 `from: harness`（不写 wire/baseUrl/model/provider）语义即「整体使用宿主默认渠道」；yaml 显式字段覆盖借用值，未给显式凭据时隐含 `credential: harness`。细节规则：
   - **provider 选择器**：多 provider 宿主可用 `provider` 字段指定借用目标（借该 provider 的渠道与凭据；该字段是借用目标选择器，不再是禁止覆盖的端点字段），缺省借宿主的默认 provider；
   - **model 归属**：选择器与宿主默认 provider 不一致时，宿主默认 model 不保证属于该 provider，借用结果不带 model——此时须由 yaml 显式声明 `model`，否则显式 invalid（不静默猜值）；选择器缺省或恰为默认 provider 时仍可借默认 model；
   - **显式 missing，不回退**：选择器在宿主 `models` 配置与内置注册表快照中均不存在时显式 missing，不回退默认 provider（静默换渠道比报错更糟）；宿主 `models` 配置中同名的用户自定义条目缺 `baseUrl` 时同样显式 missing，不用内置表掩盖写坏的配置（流量可能去了非预期端点）；
   - **baseUrl 归一**：借用的 baseUrl 归一为本框架约定（含版本前缀，如 anthropic-messages 渠道缺 `/v1` 时补上）；仅当发生归一时，宿主原值经 `harnessBaseUrl` 保留，供回写宿主配置（如沙盒 models.json）使用；
7. **代码显式指定**：`new LiveBackend({ channel })` 直接传入完整 `LiveChannel`，构造期旁路上述全部文件/借用解析，适用于极少数需要场景级定点渠道的用例。

1–5 是 `loadLiveConfig` / `resolveLiveChannel` 的文件发现与覆盖链（命中即停）；6 发生在文件声明内部；7 不经过文件链。缺文件、缺 carrier 或借用失败均返回显式「未配置」结果（不抛异常），live 用例据此 skip，不判红。

### live 可选认证文件

`.env.auth.yaml` 是可选的 provider 凭据存储。`.env.e2e.yaml` 可以只声明模型与端点；`loadLiveConfig`、`resolveLiveTargets` 和 TargetTags 加载均不读取认证文件，只有执行前的 `resolveLiveCredential` 才按 provider 解析凭据。

默认通过完全相同的 provider ID 关联（区分大小写）：

```yaml
# .env.e2e.yaml
carriers:
  example-carrier:
    default:
      - provider: provider-a
        model: model-a
    providers:
      provider-a:
        baseUrl: https://provider.example.com/v1
        wire: openai-chat
        models: [model-a]
```

```yaml
# .env.auth.yaml
version: 1
providers:
  provider-a:
    type: api_key
    apiKeyEnv: PROVIDER_A_API_KEY

  # 也支持 apiKey 字面量，但不推荐写入或共享真实 secret。
  provider-b:
    type: api_key
    apiKey: "replace-with-your-secret"
```

每个认证条目必须声明 `type: api_key`，且 `apiKey` / `apiKeyEnv` 必须恰好出现一个。顶层与条目级未知字段、空 provider/key 名、重复 YAML key、错误 version 和其他 type 都是配置错误。v1 不支持 OAuth、`!command` 或 ambient 声明。

多个模型 provider/profile 需要复用同一认证条目时，使用显式 `auth.provider`：

```yaml
# .env.e2e.yaml
carriers:
  example-carrier:
    default:
      - provider: provider-a-account-1
        model: model-a
    providers:
      provider-a-account-1:
        auth:
          provider: shared-provider-auth
        baseUrl: https://provider.example.com/v1
        wire: openai-chat
        models: [model-a]

      provider-a-account-2:
        auth:
          provider: shared-provider-auth
        baseUrl: https://provider.example.com/v1
        wire: openai-chat
        models: [model-a]
```

```yaml
# .env.auth.yaml
version: 1
providers:
  shared-provider-auth:
    type: api_key
    apiKeyEnv: SHARED_PROVIDER_API_KEY
```

`auth.provider` 只选择认证文件条目，不是 TargetTags 的 auth 标签或 OAuth handler。它不得与内联 `apiKey/apiKeyEnv/credential` 同时声明；`from: harness` 使用该绑定时不再隐含 `credential: harness`。

认证文件发现顺序（命中即停，不合并）：

1. `E2E_AUTH_CONFIG_PATH` 显式文件；
2. repo 根 `.env.auth.yaml`；
3. `~/.env.auth.yaml`。

默认文件均不存在表示没有独立认证配置。显式路径不存在、默认路径不可读、YAML/schema 错误均抛 `LiveAuthConfigError`，不得换文件或沿用陈旧秘密快照。

凭据来源优先级（高优先级在前）：

1. `E2E_LIVE_<CARRIER>_API_KEY` / `API_KEY_ENV` 运行时覆盖；
2. `.env.auth.yaml` 中默认同名或 `auth.provider` 指定的条目；
3. `.env.e2e.yaml` 内联 `apiKey/apiKeyEnv/credential: harness`（含 `from: harness` 的既有隐含借用）；
4. 无凭据。

代码显式 `new LiveBackend({ channel })` 没有配置来源标记，继续旁路文件与环境发现。只有来源不存在才向下回退；来源存在但失败不得切换身份：

| 情况 | 结果 |
| --- | --- |
| 默认关联条目不存在 | 回退内联凭据 |
| 显式绑定缺文件或指定条目 | `LiveAuthConfigError`，不回退 |
| runtime/auth 条目环境变量缺值 | required missing；backend 抛未配置错误，sniff 返回 auth 失败，不发无 key 请求 |
| 内联借用失败 | 保留既有 missing，不换身份 |
| 所有来源均不存在 | 允许无凭据请求；需要认证的端点在 sniff/请求阶段失败 |
| 上游返回 401/403 | 不自动换另一凭据来源 |

认证字面量和环境变量解析值统一进入 `redactLiveSecrets`；诊断只保留 runtime/auth-file/model-config/harness 等非秘密来源标签。认证文件不生成 `provider.auth.*` 标签，也不改变 live 审批门禁。完整设计见 [live-auth-config.md](./live-auth-config.md)。

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
├── live-auth-config.ts       # 可选认证文件校验与发现
├── live-channel.ts           # 单渠道校验与借用合并
├── live-targets.ts           # 可选目录、default 与 target 选择
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
