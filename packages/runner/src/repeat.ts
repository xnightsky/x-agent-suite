/**
 * @module @x-agent-suite/runner/repeat
 * repeat 统计：同一场景顺序执行 N 次，产出稳定性维度（稳定率 + 聚合分统计）。
 *
 * 不变量：
 * - 顺序执行（并行调度是 YAGNI，首个消费者验证后再议）；
 * - 任一基础设施失败立即抛出（统计不掩盖基础设施问题）；
 * - 统计只描述行为波动，不改动单次执行的语义。
 */

import type {
  RepeatStats,
  ScenarioResult,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import {
  runScenarioSpec,
  type RunScenarioSpecDeps,
  type RunnerArtifact,
  type ScenarioRunEvent,
} from "./run-scenario.ts";

/** Repeat 执行过程事件；序号均为 0-based，场景事件保留嵌套顺序。 */
export type ScenarioRepeatEvent =
  | {
      readonly type: "repeat-started";
      readonly repeatIndex: number;
      readonly repeatCount: number;
    }
  | {
      readonly type: "repeat-completed";
      readonly repeatIndex: number;
      readonly repeatCount: number;
      readonly result: ScenarioResult<RunnerArtifact>;
    }
  | {
      readonly type: "scenario";
      readonly repeatIndex: number;
      readonly repeatCount: number;
      readonly event: ScenarioRunEvent;
    };

/** runScenarioRepeat 注入依赖；进度监听器接收 repeat 归因后的事件。 */
export type RunScenarioRepeatDeps = Omit<RunScenarioSpecDeps, "onEvent"> & {
  readonly repeat: number;
  readonly onEvent?: (event: ScenarioRepeatEvent) => void;
};

/** runScenarioRepeat 的返回：全部单次结果 + 稳定性统计。 */
export interface RepeatRun {
  /** 各次执行结果（按执行顺序）。 */
  readonly results: readonly ScenarioResult<RunnerArtifact>[];
  /** 稳定性统计。 */
  readonly stats: RepeatStats;
}

/** 汇总单次结果集为稳定性统计。 */
export function summarizeRepeat(
  results: readonly ScenarioResult<RunnerArtifact>[],
): RepeatStats {
  const runs = results.length;
  const hardPassCount = results.filter((result) => result.hardPass).length;
  const fuzzyPassCount = results.filter((result) => result.fuzzyPass).length;
  const scores = results
    .map((result) => result.artifact?.aggregate?.score)
    .filter((score): score is number => typeof score === "number");
  return {
    runs,
    hardPassCount,
    hardPassRate: runs === 0 ? 0 : hardPassCount / runs,
    fuzzyPassRate: runs === 0 ? 0 : fuzzyPassCount / runs,
    ...(scores.length > 0
      ? {
          score: {
            mean: scores.reduce((sum, score) => sum + score, 0) / scores.length,
            min: Math.min(...scores),
            max: Math.max(...scores),
          },
        }
      : {}),
  };
}

/** 同一场景顺序执行 N 次并汇总稳定性；repeat <= 1 时退化为单次执行。 */
export async function runScenarioRepeat(
  spec: ScenarioSpec,
  deps: RunScenarioRepeatDeps,
): Promise<RepeatRun> {
  if (!Number.isInteger(deps.repeat) || deps.repeat < 1) {
    throw new Error(`repeat 必须是正整数，实际：${deps.repeat}`);
  }
  const results: ScenarioResult<RunnerArtifact>[] = [];
  const { onEvent, ...scenarioDeps } = deps;
  for (let index = 0; index < deps.repeat; index += 1) {
    onEvent?.({
      type: "repeat-started",
      repeatIndex: index,
      repeatCount: deps.repeat,
    });
    const result = await runScenarioSpec(spec, {
      ...scenarioDeps,
      onEvent: (event) =>
        onEvent?.({
          type: "scenario",
          repeatIndex: index,
          repeatCount: deps.repeat,
          event,
        }),
    });
    results.push(result);
    onEvent?.({
      type: "repeat-completed",
      repeatIndex: index,
      repeatCount: deps.repeat,
      result,
    });
  }
  return { results, stats: summarizeRepeat(results) };
}
