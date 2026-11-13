/**
 * @module @x-agent-suite/recall/run
 * 单 Runner 逐 target/case/repeat 执行；多 default 只在外层顺序编排，不广播或 fallback。
 * 不变量：动态判据装配（每 target 一次）完成于任何主 Driver 创建之前；
 * 装配失败中止本次运行，不记入 RecallRunResult.failures（该列表只承载单 case 基础设施失败）。
 */
import type { ScenarioRepeatEvent } from "@x-agent-suite/runner";
import { runRecallCase } from "./case-run.ts";
import { targetOutDir } from "./report-path.ts";
import { RecallDiagnosticError } from "./composition-report.ts";
import type { RecallCompositionEvent } from "./first-of-records.ts";
export { targetOutDir } from "./report-path.ts";
import type {
  Criterion,
  RepeatStats,
  ReportPaths,
  ScenarioResult,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import { redactValue } from "@x-agent-suite/llm-fixture";
import { assembleRecallCriteria } from "./criterion-assembly.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import {
  loadRecallCore,
  type LoadedRecall,
  type LoadRecallOptions,
  type RecallLoadCore,
} from "./load.ts";
import type { RecallAssertionArtifact } from "./assertion-results.ts";
import {
  summarizeRecallSuiteScores,
  type RecallRepeatScoreSummary,
  type RecallSuiteScoreSummary,
} from "./score-summary.ts";

/** 单个 case 的成功执行与报告位置。 */
export interface RecallCaseRun {
  /** 场景 ID。 */
  readonly scenarioId: string;
  /** 行为判据是否全部通过。 */
  readonly hardPass: boolean;
  /** 当前 case 的 repeat 计分汇总。 */
  readonly score: RecallRepeatScoreSummary;
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
  /** 使用组合的 case 的错误诊断路径。 */
  readonly reports?: ReportPaths;
  readonly scoreSummary?: RecallRepeatScoreSummary;
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
  /** target×case 宏平均与覆盖统计。 */
  readonly summary: RecallSuiteScoreSummary;
}

/** 当前 target × case 的稳定进度归因；index/total 为 1-based 展示序号。 */
export interface RecallCaseProgress {
  readonly index: number;
  readonly total: number;
  readonly scenarioId: string;
  readonly carrier: string;
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly cliRef?: string;
  readonly clientRef?: string;
}

/** Recall 全量结构化进度事件；CLI 与程序调用方共享同一时间序列。 */
export type RecallRunEvent =
  | {
      readonly type: "composition";
      readonly case: RecallCaseProgress;
      readonly event: RecallCompositionEvent;
    }
  | {
      readonly type: "run-started";
      readonly targetCount: number;
      readonly caseTotal: number;
      readonly repeat: number;
    }
  | { readonly type: "case-started"; readonly case: RecallCaseProgress }
  | {
      readonly type: "runner";
      readonly case: RecallCaseProgress;
      readonly event: ScenarioRepeatEvent;
      readonly contributions?: readonly number[];
    }
  | {
      readonly type: "case-completed";
      readonly case: RecallCaseProgress;
      readonly run: RecallCaseRun;
      readonly result: ScenarioResult<RecallAssertionArtifact>;
      readonly repeat: RepeatStats;
      readonly durationMs: number;
    }
  | {
      readonly type: "case-failed";
      readonly case: RecallCaseProgress;
      readonly failure: RecallInfraFailure;
      readonly durationMs: number;
    }
  | {
      readonly type: "run-completed";
      readonly result: RecallRunResult;
      readonly durationMs: number;
    };

/** Recall 进度监听器；事件载荷已在出口应用可用 Driver redactor。 */
export type RecallRunListener = (event: RecallRunEvent) => void;

/** 一个 target 的装配结果：执行实现与其复用的判据数组。 */
interface AssembledExecution {
  readonly execution: RecallResolvedExecution;
  readonly criteria: readonly Criterion[];
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** 装配每个 target 实际引用的动态判据；全部完成于任何主 Driver 创建之前。 */
async function assembleExecutions(
  loaded: LoadedRecall,
  core: Pick<RecallLoadCore, "catalog" | "liveReviewApproved">,
): Promise<readonly AssembledExecution[]> {
  const assembled: AssembledExecution[] = [];
  for (const execution of loaded.executions) {
    const criteria = await assembleRecallCriteria({
      registry: loaded.registry,
      scenarios: loaded.scenarios,
      execution,
      config: loaded.config,
      catalog: core.catalog,
      liveReviewApproved: core.liveReviewApproved,
      effects: loaded.plan.effects,
    });
    assembled.push({ execution, criteria });
  }
  return assembled;
}

/** 构造一个 target × case 的进度身份。 */
function caseProgress(
  spec: ScenarioSpec,
  execution: RecallResolvedExecution,
  index: number,
  total: number,
): RecallCaseProgress {
  return {
    index,
    total,
    scenarioId: spec.id,
    carrier: execution.target.carrier,
    provider: execution.target.channel.provider ?? "-",
    model: execution.target.channel.model,
    mode: execution.mode,
    ...(execution.cliRef ? { cliRef: execution.cliRef } : {}),
    ...(execution.clientRef ? { clientRef: execution.clientRef } : {}),
  };
}

/** 全量校验后顺序执行，并在每个生命周期点同步发出结构化事件。 */
export async function runRecall(
  options: LoadRecallOptions,
  listener?: RecallRunListener,
): Promise<RecallRunResult> {
  const startedAt = Date.now();
  const core = await loadRecallCore(options);
  const { loaded } = core;
  const executions = await assembleExecutions(loaded, core);
  const total = executions.length * loaded.scenarios.length;
  listener?.({
    type: "run-started",
    targetCount: executions.length,
    caseTotal: total,
    repeat: loaded.repeat,
  });
  const runs: RecallCaseRun[] = [];
  const failures: RecallInfraFailure[] = [];
  let index = 0;
  for (const { execution, criteria } of executions) {
    for (const spec of loaded.scenarios) {
      index += 1;
      const progress = caseProgress(spec, execution, index, total);
      const caseStartedAt = Date.now();
      try {
        listener?.({ type: "case-started", case: progress });
        const executed = await runRecallCase(
          spec,
          execution,
          criteria,
          loaded,
          progress,
          listener,
          targetOutDir(loaded.outDir, execution),
        );
        const durationMs = Date.now() - caseStartedAt;
        listener?.(
          redactValue(
            {
              type: "case-completed",
              case: progress,
              run: executed.run,
              result: executed.result,
              repeat: executed.repeat,
              durationMs,
            },
            executed.redact,
          ),
        );
        runs.push(executed.run);
      } catch (cause) {
        const failure = {
          scenarioId: spec.id,
          error: asError(cause),
          carrier: execution.target.carrier,
          mode: execution.mode,
          ...(cause instanceof RecallDiagnosticError
            ? {
                scoreSummary: cause.scoreSummary,
                ...(cause.reports ? { reports: cause.reports } : {}),
              }
            : {}),
        };
        failures.push(failure);
        listener?.({
          type: "case-failed",
          case: progress,
          failure,
          durationMs: Date.now() - caseStartedAt,
        });
      }
    }
  }
  const result = {
    runs,
    failures,
    summary: summarizeRecallSuiteScores(
      total,
      runs.map((run) => run.score),
      {
        invalid: failures.length,
        skipped: total - runs.length - failures.length,
      },
    ),
  };
  listener?.({
    type: "run-completed",
    result,
    durationMs: Date.now() - startedAt,
  });
  return result;
}
