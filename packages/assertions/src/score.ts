/**
 * @module @x-agent-suite/assertions/score
 * 通用断言直接分值：封闭配置、独立默认与 pass → contribution；不改 Criterion.score。
 */

/** 可选直接分值配置；省略项由 assertionContribution 独立应用默认值。 */
export interface AssertionScoreConfig {
  readonly hit?: number;
  readonly miss?: number;
}

/** 插件从自己的原始 expect 协议同步解析分值配置。 */
export type AssertionScoreResolver = (expect: unknown) => AssertionScoreConfig;

/** 通用断言贡献细项；与 0..1 的 CriterionOutcome 分离。 */
export interface AssertionDetail {
  readonly name: string;
  readonly source: "mechanical" | "ai";
  readonly pass: boolean;
  readonly reason: string;
  readonly score: number;
}

/** 校验同步普通 score 记录；拒绝 Promise、额外字段与非有限数。 */
export function parseAssertionScore(
  value: unknown,
  path = "assertion score",
): AssertionScoreConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(path + " 必须是同步普通对象");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(path + " 必须是同步普通对象");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "hit" && key !== "miss") {
      throw new Error(path + " 含未知字段 " + key);
    }
  }
  for (const key of ["hit", "miss"] as const) {
    const score = record[key];
    if (
      score !== undefined &&
      (typeof score !== "number" || !Number.isFinite(score))
    ) {
      throw new Error(path + "." + key + " 必须是有限数");
    }
  }
  return {
    ...(record.hit !== undefined ? { hit: record.hit as number } : {}),
    ...(record.miss !== undefined ? { miss: record.miss as number } : {}),
  };
}

/** 按固定直接算法计算贡献；hit=1 与 miss=-1 的默认值互不影响。 */
export function assertionContribution(
  pass: boolean,
  score?: AssertionScoreConfig,
): number {
  return pass ? (score?.hit ?? 1) : (score?.miss ?? -1);
}
