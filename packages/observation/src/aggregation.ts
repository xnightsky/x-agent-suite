/**
 * @module @x-agent-suite/observation/aggregation
 * 打分聚合机：把判据的具名结果按维度声明聚合成一个出口分（纯函数，零依赖）。
 *
 * 不变量：
 * - 只做算术，不解释 metric 名语义，不判定任何事（判据已产出判定）；
 * - knockout 短路优先于累加与 threshold；缺席经 absent 映射后才参与；
 * - 归一分不截断，负分原样出口；coverage 强制披露，不同 coverage 的分不可比。
 * 设计权威：docs/spec/scoring-aggregation.md。
 */

import type {
  AbsentMapping,
  AggregateResult,
  AggregationSpec,
  CriterionOutcome,
  DimensionOutcome,
  DimensionSpec,
  DimensionState,
} from "@x-agent-suite/contracts";

/** 缺省权重：对齐业界通用语义（不熟打分配置的人不写权重也应得到合理打分）。 */
const DEFAULT_WEIGHT = 1;
/** 缺省缺席映射：中立零出力。 */
const DEFAULT_ABSENT: AbsentMapping = "zero";

/** 单维判定结果：对外明细 + 内部计分所需的归一字段。 */
interface ResolvedDimension {
  readonly outcome: DimensionOutcome;
  /** 映射后是否视为命中。 */
  readonly effectiveHit: boolean;
  /** 是否计入 maxScore（hit / miss / absent→pass / absent→fail）。 */
  readonly participating: boolean;
  readonly weight: number;
}

/** 求单个 metric 名的映射前三态：名下全过为 hit，有结果为 miss，无结果为 absent。 */
function stateOfMetric(
  name: string,
  outcomes: readonly CriterionOutcome[],
): DimensionState {
  const owned = outcomes.filter((outcome) => outcome.name === name);
  if (owned.length === 0) return "absent";
  return owned.every((outcome) => outcome.pass) ? "hit" : "miss";
}

/** 求维度（含 OR 数组）的映射前三态。 */
function stateOfDimension(
  metric: DimensionSpec["metric"],
  outcomes: readonly CriterionOutcome[],
): DimensionState {
  const names = typeof metric === "string" ? [metric] : metric;
  const states = names.map((name) => stateOfMetric(name, outcomes));
  if (states.includes("hit")) return "hit";
  // OR 语义：任一引用有结果即按已考处理；全部无结果才算缺席。
  return states.includes("miss") ? "miss" : "absent";
}

/** 把缺席状态按映射折算成「是否视为命中 / 是否计入 / 贡献」。 */
function applyAbsentMapping(
  absent: AbsentMapping,
  weight: number,
): Pick<ResolvedDimension, "effectiveHit" | "participating"> & {
  contribution: number;
} {
  switch (absent) {
    case "pass":
      return { effectiveHit: true, participating: true, contribution: weight };
    case "fail":
      return {
        effectiveHit: false,
        participating: true,
        contribution: -weight,
      };
    default:
      return { effectiveHit: false, participating: false, contribution: 0 };
  }
}

/** 归一一个维度：三态 → absent 映射 → 贡献与计入口径。 */
function resolveDimension(
  dim: DimensionSpec,
  outcomes: readonly CriterionOutcome[],
): ResolvedDimension {
  const weight = dim.weight ?? DEFAULT_WEIGHT;
  const state = stateOfDimension(dim.metric, outcomes);
  const mapped =
    state === "absent"
      ? applyAbsentMapping(dim.absent ?? DEFAULT_ABSENT, weight)
      : {
          effectiveHit: state === "hit",
          participating: true,
          contribution: state === "hit" ? weight : -weight,
        };
  const reason =
    state === "absent"
      ? `缺席（无判据结果），按 absent=${dim.absent ?? DEFAULT_ABSENT} 映射`
      : state === "hit"
        ? "命中"
        : "未命中";
  return {
    outcome: {
      metric: dim.metric,
      state,
      contribution: mapped.contribution,
      reason,
    },
    effectiveHit: mapped.effectiveHit,
    participating: mapped.participating,
    weight,
  };
}

/** 收集所有映射前缺席的引用名（供 reason 点名，发现拼写错误）。 */
function collectAbsentNames(
  spec: AggregationSpec,
  resolved: readonly ResolvedDimension[],
): string[] {
  const names: string[] = [];
  spec.dimensions.forEach((dim, index) => {
    if (resolved[index]!.outcome.state !== "absent") return;
    const refs = typeof dim.metric === "string" ? [dim.metric] : dim.metric;
    names.push(...refs);
  });
  return [...new Set(names)];
}

/**
 * 聚合入口：判据结果 + 静态声明 → 出口分。
 * 判定顺序：knockout 短路 → 累加 → threshold / 缺省 pass 规则。
 */
export function resolveAggregate(
  outcomes: readonly CriterionOutcome[],
  spec: AggregationSpec,
): AggregateResult {
  const resolved = spec.dimensions.map((dim) =>
    resolveDimension(dim, outcomes),
  );
  const knockoutHit = resolved.some(
    (dim, index) =>
      spec.dimensions[index]!.knockout === true && !dim.effectiveHit,
  );
  const participants = resolved.filter((dim) => dim.participating);
  const rawScore = resolved.reduce(
    (sum, dim) => sum + dim.outcome.contribution,
    0,
  );
  const maxScore = participants.reduce((sum, dim) => sum + dim.weight, 0);
  const score = maxScore > 0 ? rawScore / maxScore : 0;
  const coverage = {
    evaluated: resolved.filter((dim) => dim.outcome.state !== "absent").length,
    total: spec.dimensions.length,
  };
  const pass = knockoutHit
    ? false
    : spec.threshold !== undefined
      ? score >= spec.threshold
      : participants.every((dim) => dim.effectiveHit);
  const reason = buildReason(pass, knockoutHit, coverage, spec, resolved);
  return {
    pass,
    score,
    rawScore,
    maxScore,
    coverage,
    dimensions: resolved.map((dim) => dim.outcome),
    reason,
  };
}

/** 组装人类可读的聚合理由；空考与未知名引用必须显式点名。 */
function buildReason(
  pass: boolean,
  knockoutHit: boolean,
  coverage: { evaluated: number; total: number },
  spec: AggregationSpec,
  resolved: readonly ResolvedDimension[],
): string {
  const parts = [
    `${pass ? "通过" : "未通过"}；coverage ${coverage.evaluated}/${coverage.total}`,
  ];
  if (knockoutHit) parts.push("knockout 维度未命中，整体否决");
  if (coverage.evaluated === 0)
    parts.push("无在场维度（空考，分数不代表能力）");
  const absentNames = collectAbsentNames(spec, resolved);
  if (absentNames.length > 0) {
    parts.push(`无判据结果的引用：${absentNames.join("、")}`);
  }
  return parts.join("；");
}
