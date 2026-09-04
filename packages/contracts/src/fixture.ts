/**
 * @module @x-agent-suite/contracts/fixture
 * LLM backend 与 fixture 脚本类型：fixture 模式零 token 替代真实 LLM。
 *
 * 不变量：
 * - 本模块只声明契约，不依赖任何运行时；
 * - wire 协议标识为自由字符串，消费者注册 profile 时自行解释。
 */

import type { Redactor } from "./redaction.ts";

/** backend 模式：fixture（自研假端点）或 live（真实 provider）。 */
export type LlmBackendMode = "fixture" | "live";

/**
 * live 渠道的最小结构形状：harness live 分支与 profile.liveEnv/writeConfig 消费。
 * 实现方可携带更多字段（如凭据与成本声明），此处只约束 harness 必需的键。
 */
export interface LlmLiveChannel {
  /** wire 协议标识。 */
  readonly wire: string;
  /** 模型标识。 */
  readonly model: string;
  /** 归一 baseUrl（含版本前缀）。 */
  readonly baseUrl: string;
  /** 宿主 CLI 期望的 baseUrl 原值形态。 */
  readonly harnessBaseUrl?: string;
  /** 凭证模式；"harness" 表示 OAuth 等特殊借用路径。 */
  readonly credential?: string;
}

/** LLM backend 抽象：harness 统一经 start() 拿 base URL 与 dummy API key。 */
export interface LlmBackend {
  /** backend 模式。 */
  readonly mode: LlmBackendMode;
  /**
   * live 模式已解析渠道的结构化品牌：start() 成功后可读，此前为 undefined。
   * 制品化分发下跨包 instanceof 不保证类身份唯一，harness 只经此字段判定 live 渠道；
   * fixture 实现不得声明。
   */
  readonly liveChannel?: LlmLiveChannel;
  /** 可选输出脱敏器；driver 必须在暴露诊断和观测前应用。 */
  readonly redactor?: Redactor;
  /** 启动 backend，返回 harness 应使用的 base URL 与 dummy API key。 */
  start(): Promise<{ readonly baseUrl: string; readonly apiKey: string }>;
  /** 停止 backend 并释放端口；实现必须幂等。 */
  stop(): Promise<void>;
}

/** 端点 wire 协议标识；由消费者自行定义取值，框架不枚举。 */
export type WireProtocol = string;

/** 一轮脚本中要下发的工具调用。 */
export interface FixtureToolCall {
  /** 工具名（宿主侧命名，各端拼法不同）。 */
  readonly name: string;
  /** 命名空间（需要命名空间的协议使用）。 */
  readonly namespace?: string;
  /** 工具入参（将以 JSON 字符串或对象形态下发，取决于 wire）。 */
  readonly args: unknown;
}

/** 一轮脚本：工具调用轮或纯文本收尾轮，二者恰居其一。 */
export interface FixtureTurn {
  /** 该轮要下发的工具调用；缺省表示纯文本收尾。 */
  readonly toolCall?: FixtureToolCall;
  /** 纯文本轮的文本内容。 */
  readonly text?: string;
}

/** Fixture backend 构造选项。 */
export interface FixtureProviderOptions {
  /** 模拟的 wire 协议标识。 */
  readonly wire: WireProtocol;
  /** 按轮次给出脚本；轮次 = 请求体中 tool result 的累计轮数。 */
  readonly script: readonly FixtureTurn[];
  /** 请求体全量落盘路径（append JSONL），用于诊断；缺省不落盘。 */
  readonly dumpPath?: string;
}
