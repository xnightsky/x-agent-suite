/**
 * @module @x-agent-suite/contracts/dsl
 * 场景 DSL：消费者声明「送什么、期望什么」的唯一格式。
 *
 * 不变量：
 * - kit 不认识任何具体 metric 名，也不校验 expect 值的形状；
 * - 哪些键合法，由消费者注册了哪些判据决定；
 * - 领域特有需求通过 `metadata` / `provision` / `driverOptions` 自由区表达。
 */

/**
 * expect 块：键为 metric 名，值原样透传给同名判据。
 *
 * 本库不预置任何 metric，因此也不校验值的形状——校验属于判据自己的职责。
 */
export type ExpectBlock = Record<string, unknown>;

/** 单轮脚本。 */
export interface TurnSpec {
  /** 本轮送入被测系统的内容。 */
  readonly send: string;
  /**
   * 本轮的完成条件。v1 只有 'idle'（等被测系统回到空闲）。
   * 保留字段是为了让后续版本自定义等待条件不必改 schema。
   */
  readonly waitFor?: "idle";
  /** 本轮等待上界，覆盖场景级默认值。 */
  readonly timeoutMs?: number;
  /** 本轮判据。省略即本轮不判。 */
  readonly expect?: ExpectBlock;
}

/** 场景声明。 */
export interface ScenarioSpec {
  /** 全局唯一，惯例为 `<domain>/<name>`。 */
  readonly id: string;
  /** 兼容的 driver id 白名单。省略表示全部兼容。 */
  readonly drivers?: string[];
  /** 兼容的 driver profile 白名单。省略表示全部兼容。 */
  readonly profiles?: string[];
  /**
   * 领域 fixture 声明，原样交给 provision hook。
   * kit 不解析其内容。
   */
  readonly provision?: unknown;
  /** 原样交给 driver 的选项（如步数上界）。kit 不解析。 */
  readonly driverOptions?: Record<string, unknown>;
  /** 轮次脚本。至少一轮。 */
  readonly turns: TurnSpec[];
  /** 会话终态判据。 */
  readonly expect?: ExpectBlock;
  /** 场景级等待上界默认值。 */
  readonly timeoutMs?: number;
  /** 领域自由区（分类标签、说明、优先级……）。kit 只透传进报告。 */
  readonly metadata?: Record<string, unknown>;
}
