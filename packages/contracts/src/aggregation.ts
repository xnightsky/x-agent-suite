/**
 * @module @x-agent-suite/contracts/aggregation
 * 打分聚合契约：把若干判据的具名结果按声明好的维度规则聚合成一个出口分。
 *
 * 不变量：
 * - 聚合机只做算术，不解释 metric 名的语义，不判定任何事；
 * - 本模块只声明类型，实现由 @x-agent-suite/observation 提供；
 * - 设计权威：docs/spec/scoring-aggregation.md。
 */

/** 维度缺席映射：判据未产出结果时该维如何参与打分。 */
export type AbsentMapping = "zero" | "pass" | "fail";

/** 维度声明：把一个具名判据结果接入聚合机。 */
export interface DimensionSpec {
  /**
   * 引用的判据名（对应 CriterionOutcome.name）。
   * 数组形态表示 OR：任一引用命中即本维命中。
   */
  readonly metric: string | readonly string[];
  /** 权重：命中 +weight / 未命中 −weight。缺省 1。 */
  readonly weight?: number;
  /** true 时本维非命中（含按 absent 映射为 fail）→ 整体 FAIL。缺省 false。 */
  readonly knockout?: boolean;
  /** 缺席映射：zero=中立零出力（不计入 maxScore）/ pass=视为命中 / fail=视为未命中。缺省 "zero"。 */
  readonly absent?: AbsentMapping;
}

/** 聚合声明：一张静态表。 */
export interface AggregationSpec {
  /** 维度列表。 */
  readonly dimensions: readonly DimensionSpec[];
  /** 过线阈值，作用于归一分（可为负的 rawScore/maxScore）。省略时：计入维全部命中且无 knockout 触发才 pass。 */
  readonly threshold?: number;
}

/** 维度三态（absent 为映射前的原始状态）。 */
export type DimensionState = "hit" | "miss" | "absent";

/** 单维结果。 */
export interface DimensionOutcome {
  /** 本维引用的判据名（原样回显声明）。 */
  readonly metric: string | readonly string[];
  /** 映射前三态。 */
  readonly state: DimensionState;
  /** 本维对原始分的贡献（±weight 或 0）。 */
  readonly contribution: number;
  /** 人类可读的本维判定理由。 */
  readonly reason: string;
}

/** 覆盖披露：evaluated = 映射前非缺席维数，total = 声明维数。 */
export interface AggregateCoverage {
  readonly evaluated: number;
  readonly total: number;
}

/** 聚合出口。 */
export interface AggregateResult {
  /** 是否通过：knockout 未触发，且 threshold 存在时 score >= threshold，省略时计入维全部命中。 */
  readonly pass: boolean;
  /** 归一分：rawScore / maxScore，可为负，不截断；maxScore 为 0 时记 0。 */
  readonly score: number;
  /** 原始累加分（不封顶，可为负）。 */
  readonly rawScore: number;
  /** 计入维（hit / miss / absent→pass / absent→fail）权重和。 */
  readonly maxScore: number;
  /** 覆盖披露；不同 coverage 的聚合分不可比。 */
  readonly coverage: AggregateCoverage;
  /** 逐维明细。 */
  readonly dimensions: readonly DimensionOutcome[];
  /** 人类可读的聚合理由；空考（evaluated=0）与未知名引用必须显式点名。 */
  readonly reason: string;
}
