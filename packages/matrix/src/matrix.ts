/**
 * @module @x-agent-suite/matrix/matrix
 * Matrix 编排核心：scenario × carrier × prompt 变体对照运行。
 */

import type {
  AgentDriver,
  Observation,
  Redactor,
  ScenarioResult,
} from "@x-agent-suite/contracts";

/** 一个 carrier 的 driver 工厂；失败应抛 Error，matrix 会将其降级为 skip 行。 */
export type DriverFactory = (carrier: string) => Promise<AgentDriver>;

/** 发现某 scenario 的 prompt 变体列表；matrix 对变体串行、同变体内 carrier 并行。 */
export type VariantDiscovery = (
  scenarioId: string,
) => Promise<string[]> | string[];

/** 运行一次 scenario；返回结构化 ScenarioResult。 */
export type ScenarioRunner = (options: {
  scenarioId: string;
  carrier: string;
  promptVariant: string;
  driver: AgentDriver;
}) => Promise<ScenarioResult>;

/** Matrix 配置。 */
export interface MatrixOptions {
  /** 默认 carrier 集合；runMatrix 可覆盖。 */
  readonly carriers: readonly string[];
  /** 按 scenarioId 发现 prompt 变体。 */
  readonly getVariants: VariantDiscovery;
  /** 为指定 carrier 创建 driver。 */
  readonly createDriver: DriverFactory;
  /** 在 driver 上运行 scenario。 */
  readonly runScenario: ScenarioRunner;
  /** driver 创建前异常所用的可选文本脱敏器。 */
  readonly redact?: Redactor;
}

/** 一次变体 × carrier 的运行结果：成功或 skip。 */
export type MatrixRow =
  | {
      readonly kind: "ok";
      readonly scenarioId: string;
      readonly carrier: string;
      readonly promptVariant: string;
      readonly result: ScenarioResult;
      readonly stdoutTail?: string;
      readonly stderrTail?: string;
    }
  | {
      readonly kind: "skip";
      readonly scenarioId: string;
      readonly carrier: string;
      readonly promptVariant: string;
      readonly reason: string;
    };

/** runMatrix 返回值。 */
export interface MatrixResult {
  readonly rows: readonly MatrixRow[];
  readonly okCount: number;
  readonly skipCount: number;
  readonly failCount: number;
}

/** runMatrix 单次选项。 */
export interface RunMatrixOptions {
  readonly scenarioId: string;
  readonly carriers?: readonly string[];
  readonly variants?: readonly string[];
}

/** 构造一个可复用的 MatrixRunner。 */
export function createMatrixRunner(
  options: MatrixOptions,
): (runOptions: RunMatrixOptions) => Promise<MatrixResult> {
  return (runOptions) => runMatrix(options, runOptions);
}

/**
 * 运行一次 matrix 对照。
 *
 * 流程：
 * - 发现 scenario 的全部 prompt 变体（或由调用方显式传入）；
 * - 变体间串行；同一变体内所有 carrier 并行；
 * - driver 创建失败或 runScenario 抛错的 carrier 记为 skip 行，不影响其他 carrier；
 * - 返回所有行 + 统计计数。
 */
export async function runMatrix(
  options: MatrixOptions,
  runOptions: RunMatrixOptions,
): Promise<MatrixResult> {
  const scenarioId = runOptions.scenarioId;
  const carriers = runOptions.carriers ?? options.carriers;
  const variants =
    runOptions.variants ?? (await options.getVariants(scenarioId));
  if (variants.length === 0) {
    throw new Error(`scenario "${scenarioId}" 未提供任何 prompt 变体`);
  }
  if (carriers.length === 0) {
    throw new Error(`scenario "${scenarioId}" 未提供任何 carrier`);
  }

  const rows: MatrixRow[] = [];
  for (const promptVariant of variants) {
    const variantRows = await Promise.all(
      carriers.map(async (carrier) => {
        let redactor = options.redact;
        try {
          const driver = await options.createDriver(carrier);
          redactor = driver.redactor ?? redactor;
          let result: ScenarioResult;
          try {
            result = await options.runScenario({
              scenarioId,
              carrier,
              promptVariant,
              driver,
            });
          } catch (runError) {
            try {
              await driver.close();
            } catch (closeError) {
              throw new AggregateError(
                [runError, closeError],
                `scenario/close 均失败：${describeError(runError, redactor)}；close: ${describeError(closeError, redactor)}`,
              );
            }
            throw runError;
          }
          await driver.close();
          return {
            kind: "ok" as const,
            scenarioId,
            carrier,
            promptVariant,
            result,
          };
        } catch (error) {
          return {
            kind: "skip" as const,
            scenarioId,
            carrier,
            promptVariant,
            reason: describeError(error, redactor),
          };
        }
      }),
    );
    rows.push(...variantRows);
  }

  const okCount = rows.filter((r) => r.kind === "ok").length;
  const skipCount = rows.filter((r) => r.kind === "skip").length;
  const failCount = rows.filter(
    (r) => r.kind === "ok" && !r.result.hardPass,
  ).length;
  return { rows, okCount, skipCount, failCount };
}

/** 把未知异常归一为可读文本。 */
function describeError(error: unknown, redactor?: Redactor): string {
  const detail = error instanceof Error ? error.message : String(error);
  return redactor?.(detail) ?? detail;
}

/** 把 MatrixRow 归一化为可写入报告的 ScenarioReportRow（skip 行转换为失败结果）。 */
export function toScenarioReportRows(
  rows: readonly MatrixRow[],
  redactor?: Redactor,
): import("@x-agent-suite/contracts").ScenarioReportRow[] {
  return rows.map((row) => {
    if (row.kind === "ok") {
      return {
        scenario: row.scenarioId,
        carrier: row.carrier,
        promptVariant: row.promptVariant,
        result: row.result,
        stdoutTail: row.stdoutTail,
        stderrTail: row.stderrTail,
      };
    }
    const now = Date.now();
    const failedResult: ScenarioResult = {
      observation: {
        text: "",
        toolCalls: [],
        toolCallsCount: 0,
        events: [],
      },
      artifact: {},
      dryPass: false,
      hardPass: false,
      fuzzyPass: false,
      latencyMs: 0,
      error: redactor?.(row.reason) ?? row.reason,
    };
    return {
      scenario: row.scenarioId,
      carrier: row.carrier,
      promptVariant: row.promptVariant,
      result: failedResult,
    };
  });
}
