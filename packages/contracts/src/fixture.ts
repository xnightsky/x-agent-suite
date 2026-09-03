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

/** LLM backend 抽象：harness 统一经 start() 拿 base URL 与 dummy API key。 */
export interface LlmBackend {
  /** backend 模式。 */
  readonly mode: LlmBackendMode;
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
