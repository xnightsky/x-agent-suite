# 通用契约

x-agent-suite 通过 `@x-agent-suite/contracts` 暴露框架与 consumer 之间的全部接缝。本包不依赖任何运行时，只导出类型与轻量契约类型。

## 设计原则

- 本包不认识任何具体被测系统。
- 具体 driver / profile / 判据 / 场景由消费者注册。
- 领域特有需求通过 `metadata` / `evidence` / `provision` / `driverOptions` 等自由区表达。

## Observation

所有 driver 统一返回 `Observation`，不保留两套类型。

```ts
export interface ToolCall {
  name: string;
  input: unknown;
  output?: unknown;
  /** 宿主侧报告的调用结果状态；断言必须以此为准 */
  status: "completed" | "failed";
}

export interface Observation {
  /** 原始文本输出 */
  text: string;
  /** 该轮内发生的工具调用（含入参） */
  toolCalls: ToolCall[];
  /** 模型轮数（不是工具调用数） */
  steps?: number;
  /** 工具调用总数 */
  toolCallsCount: number;
  /** 是否撞步数/预算上限 */
  exhausted?: boolean;
  /** token 用量 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 耗时 */
  latencyMs: number;
  /** carrier 标识 */
  carrier: string;
  /** 底层事件流 */
  events: DriverEvent[];
}
```

关键纪律：`steps` 与 `toolCallsCount` 必须分开。早期把「工具调用数」当成「模型轮数」会导致误判。

`status` 字段用于区分「调用过」与「调用成功」。某些宿主在工具调用失败时仍 exit 0，因此断言必须落在 `ToolCall.status` 与消费者自定义证据上。

### `exhausted` 与领域失败的区别

- `exhausted === true`：这次跑不算数（进程崩了、启动失败、全局超时、撞步数上限）。
- `exhausted === false` 但判据 fail：被测系统确实没做对。

报告必须能分开这两类，否则环境抖动会被记成能力退化。

## 失败类别

框架内建失败类别全部与领域无关：

| 前缀         | 含义                              |
| ------------ | --------------------------------- |
| `payload`    | driver 未返回可解析的 Observation |
| `driver-env` | driver 启动或环境准备失败         |
| `timeout`    | 会话或单轮等待超时被中断          |
| `config`     | 场景声明缺失，判据无法判定        |

领域自有的类别（如「某插件未注入，场景前提不成立」）由 consumer 自行注册前缀。框架只做分类统计，不认识语义。详见 [boundary-discipline.md](./boundary-discipline.md)。

## Driver 契约

### AgentDriver

一次性或短进程驱动接口。

```ts
export interface AgentDriver {
  start(): Promise<void>;
  sendPrompt(text: string): Promise<Observation>;
  events(): AsyncIterable<DriverEvent>;
  close(reason?: string): Promise<void>;
}
```

### LongLivedAgentDriver

长驻会话驱动：在同一会话上多轮注入 prompt，并观测入站事件。

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

`injectMode` 必须由 profile 固定声明，运行时不得切换，否则同一输入的处理顺序不可复现。

### `close()` 的平台条件语义

`close()` 的实现必须清理**整个进程树**，不是仅 session leader。**但「优雅」是平台条件的**：

| 平台  | `close()` 语义                | 后果                                       |
| ----- | ----------------------------- | ------------------------------------------ |
| POSIX | SIGTERM → 宽限期 → SIGKILL    | 被测进程有机会写完产物                     |
| Win32 | 直接 force kill，**无宽限期** | 产物可能不全，**必须在 `metadata` 上留痕** |

不留痕的话，判据会把「进程被强杀导致产物不全」误读成「被测系统没产出」。

## HarnessProfile

一个宿主 CLI 的适配档案。消费者注册时提供以下字段：

```ts
export interface HarnessProfile {
  name: string;
  command: string;
  /** context.mode 区分 fixture 与 live，live 不得继承 fixture 专用覆盖参数 */
  headlessArgs: (prompt: string, context: HarnessArgsContext) => string[];
  ptyArgs?: (context: PtyArgsContext) => string[];
  wire: WireProtocol;
  baseUrlEnv: string;
  apiKeyEnv?: string;
  extraEnv?: Record<string, string>;
  stripEnv: readonly string[];
  sandbox?: {
    configDirs?: readonly string[];
    configFile?: boolean;
    runtimeDir?: boolean;
  };
  toolName: (server: string, tool: string) => string;
  toolNamespace?: (server: string) => string;
  writeConfig: (
    sandbox: SandboxContext,
    context: WriteConfigContext,
  ) => Promise<void>;
  createParser: () => (
    line: unknown,
  ) => ParsedEvent | readonly ParsedEvent[] | null;
  supportsFixture: boolean;
  configDirEnv?: { env: string; sandboxDir: string };
  win32?: { globalPackage: string; binPath: string };
  installPlugins?: (
    sandbox: SandboxContext,
    plugins: readonly unknown[],
  ) => Promise<void>;
}
```

框架不内建或枚举具体 profile。消费者用 `sandbox` 声明所需目录/文件能力；driver 只创建并透传，不解释目录名。单个结构化输入可能包含并行工具结果，因此 parser 必须能一次返回多个 `ParsedEvent`，driver 会保持顺序全部聚合。

`toolName` / `toolNamespace` 必须存在，因为不同宿主向模型暴露的工具命名互不相同。fixture 脚本里只写裸工具名，下发前由 profile 补齐。

## Provision Hook

物化领域 fixture 的合法出口。框架只调用，不解释其语义。

```ts
type ProvisionHook = (context: {
  workspace: string;
  scenarioId: string;
  spec: unknown; // 场景 provision 块原文，框架不解析
}) => Promise<ProvisionResult> | ProvisionResult;
```

返回值三部分：

| 字段       | 用途                                                  |
| ---------- | ----------------------------------------------------- |
| `env`      | 并入 driver 环境的变量                                |
| `metadata` | 并入 Observation / SessionObservation 的证据字段      |
| `evidence` | 销毁前采集规格：键为字段名，值为相对 workspace 的路径 |

框架按 `evidence` 声明在 cleanup 前快照文件内容，**不解释键名**。产物内容、游标文件在 workspace 销毁后不可复得，采集时机因此是硬约束。

## Scenario 与 Criterion

Scenario 是「给宿主一个 prompt，观察它如何调用被测系统」的完整用例。Criterion 是评分逻辑。

```ts
export interface ScenarioSpec {
  id: string;
  prompts: readonly string[];
  expected: unknown;
  metadata?: Record<string, unknown>;
}
```

Criterion 分为：

- **TurnCriterion**：单轮 Observation 的评分。
- **SessionCriterion**：多轮聚合后的评分。

```ts
export interface TurnCriterion {
  readonly name: string;
  check(ctx: TurnCriterionContext): CriterionResult;
}
```

## Registry

消费者通过注册表把 driver、profile、criterion、scenario 接入框架：

```ts
export interface Registry {
  registerDriver(spec: DriverRegistration): void;
  registerProfile(spec: RegisterProfile): void;
  registerCriterion(spec: RegisterCriterion): void;
  registerScenario(spec: RegisterScenario): void;
}
```

注册表机制让框架保持领域中立：框架内不枚举任何具体宿主或判据。

`DriverRegistration` 的长驻三件套（`injectMode`/`inject`/`inbound`/`waitInbound`）是判别联合：要么齐全要么全无，半套声明在编译期即被拒绝，不依赖运行时校验。class 实现方应 `implements` 具体分支（如 `LongLivedDriverRegistration`），不能 `implements` 联合本身（TS2422）；对象字面量直传 `registerDriver` 不受影响。

## 变更纪律

契约是跨 consumer 的接缝，改动会波及全部消费者。

- v0 期契约标记 **unstable**，允许 breaking change。**不得为兼容性提前绑手**——那是这个阶段最大的浪费。
- 新增字段前先问：**第二个 consumer 是否也需要？** 只有一个需要就走 `metadata` 自由区，不加字段。
- `metadata` 的定义是「框架只透传不解释」。因此 **框架自己的调度或聚合逻辑需要读的字段，不能放进 `metadata`**——放进去，这个出口就从「领域自由区」退化成「杂物间」，边界随之失真。

## 验收标准

- `packages/contracts/src/index.ts` 导出全部契约，且本包无任何运行时依赖。
- 所有 driver 实现返回统一的 `Observation`。
- 长驻 driver 的 `injectMode` 在 profile 中声明，运行时不可切换。
- 工具名由 `HarnessProfile` 补齐，fixture 脚本不硬编码宿主命名。
