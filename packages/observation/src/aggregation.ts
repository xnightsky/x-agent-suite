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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  at: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(at + " 含未知字段 " + key);
  }
}

function assertMetric(metric: unknown, at: string): void {
  const names = typeof metric === "string" ? [metric] : metric;
  if (!Array.isArray(names) || names.length === 0) {
    throw new TypeError(at + " 必须是非空字符串或非空字符串数组");
  }
  for (let index = 0; index < names.length; index += 1) {
    if (!Object.hasOwn(names, index)) {
      throw new TypeError(at + " 不得包含空洞");
    }
    const name = names[index];
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError(at + " 必须由非空字符串组成");
    }
  }
}

function assertAggregationSpec(spec: unknown): asserts spec is AggregationSpec {
  if (!isPlainRecord(spec)) {
    throw new TypeError("aggregation spec 必须是普通对象");
  }
  assertOnlyFields(spec, ["dimensions", "threshold"], "aggregation spec");
  if (!Array.isArray(spec.dimensions)) {
    throw new TypeError("aggregation spec.dimensions 必须是数组");
  }
  if (spec.threshold !== undefined) {
    if (
      typeof spec.threshold !== "number" ||
      !Number.isFinite(spec.threshold)
    ) {
      throw new TypeError("aggregation spec.threshold 必须是有限数");
    }
  }
  for (let index = 0; index < spec.dimensions.length; index += 1) {
    if (!Object.hasOwn(spec.dimensions, index)) {
      throw new TypeError("aggregation spec.dimensions 不得包含空洞");
    }
    const dim = spec.dimensions[index];
    const at = `aggregation spec.dimensions[${index}]`;
    if (!isPlainRecord(dim)) {
      throw new TypeError(at + " 必须是普通对象");
    }
    assertOnlyFields(dim, ["metric", "weight", "knockout", "absent"], at);
    assertMetric(dim.metric, at + ".metric");
    if (dim.weight !== undefined) {
      if (typeof dim.weight !== "number" || !Number.isFinite(dim.weight)) {
        throw new TypeError(at + ".weight 必须是有限数");
      }
    }
    if (dim.knockout !== undefined && typeof dim.knockout !== "boolean") {
      throw new TypeError(at + ".knockout 必须是 boolean");
    }
    if (
      dim.absent !== undefined &&
      dim.absent !== "zero" &&
      dim.absent !== "pass" &&
      dim.absent !== "fail"
    ) {
      throw new TypeError(at + ".absent 必须是 zero/pass/fail");
    }
  }
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

/** 收集所有未产出任何结果的引用名（供 reason 点名，发现拼写错误）。 */
function collectAbsentNames(
  spec: AggregationSpec,
  outcomes: readonly CriterionOutcome[],
): string[] {
  const present = new Set(outcomes.map((outcome) => outcome.name));
  const names: string[] = [];
  for (const dim of spec.dimensions) {
    const refs = typeof dim.metric === "string" ? [dim.metric] : dim.metric;
    for (const name of refs) {
      if (!present.has(name)) names.push(name);
    }
  }
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
  assertAggregationSpec(spec);
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
  const reason = buildReason(pass, knockoutHit, coverage, spec, outcomes);
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
  outcomes: readonly CriterionOutcome[],
): string {
  const parts = [
    `${pass ? "通过" : "未通过"}；coverage ${coverage.evaluated}/${coverage.total}`,
  ];
  if (knockoutHit) parts.push("knockout 维度未命中，整体否决");
  if (coverage.evaluated === 0)
    parts.push("无在场维度（空考，分数不代表能力）");
  const absentNames = collectAbsentNames(spec, outcomes);
  if (absentNames.length > 0) {
    parts.push(`无判据结果的引用：${absentNames.join("、")}`);
  }
  return parts.join("；");
}
