/**
 * @module @x-agent-suite/recall/run
 * 单 Runner 逐 target/case/repeat 执行；多 default 只在外层顺序编排，不广播或 fallback。
 * 不变量：动态判据装配（每 target 一次）完成于任何主 Driver 创建之前；
 * 装配失败中止本次运行，不记入 RecallRunResult.failures（该列表只承载单 case 基础设施失败）。
 */
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  Criterion,
  Redactor,
  RepeatStats,
  ReportPaths,
  ScenarioResult,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import { redactLiveError, redactValue } from "@x-agent-suite/llm-fixture";
import { writeScenarioReports } from "@x-agent-suite/observation";
import {
  runScenarioRepeat,
  type ScenarioRepeatEvent,
} from "@x-agent-suite/runner";
import { assembleRecallCriteria } from "./criterion-assembly.ts";
import { createRecallDriver } from "./driver.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import {
  loadRecallCore,
  type LoadedRecall,
  type LoadRecallOptions,
  type RecallLoadCore,
} from "./load.ts";
import {
  adaptRecallAssertionResult,
  projectRecallAssertionOutcome,
  type RecallAssertionArtifact,
} from "./assertion-results.ts";
import { encodeSafePathSegment } from "./validation.ts";

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

/** 推导单 target 的报告目录，所有路径分量必须保持为单个安全段。 */
export function targetOutDir(
  base: string,
  execution: RecallResolvedExecution,
): string {
  const { target } = execution;
  const root = resolve(base);
  const outDir = join(
    root,
    encodeSafePathSegment(target.carrier, "Recall report carrier 路径段"),
    encodeSafePathSegment(
      target.channel.provider ?? "-",
      "Recall report provider 路径段",
    ),
    encodeSafePathSegment(target.channel.model, "Recall report model 路径段"),
  );
  const nested = relative(root, outDir);
  if (
    !nested ||
    nested === ".." ||
    nested.startsWith(`..${sep}`) ||
    isAbsolute(nested)
  ) {
    throw new Error("Recall report target 目录逃逸 outDir");
  }
  return outDir;
}

/** 按 driver 创建顺序组合去重后的 redactor。 */
function composeRedactors(
  redactors: readonly Redactor[],
): Redactor | undefined {
  const unique = [...new Set(redactors)];
  if (unique.length === 0) return undefined;
  return (text) => unique.reduce((current, redact) => redact(current), text);
}

/** 一个 target 的装配结果：执行实现与其复用的判据数组。 */
interface AssembledExecution {
  readonly execution: RecallResolvedExecution;
  readonly criteria: readonly Criterion[];
}

/** runCase 的内部完整结果；公开 runRecall 汇总仍只返回 runs/failures。 */
interface ExecutedRecallCase {
  readonly run: RecallCaseRun;
  readonly result: ScenarioResult<RecallAssertionArtifact>;
  readonly repeat: RepeatStats;
  readonly redact?: Redactor;
}

/** Runner 事件的 Recall 作者视图；贡献顺序与 criteria outcomes 一致。 */
interface RecallRunnerProjection {
  readonly event: ScenarioRepeatEvent;
  readonly contributions?: readonly number[];
}

/** 投影 repeat 总分及逐判据贡献，复用报告使用的同一投影函数。 */
function projectRunnerEvent(
  spec: ScenarioSpec,
  execution: RecallResolvedExecution,
  event: ScenarioRepeatEvent,
): RecallRunnerProjection {
  if (event.type === "repeat-completed") {
    return {
      event: {
        ...event,
        result: adaptRecallAssertionResult(spec, event.result, execution),
      },
    };
  }
  if (event.type !== "scenario" || event.event.type !== "criteria-completed") {
    return { event };
  }
  const projected = event.event.outcomes.map((outcome) =>
    projectRecallAssertionOutcome(spec, outcome, execution),
  );
  return {
    event: {
      ...event,
      event: {
        ...event.event,
        outcomes: projected.map((item) => item.outcome),
      },
    },
    contributions: projected.map((item) => item.assertion.score),
  };
}

async function runCase(
  spec: ScenarioSpec,
  execution: RecallResolvedExecution,
  criteria: readonly Criterion[],
  loaded: LoadedRecall,
  progress: RecallCaseProgress,
  listener: RecallRunListener | undefined,
): Promise<ExecutedRecallCase> {
  const redactors: Redactor[] = [];
  try {
    const executed = await runScenarioRepeat(spec, {
      createDriver: async (current) => {
        const driver = await createRecallDriver(current, {
          execution,
          effects: loaded.plan.effects,
          registry: loaded.registry,
          config: loaded.config,
          executionParams: loaded.executionParams,
        });
        if (driver.redactor) redactors.push(driver.redactor);
        return driver;
      },
      criteria,
      repeat: loaded.repeat,
      onEvent: (event) => {
        if (!listener) return;
        const projected = projectRunnerEvent(spec, execution, event);
        listener({
          type: "runner",
          case: progress,
          ...redactValue(projected, composeRedactors(redactors)),
        });
      },
    });
    const adapted = executed.results.map((item) =>
      adaptRecallAssertionResult(spec, item, execution),
    );
    const last = adapted[adapted.length - 1]!;
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
    const redact = composeRedactors(redactors);
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
      {
        scenarioId: spec.id,
        outDir: targetOutDir(loaded.outDir, execution),
        ...(redact ? { redact } : {}),
      },
    );
    const run = {
      scenarioId: spec.id,
      hardPass: last.hardPass,
      reports,
      carrier: execution.target.carrier,
      mode: execution.mode,
      ...(execution.cliRef ? { cliRef: execution.cliRef } : {}),
    };
    return {
      run,
      result,
      repeat: executed.stats,
      ...(redact ? { redact } : {}),
    };
  } catch (cause) {
    const redact = composeRedactors(redactors);
    throw redact ? redactLiveError(cause, redact) : cause;
  }
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
        const executed = await runCase(
          spec,
          execution,
          criteria,
          loaded,
          progress,
          listener,
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
  const result = { runs, failures };
  listener?.({
    type: "run-completed",
    result,
    durationMs: Date.now() - startedAt,
  });
  return result;
}
