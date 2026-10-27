/**
 * @module @x-agent-suite/recall/run
 * 复用 runScenarioRepeat 与 writeScenarioReports；行为失败不落 infrastructure failure。
 */
import { resolve } from "node:path";
import type { ReportPaths } from "@x-agent-suite/contracts";
import { writeScenarioReports } from "@x-agent-suite/observation";
import { runScenarioRepeat } from "@x-agent-suite/runner";
import { loadRecall, type LoadRecallOptions } from "./load.ts";

/** 单个 case 的成功执行与报告位置。 */
export interface RecallCaseRun {
  readonly scenarioId: string;
  readonly hardPass: boolean;
  readonly reports: ReportPaths;
}

/** 单个 case 的基础设施失败；定义错误不会进入此结构。 */
export interface RecallInfraFailure {
  readonly scenarioId: string;
  readonly error: Error;
}

/** 一次 Recall 执行汇总。 */
export interface RecallRunResult {
  readonly runs: readonly RecallCaseRun[];
  readonly failures: readonly RecallInfraFailure[];
}

/** 全量校验后顺序执行 case/repeat，并写出现有 Markdown + JSON 报告。 */
export async function runRecall(
  options: LoadRecallOptions = {},
): Promise<RecallRunResult> {
  const loaded = await loadRecall(options);
  const outDir = resolve(
    loaded.cwd,
    loaded.config.outDir ?? ".tmp/x-agent-suite",
  );
  const repeat = loaded.config.repeat ?? 1;
  const runs: RecallCaseRun[] = [];
  const failures: RecallInfraFailure[] = [];
  for (const spec of loaded.scenarios) {
    try {
      const executed = await runScenarioRepeat(spec, {
        createDriver: loaded.config.createDriver,
        criteria: loaded.config.criteria,
        repeat,
      });
      const last = executed.results[executed.results.length - 1]!;
      const result = {
        ...last,
        observation: {
          ...last.observation,
          metadata: {
            ...last.observation.metadata,
            recall: spec.metadata?.recall,
          },
        },
      };
      const reports = await writeScenarioReports(
        [
          {
            scenario: spec.id,
            carrier:
              loaded.config.carrier ?? result.observation.carrier ?? "default",
            promptVariant: "default",
            result,
            ...(repeat > 1 ? { repeat: executed.stats } : {}),
          },
        ],
        { scenarioId: spec.id, outDir },
      );
      runs.push({ scenarioId: spec.id, hardPass: last.hardPass, reports });
    } catch (cause) {
      failures.push({ scenarioId: spec.id, error: asError(cause) });
    }
  }
  return { runs, failures };
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
