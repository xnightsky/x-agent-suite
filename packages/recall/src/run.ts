/**
 * @module @x-agent-suite/recall/run
 * 单 Runner 逐 target/case/repeat 执行；多 default 只在外层顺序编排，不广播或 fallback。
 */
import { join } from "node:path";
import type { ReportPaths, ScenarioSpec } from "@x-agent-suite/contracts";
import { writeScenarioReports } from "@x-agent-suite/observation";
import { runScenarioRepeat } from "@x-agent-suite/runner";
import { createRecallDriver } from "./driver.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import {
  loadRecall,
  type LoadedRecall,
  type LoadRecallOptions,
} from "./load.ts";

/** 单个 case 的成功执行与报告位置。 */
export interface RecallCaseRun {
  /** 场景 ID。 */
  readonly scenarioId: string;
  /** 行为判据是否全部通过。 */
  readonly hardPass: boolean;
  /** 双格式报告路径。 */
  readonly reports: ReportPaths;
  /** 当前 target 的 carrier。 */
  readonly carrier: string;
  /** 当前访问模式。 */
  readonly mode: string;
  /** borrowed profile。 */
  readonly cliRef?: string;
}

/** 单个 case 的基础设施失败。 */
export interface RecallInfraFailure {
  /** 场景 ID。 */
  readonly scenarioId: string;
  /** 已分类错误。 */
  readonly error: Error;
  /** 当前 target 的 carrier。 */
  readonly carrier: string;
  /** 当前访问模式。 */
  readonly mode: string;
}

/** 一次 Recall 执行汇总。 */
export interface RecallRunResult {
  /** 成功执行的 case。 */
  readonly runs: readonly RecallCaseRun[];
  /** 基础设施失败。 */
  readonly failures: readonly RecallInfraFailure[];
}

function targetOutDir(
  base: string,
  execution: RecallResolvedExecution,
): string {
  const { target } = execution;
  return join(
    base,
    encodeURIComponent(target.carrier),
    encodeURIComponent(target.channel.provider ?? "-"),
    encodeURIComponent(target.channel.model),
  );
}

async function runCase(
  spec: ScenarioSpec,
  execution: RecallResolvedExecution,
  loaded: LoadedRecall,
): Promise<RecallCaseRun> {
  const executed = await runScenarioRepeat(spec, {
    createDriver: (current) =>
      createRecallDriver(current, {
        execution,
        effects: loaded.plan.effects,
        registry: loaded.registry,
        config: loaded.config,
        executionParams: loaded.executionParams,
      }),
    criteria: loaded.registry.criteria,
    repeat: loaded.repeat,
  });
  const last = executed.results[executed.results.length - 1]!;
  const result = {
    ...last,
    observation: {
      ...last.observation,
      metadata: { ...last.observation.metadata, recall: spec.metadata?.recall },
    },
  };
  const reports = await writeScenarioReports(
    [
      {
        scenario: spec.id,
        carrier: execution.target.carrier,
        promptVariant: "default",
        result,
        ...(loaded.repeat > 1 ? { repeat: executed.stats } : {}),
      },
    ],
    { scenarioId: spec.id, outDir: targetOutDir(loaded.outDir, execution) },
  );
  return {
    scenarioId: spec.id,
    hardPass: last.hardPass,
    reports,
    carrier: execution.target.carrier,
    mode: execution.mode,
    ...(execution.cliRef ? { cliRef: execution.cliRef } : {}),
  };
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** 全量校验后逐 target/case/repeat 执行并写出现有 Markdown + JSON 报告。 */
export async function runRecall(
  options: LoadRecallOptions,
): Promise<RecallRunResult> {
  const loaded = await loadRecall(options);
  const runs: RecallCaseRun[] = [];
  const failures: RecallInfraFailure[] = [];
  for (const execution of loaded.executions) {
    for (const spec of loaded.scenarios) {
      try {
        runs.push(await runCase(spec, execution, loaded));
      } catch (cause) {
        failures.push({
          scenarioId: spec.id,
          error: asError(cause),
          carrier: execution.target.carrier,
          mode: execution.mode,
        });
      }
    }
  }
  return { runs, failures };
}
