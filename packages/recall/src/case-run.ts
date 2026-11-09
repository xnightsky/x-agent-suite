/** @module @x-agent-suite/recall/case-run
 * 单 case/repeat 的 Recall 投影与落盘；执行始终交给原 Runner。
 * 不变量：账本不依赖 listener；ERROR 不发布正常成绩；脱敏包含全部主/Judge Driver。
 */
import type {
  Criterion,
  Redactor,
  RepeatStats,
  ScenarioResult,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import { redactLiveError, redactValue } from "@x-agent-suite/llm-fixture";
import {
  runScenarioRepeat,
  type RepeatRun,
  type ScenarioRepeatEvent,
} from "@x-agent-suite/runner";
import {
  adaptRecallAssertionResult,
  projectRecallAssertionOutcome,
  type RecallAssertionArtifact,
} from "./assertion-results.ts";
import {
  writeRecallReports,
  writeRecallErrorDiagnostic,
  RecallDiagnosticError,
} from "./composition-report.ts";
import { createRecallDriver } from "./driver.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import { hasFirstOf } from "./first-of-dsl.ts";
import {
  RecallCompositionJournal,
  bindCompositionJournal,
} from "./first-of-records.ts";
import type { LoadedRecall } from "./load.ts";
import type {
  RecallCaseProgress,
  RecallCaseRun,
  RecallRunListener,
} from "./run.ts";
/** 内部完整 case 结果；公开汇总不增加结果执行通道。 */
export interface ExecutedRecallCase {
  readonly run: RecallCaseRun;
  readonly result: ScenarioResult<RecallAssertionArtifact>;
  readonly repeat: RepeatStats;
  readonly redact?: Redactor;
}
interface CaseContext {
  spec: ScenarioSpec;
  execution: RecallResolvedExecution;
  loaded: LoadedRecall;
  progress: RecallCaseProgress;
  outDir: string;
  listener: RecallRunListener | undefined;
  redactors: Redactor[];
  journal?: RecallCompositionJournal;
}
function composeRedactors(
  redactors: readonly Redactor[],
): Redactor | undefined {
  const unique = [...new Set(redactors)];
  return unique.length
    ? (text) => unique.reduce((current, redact) => redact(current), text)
    : undefined;
}
function currentRedactor(context: CaseContext): Redactor | undefined {
  // 迟到 Driver 的 redactor 可能在初始错误报告后才到达，更新诊断仍用当前集合。
  return context.journal
    ? (text) =>
        composeRedactors([
          ...context.redactors,
          ...context.journal!.redactors,
        ])?.(text) ?? text
    : composeRedactors(context.redactors);
}
function makeContext(context: CaseContext): CaseContext {
  if (!hasFirstOf(context.spec)) return context;
  context.journal = new RecallCompositionJournal(
    context.spec,
    context.loaded.repeat,
    (event) => {
      context.listener?.(
        redactValue(
          { type: "composition", case: context.progress, event },
          currentRedactor(context),
        ),
      );
    },
  );
  bindCompositionJournal(context.execution, context.spec, context.journal);
  return context;
}
function projectRunnerEvent(
  context: CaseContext,
  event: ScenarioRepeatEvent,
): { event: ScenarioRepeatEvent; contributions?: readonly number[] } {
  if (event.type === "repeat-completed")
    return {
      event: {
        ...event,
        result: adaptRecallAssertionResult(
          context.spec,
          event.result,
          context.execution,
        ),
      },
    };
  if (event.type !== "scenario" || event.event.type !== "criteria-completed")
    return { event };
  const projected = event.event.outcomes.map((outcome) =>
    projectRecallAssertionOutcome(context.spec, outcome, context.execution),
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
function handleRunnerEvent(
  context: CaseContext,
  event: ScenarioRepeatEvent,
): void {
  const journal = context.journal;
  if (event.type === "repeat-started") journal?.start(event.repeatIndex);
  if (journal && event.type === "repeat-completed") {
    const { artifact, hardPass } = adaptRecallAssertionResult(
      context.spec,
      event.result,
      context.execution,
    );
    journal.repeats.push({
      index: event.repeatIndex,
      hardPass,
      outcomes: artifact.outcomes,
      assertions: artifact.assertions ?? [],
      rawScore: artifact.rawScore!,
      compositions: artifact.compositions ?? [],
    });
  }
  if (!context.listener) return;
  context.listener({
    type: "runner",
    case: context.progress,
    ...redactValue(
      projectRunnerEvent(context, event),
      currentRedactor(context),
    ),
  });
}
function executeRepeats(
  context: CaseContext,
  criteria: readonly Criterion[],
): Promise<RepeatRun> {
  return runScenarioRepeat(context.spec, {
    createDriver: async (current) => {
      const { execution, loaded } = context;
      const driver = await createRecallDriver(current, {
        execution,
        effects: loaded.plan.effects,
        registry: loaded.registry,
        config: loaded.config,
        executionParams: loaded.executionParams,
      });
      if (driver.redactor) context.redactors.push(driver.redactor);
      return driver;
    },
    criteria,
    repeat: context.loaded.repeat,
    onEvent: (event) => handleRunnerEvent(context, event),
  });
}
async function completedCase(
  context: CaseContext,
  executed: RepeatRun,
): Promise<ExecutedRecallCase> {
  const { spec, execution, loaded, journal } = context;
  const last = adaptRecallAssertionResult(
    spec,
    executed.results.at(-1)!,
    execution,
  );
  const result = {
    ...last,
    ...(journal
      ? { artifact: { ...last.artifact, repeats: journal.repeats } }
      : {}),
    observation: {
      ...last.observation,
      metadata: { ...last.observation.metadata, recall: spec.metadata?.recall },
    },
  };
  const redact = currentRedactor(context);
  const reports = await writeRecallReports(
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
      outDir: context.outDir,
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
  return { run, result, repeat: executed.stats, ...(redact ? { redact } : {}) };
}
async function raiseCaseFailure(
  context: CaseContext,
  cause: unknown,
): Promise<never> {
  const redact = currentRedactor(context);
  if (!context.journal) throw redact ? redactLiveError(cause, redact) : cause;
  const error = redact
    ? redactLiveError(cause, redact)
    : cause instanceof Error
      ? cause
      : new Error(String(cause));
  let reports;
  try {
    reports = await writeRecallErrorDiagnostic(context.journal, cause, {
      scenarioId: context.spec.id,
      outDir: context.outDir,
      ...(redact ? { redact } : {}),
    });
  } catch (writeError) {
    throw new AggregateError(
      [error, redact ? redactLiveError(writeError, redact) : writeError],
      "Recall 执行与错误诊断写盘失败",
    );
  }
  throw new RecallDiagnosticError(error, reports);
}
/** 调用原 Runner 并保存一个 case，所有错误沿既有基础设施通道上抛。 */
export async function runRecallCase(
  spec: ScenarioSpec,
  execution: RecallResolvedExecution,
  criteria: readonly Criterion[],
  loaded: LoadedRecall,
  progress: RecallCaseProgress,
  listener: RecallRunListener | undefined,
  outDir: string,
): Promise<ExecutedRecallCase> {
  const context = makeContext({
    spec,
    execution,
    loaded,
    progress,
    listener,
    outDir,
    redactors: [],
  });
  try {
    return await completedCase(
      context,
      await executeRepeats(context, criteria),
    );
  } catch (cause) {
    return raiseCaseFailure(context, cause);
  }
}
