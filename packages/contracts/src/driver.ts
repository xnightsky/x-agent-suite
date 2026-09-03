/**
 * @module @x-agent-suite/contracts/driver
 * AgentDriver、HarnessProfile、HarnessDriver 等驱动与 harness 适配层公共类型。
 *
 * 不变量：
 * - 本模块只声明契约，不依赖任何运行时；
 * - profile 字段保持通用，具体 CLI 的专有逻辑由消费者在注册时提供；
 * - tool_call 事件的 payload 必须是完整 ToolCall（含 status），断言只认 status。
 */

import type { DriverEvent, Observation } from "./observation.ts";
import type { Redactor } from "./redaction.ts";
import type { SandboxContext } from "./sandbox.ts";
import type { WireProtocol } from "./fixture.ts";

/** 入站事件：外部消息到达本会话所触发的可观测信号。 */
export interface InboundEvent {
  /** 事件类别：notification / tool_call / tool_result。 */
  readonly kind: "notification" | "tool_call" | "tool_result";
  /** 事件发生时间（epoch 毫秒）。 */
  readonly timestamp: number;
  /** 宿主原始载荷（未归一化，供诊断）。 */
  readonly payload: unknown;
}

/** 注入语义：外部 prompt 相对当前流式状态的投递时机。 */
export type InjectMode = "steer" | "followUp";

/**
 * 跨端 agent 驱动接口：用宿主进程（或 mock）驱动一端 session。
 *
 * @behavior agent-driver-contract
 * Given: 调用方持有任意 AgentDriver 实现。
 * When: 依次调用 start / sendPrompt / events / close。
 * Then: start 就绪后 resolve；sendPrompt 返回结构化 Observation；
 *       events 按序产出底层事件；close 幂等，关闭后 sendPrompt 显式抛错。
 * Failure: 所有失败以带上下文的 Error 显式 reject，禁止静默吞错。
 */
export interface AgentDriver {
  /** 可选输出脱敏器；编排层写入诊断前应应用。 */
  readonly redactor?: Redactor;
  /** 拉起宿主（或 mock），就绪后 resolve；重复调用语义由实现声明。 */
  start(): Promise<void>;
  /** 发送一条用户 prompt，返回结构化观测结果。 */
  sendPrompt(text: string): Promise<Observation>;
  /** 按序暴露底层事件流；close 后迭代结束。 */
  events(): AsyncIterable<DriverEvent>;
  /** 幂等关闭；reason 仅作诊断记录。 */
  close(reason?: string): Promise<void>;
}

/**
 * 长驻会话驱动：在同一会话上多轮注入 prompt，并观测入站事件。
 *
 * @behavior long-lived-driver-contract
 * Given: 调用方持有任意 LongLivedAgentDriver 实现且已 start。
 * When: 多次调用 inject / 消费 inbound / 调用 close。
 * Then: 会话跨多次 inject 保持存活；inbound 按序产出入站事件；
 *       close 幂等，关闭后 inject 显式抛错。
 */
export interface LongLivedAgentDriver extends AgentDriver {
  /** 本 driver 固定使用的注入语义；实现必须声明，不得运行时切换。 */
  readonly injectMode: InjectMode;
  /** 向存活会话注入一条 prompt；返回该轮的结构化结果。 */
  inject(text: string): Promise<Observation>;
  /** 按序暴露入站事件流；close 后迭代结束。 */
  inbound(): AsyncIterable<InboundEvent>;
  /** 等待满足条件的入站事件，超时显式抛错（禁止静默返回）。 */
  waitInbound(
    match: (event: InboundEvent) => boolean,
    timeoutMs: number,
  ): Promise<InboundEvent>;
}

/** parser 产出的未盖戳事件；driver 补 timestamp 后成为 DriverEvent。 */
export interface ParsedEvent {
  /** 事件类别："text" / "tool_call" / "result" / 宿主自定义。 */
  readonly type: string;
  /** 事件载荷：tool_call 为 ToolCall，text 为 { text: string }，result 为宿主结果摘要。 */
  readonly payload?: unknown;
}

/** 外部 server 进程的 spawn 描述（写入各宿主配置）。 */
export interface ServerSpawnSpec {
  /** 可执行命令（通常为 Node.js 可执行文件）。 */
  readonly command: string;
  /** 参数（含加载器与入口脚本路径）。 */
  readonly args: readonly string[];
  /** 注入 server 进程的环境变量。 */
  readonly env?: Record<string, string>;
}

/** headless 模式参数的上下文。 */
export interface HarnessArgsContext {
  /** 当前运行模式；profile 可据此避免把 fixture 专用参数带入 live。 */
  readonly mode: "fixture" | "live";
  /** 独立配置文件路径（config 文件型宿主使用）。 */
  readonly configFilePath?: string;
  /** 模型侧允许使用的工具白名单。 */
  readonly allowedTools: readonly string[];
}

/** profile 创建 sandbox 时需要的通用目录与文件能力。 */
export interface HarnessSandboxOptions {
  /** 需在临时 HOME 下创建的命名配置目录。 */
  readonly configDirs?: readonly string[];
  /** 是否创建独立配置文件。 */
  readonly configFile?: boolean;
  /** 是否创建运行时目录。 */
  readonly runtimeDir?: boolean;
}

/** PTY 启动参数上下文。 */
export interface PtyArgsContext {
  /** 工作目录（通常为沙箱 cwd）。 */
  readonly cwd: string;
  /** 额外工作区目录（需要时由 profile 自行解释）。 */
  readonly addDir?: string;
}

interface WriteConfigBase {
  /** 配置中的 server 名。 */
  readonly serverName?: string;
  /** 端点 base URL（不含版本后缀，各 profile 自行拼接）。 */
  readonly baseUrl: string;
  /** dummy API key；live 模式下为借用的真实凭证。 */
  readonly apiKey: string;
  /** live 模式：真实渠道信息（fixture 模式缺省）；具体形状由消费者定义。 */
  readonly live?: unknown;
}

/** writeConfig 上下文：plugin-only 明确不携带 reference server spawn 描述。 */
export type WriteConfigContext = WriteConfigBase &
  (
    | { readonly injectServer: false; readonly server?: never }
    | { readonly injectServer?: true; readonly server: ServerSpawnSpec }
  );

/** 一个宿主 CLI 的适配档案。 */
export interface HarnessProfile {
  /** profile 名。 */
  readonly name: string;
  /** CLI shim 名。 */
  readonly command: string;
  /** headless 模式参数；prompt 的位置各端不同。 */
  readonly headlessArgs: (
    prompt: string,
    context: HarnessArgsContext,
  ) => string[];
  /**
   * PTY 模式启动参数；不声明则本 profile 不支持 PTY 驱动。
   * 与 headlessArgs 互斥：PTY 模式下 prompt 由 driver 在运行时写入 stdin，不在 argv 中。
   */
  readonly ptyArgs?: (context: PtyArgsContext) => string[];
  /** PTY 模式下使用的可执行命令；缺省回退到 `command`。 */
  readonly ptyCommand?: string;
  /** TUI 就绪提示符正则；PTY driver start 后等待该内容。 */
  readonly ptyReadyPattern?: RegExp;
  /** 输入提示符正则；用于光标回到提示符判定。 */
  readonly ptyPromptPattern?: RegExp;
  /** 需要从屏幕差异比较中剔除的 spinner/动画正则列表。 */
  readonly ptyIdlePatterns?: RegExp[];
  /**
   * PTY 启动后可能弹出的初始交互对话框处理序列。
   * 按顺序检查：屏幕匹配正则时写入对应按键序列，然后继续等待 ptyReadyPattern。
   */
  readonly ptySetupSequence?: readonly {
    readonly match: RegExp;
    readonly input: string;
    readonly description: string;
  }[];
  /** 端点 wire 协议标识；由消费者注册时声明，框架不枚举取值。 */
  readonly wire: WireProtocol;
  /** base URL 环境变量名；空串表示走配置文件而非环境变量。 */
  readonly baseUrlEnv: string;
  /** API key 环境变量名。 */
  readonly apiKeyEnv?: string;
  /** 额外必需环境变量。 */
  readonly extraEnv?: Record<string, string>;
  /** 要从子进程剥离的变量。 */
  readonly stripEnv: readonly string[];
  /** profile 所需的 sandbox 目录与文件能力；框架只按声明创建，不解释名称。 */
  readonly sandbox?: HarnessSandboxOptions;
  /** 模型侧可见的工具名：由 server 名与裸工具名拼出。 */
  readonly toolName: (server: string, tool: string) => string;
  /** 命名空间函数；需要命名空间的 profile 可声明。 */
  readonly toolNamespace?: (server: string) => string;
  /** 写宿主配置与门槛放行文件。 */
  readonly writeConfig: (
    sandbox: SandboxContext,
    context: WriteConfigContext,
  ) => Promise<void>;
  /** live 模式下追加注入的环境变量；返回空串值的键会被 driver 丢弃。 */
  readonly liveEnv?: (context: {
    readonly channel: unknown;
    readonly apiKey: string;
  }) => Record<string, string>;
  /** 创建 JSONL 行解析器；单行可归一成零个、一个或多个事件。 */
  readonly createParser: () => (
    line: unknown,
  ) => ParsedEvent | readonly ParsedEvent[] | null;
  /** 是否支持 fixture 模式。 */
  readonly supportsFixture: boolean;
  /** 隔离支点环境变量：剥离后由 driver 重新注入，指向 sandbox 内对应目录。 */
  readonly configDirEnv?: { readonly env: string; readonly sandboxDir: string };
  /** win32 脚本 shim 的入口推导（原生 exe 型 CLI 不声明）。 */
  readonly win32?: { readonly globalPackage: string; readonly binPath: string };
  /**
   * 宿主插件机制的安装实现；不声明则本 profile 不支持插件安装。
   * driver 在写配置之后、拉起 CLI 之前调用。
   */
  readonly installPlugins?: (
    sandbox: SandboxContext,
    plugins: readonly unknown[],
  ) => Promise<void>;
}

/** 一次性 headless harness 驱动：每次 sendPrompt 拉起一个短进程。 */
export interface HarnessDriver extends AgentDriver {
  /** 本 driver 使用的 profile。 */
  readonly profile: HarnessProfile;
  /** 本 driver 的隔离沙箱（start 后可用）。 */
  readonly sandbox: SandboxContext;
  /** 最近一次 sendPrompt 进程的 stderr 尾部（失败诊断用；无则空串）。 */
  stderrTail(): string;
}
