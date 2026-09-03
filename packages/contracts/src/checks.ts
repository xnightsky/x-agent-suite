/**
 * @module @x-agent-suite/contracts/checks
 * 评分层检查契约：hard 期望与列举类核对。
 *
 * 不变量：
 * - 本模块只声明类型，不导出具体检查函数（函数由各实现包按需复刻）；
 * - hard 断言只落在 ToolCall.status 与结构化入参上，不看退出码与末条文本。
 */

/** hard 层的工具调用期望。 */
export interface HardExpectation {
  /** 期望被调用的工具裸名（按末段匹配，兼容命名空间前缀）。 */
  readonly tool: string;
  /**
   * 单工具 action 分派形态下的 action 期望：
   * 仅统计 input.action 精确等于该值的调用。
   */
  readonly action?: string;
  /** 入参约束：每个键值对必须出现在该次调用的 input 中（值做 JSON 相等比较）。 */
  readonly args?: Record<string, unknown>;
}

/** 列举类核对配置。 */
export interface EnumerateCheck {
  /** 从输出文本抽取 id 的正则（必须带 g 标志，逐一 matchAll）。 */
  readonly extract: RegExp;
  /** true 时同时核对「存在但没列出来」的遗漏。 */
  readonly requireComplete: boolean;
}

/** 列举类核对结果。 */
export interface EnumerateResult {
  /** 列出来但实际不存在的 id。 */
  readonly hallucinated: string[];
  /** 存在但没列出来的 id（requireComplete=true 时检查）。 */
  readonly missing: string[];
}
