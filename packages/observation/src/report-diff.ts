/**
 * @module @x-agent-suite/observation/report-diff
 * 报告 diff 原语：对比两份 JSON 报告，产出维度级变化清单。
 *
 * 不变量：
 * - 纯函数、泛型于 Artifact；聚合分与维度状态经 lens 注入提取（报告形状泛型，
 *   维度语义属于 artifact 的生产者）；
 * - 只报告变化，无变化的字段不出现在结果里；
 * - 场景 id 不一致显式抛错（比错对象是配置错误）。
 */

import type { ReportDocument } from "@x-agent-suite/contracts";

/** diff 镜头：从消费者 artifact 形状中提取可对比视图。 */
export interface ReportDiffLens {
  /** 提取聚合分；无聚合返回 undefined。 */
  readonly score?: (artifact: unknown) => number | undefined;
  /** 提取维度状态列表（metric + state）；无聚合返回空。 */
  readonly dimensions?: (
    artifact: unknown,
  ) => readonly { readonly metric: string; readonly state: string }[];
}

/** 单字段前后值对。 */
export interface FieldChange<T> {
  readonly before: T;
  readonly after: T;
}

/** 一个场景报告的维度级变化清单（只含变化项）。 */
export interface ScenarioReportDiff {
  /** 场景 id。 */
  readonly scenario: string;
  /** hardPass 翻转。 */
  readonly hardPass?: FieldChange<boolean>;
  /** 聚合分变化（lens 提供且两侧都有分时）。 */
  readonly score?: FieldChange<number> & { readonly delta: number };
  /** 维度状态迁移（仅状态变化的维度）。 */
  readonly dimensions: readonly {
    readonly metric: string;
    readonly before: string;
    readonly after: string;
  }[];
  /** 稳定率变化（两侧都有 repeat 统计时）。 */
  readonly hardPassRate?: FieldChange<number>;
  /** 是否存在任何变化。 */
  readonly changed: boolean;
}

/** 对比两份同场景报告；lens 缺省时只对比契约层字段。 */
export function diffScenarioReports(
  before: ReportDocument,
  after: ReportDocument,
  lens?: ReportDiffLens,
): ScenarioReportDiff {
  if (before.scenario !== after.scenario) {
    throw new Error(`报告场景不一致：${before.scenario} vs ${after.scenario}`);
  }
  const beforeRow = before.rows[0];
  const afterRow = after.rows[0];
  if (!beforeRow || !afterRow) {
    throw new Error(`报告缺少数据行：${before.scenario}`);
  }

  let hardPass: FieldChange<boolean> | undefined;
  if (beforeRow.result.hardPass !== afterRow.result.hardPass) {
    hardPass = {
      before: beforeRow.result.hardPass,
      after: afterRow.result.hardPass,
    };
  }

  const beforeScore = lens?.score?.(beforeRow.result.artifact);
  const afterScore = lens?.score?.(afterRow.result.artifact);
  const score =
    beforeScore !== undefined &&
    afterScore !== undefined &&
    beforeScore !== afterScore
      ? {
          before: beforeScore,
          after: afterScore,
          delta: afterScore - beforeScore,
        }
      : undefined;

  const beforeDims = new Map(
    (lens?.dimensions?.(beforeRow.result.artifact) ?? []).map((dimension) => [
      dimension.metric,
      dimension.state,
    ]),
  );
  const dimensions = (lens?.dimensions?.(afterRow.result.artifact) ?? [])
    .filter((dimension) => {
      const beforeState = beforeDims.get(dimension.metric);
      return beforeState !== undefined && beforeState !== dimension.state;
    })
    .map((dimension) => ({
      metric: dimension.metric,
      before: beforeDims.get(dimension.metric)!,
      after: dimension.state,
    }));

  const beforeRate = beforeRow.repeat?.hardPassRate;
  const afterRate = afterRow.repeat?.hardPassRate;
  const hardPassRate =
    beforeRate !== undefined &&
    afterRate !== undefined &&
    beforeRate !== afterRate
      ? { before: beforeRate, after: afterRate }
      : undefined;

  const changed =
    hardPass !== undefined ||
    score !== undefined ||
    dimensions.length > 0 ||
    hardPassRate !== undefined;
  return {
    scenario: before.scenario,
    ...(hardPass ? { hardPass } : {}),
    ...(score ? { score } : {}),
    dimensions,
    ...(hardPassRate ? { hardPassRate } : {}),
    changed,
  };
}
