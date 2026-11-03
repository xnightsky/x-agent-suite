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
  ReportPaths,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import { redactLiveError } from "@x-agent-suite/llm-fixture";
import { writeScenarioReports } from "@x-agent-suite/observation";
import { runScenarioRepeat } from "@x-agent-suite/runner";
import { assembleRecallCriteria } from "./criterion-assembly.ts";
import { createRecallDriver } from "./driver.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import {
  loadRecallCore,
  type LoadedRecall,
  type LoadRecallOptions,
  type RecallLoadCore,
} from "./load.ts";
import { adaptRecallAssertionResult } from "./assertion-results.ts";
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

async function runCase(
  spec: ScenarioSpec,
  execution: RecallResolvedExecution,
  criteria: readonly Criterion[],
  loaded: LoadedRecall,
): Promise<RecallCaseRun> {
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
    return {
      scenarioId: spec.id,
      hardPass: last.hardPass,
      reports,
      carrier: execution.target.carrier,
      mode: execution.mode,
      ...(execution.cliRef ? { cliRef: execution.cliRef } : {}),
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

/** 全量校验与判据装配后逐 target/case/repeat 执行并写出现有 Markdown + JSON 报告。 */
export async function runRecall(
  options: LoadRecallOptions,
): Promise<RecallRunResult> {
  const core = await loadRecallCore(options);
  const { loaded } = core;
  const executions = await assembleExecutions(loaded, core);
  const runs: RecallCaseRun[] = [];
  const failures: RecallInfraFailure[] = [];
  for (const { execution, criteria } of executions) {
    for (const spec of loaded.scenarios) {
      try {
        runs.push(await runCase(spec, execution, criteria, loaded));
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
