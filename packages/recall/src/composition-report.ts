/** @module @x-agent-suite/recall/composition-report
 * Recall 组合的正常明细与 ERROR 诊断；复用通用安全序列化/脱敏/权限核心。
 * 不变量：ERROR 无正常结果行、无错误 repeat 总分；局部完成仅作诊断。
 */
import type {
  Redactor,
  ReportPaths,
  ScenarioReportRow,
  WriteReportsOptions,
} from "@x-agent-suite/contracts";
import {
  renderScenarioMarkdown,
  writeReportDocument,
  writeScenarioReports,
} from "@x-agent-suite/observation";
import type { RecallAssertionArtifact } from "./assertion-results.ts";
import type { RecallRepeatScoreSummary } from "./score-summary.ts";
import type {
  RecallComposition,
  RecallCompositionJournal,
} from "./composition-records.ts";
function detailMarkdown(compositions: readonly RecallComposition[]): string {
  return compositions
    .flatMap((composition) => [
      `### ${composition.assertionName}: ${composition.status} / accepted=${composition.accepted ?? "null"}`,
      "",
      ...composition.branches.flatMap((branch) => [
        `- [${branch.index}] ${branch.name}: ${branch.status}${branch.skipReason ? " (" + branch.skipReason + ")" : ""}, contribution=${branch.contribution ?? "null"}, scoreSource=${branch.scoreSource ?? "null"}`,
        ...(branch.conditions ?? []).map(
          (condition) =>
            `  - ${condition.name}: pass=${condition.pass}, rawScore=${condition.score}; ${condition.reason}`,
        ),
        ...(branch.judge ? ["  - Judge: " + JSON.stringify(branch.judge)] : []),
        ...(branch.cleanup ?? []).map(
          (cleanup) => "  - cleanup: " + JSON.stringify(cleanup),
        ),
      ]),
      "",
    ])
    .join("\n");
}
/** 正常报告中同时展示原始分、唯一贡献与分支树。无组合时保持原报告格式。 */
export async function writeRecallReports(
  rows: readonly ScenarioReportRow<RecallAssertionArtifact>[],
  options: WriteReportsOptions,
): Promise<ReportPaths> {
  if (!rows.some((row) => row.result.artifact.compositions))
    return writeScenarioReports(rows, options);
  return writeReportDocument(rows, options, {
    suffix: "report",
    json: (safe, scenario, stamp) => ({ scenario, stamp, rows: safe }),
    markdown: (safe, scenario, stamp) =>
      renderScenarioMarkdown(safe, scenario, stamp) +
      "\n" +
      safe
        .map((row) => {
          const artifact = row.result.artifact;
          const repeats = artifact.repeats ?? [{ index: 0, ...artifact }];
          return (
            repeats
              .map(
                (repeat) =>
                  `## Repeat ${repeat.index}\n\nrawScore=${repeat.rawScore}\n\n` +
                  (repeat.assertions ?? [])
                    .map(
                      (item) =>
                        `- ${item.name}: ${item.source}, pass=${item.pass}, contribution=${item.score}`,
                    )
                    .join("\n") +
                  "\n\n" +
                  detailMarkdown(repeat.compositions ?? []),
              )
              .join("\n") +
            "\n\nscoreSummary=" +
            JSON.stringify(artifact.scoreSummary)
          );
        })
        .join("\n"),
  });
}
function errorDetails(cause: unknown, seen = new Set<unknown>()): unknown {
  if (!(cause instanceof Error)) return { message: String(cause) };
  if (seen.has(cause)) return { message: "循环错误引用" };
  seen.add(cause);
  return {
    name: cause.name,
    message: cause.message,
    ...(cause instanceof AggregateError
      ? { errors: cause.errors.map((error) => errorDetails(error, seen)) }
      : {}),
    ...(cause.cause === undefined
      ? {}
      : { cause: errorDetails(cause.cause, seen) }),
  };
}
/** 带脱敏诊断位置的错误，不改变基础设施失败分类。 */
export class RecallDiagnosticError extends Error {
  constructor(
    cause: Error,
    readonly reports: ReportPaths | undefined,
    readonly scoreSummary: RecallRepeatScoreSummary,
  ) {
    super(cause.message, { cause });
    this.name = cause.name;
  }
}
/** 保存错误 repeat 的完整历史与部分树，不构造伪造 ScenarioResult。 */
export async function writeRecallErrorDiagnostic(
  journal: RecallCompositionJournal,
  cause: unknown,
  options: WriteReportsOptions,
  scoreSummary: RecallRepeatScoreSummary,
): Promise<ReportPaths> {
  journal.fail();
  const writeOptions = {
    ...options,
    stamp: options.stamp ?? new Date().toISOString().replaceAll(/[:.]/g, "-"),
  };
  return journal.persistDiagnostic(() => {
    const value = {
      status: "error",
      repeatSummary: scoreSummary,
      repeatIndex: journal.repeatIndex,
      repeatCount: journal.repeatCount,
      completedRepeats: journal.repeats,
      compositions: journal.snapshot(),
      pendingRepeats: Array.from(
        { length: Math.max(0, journal.repeatCount - journal.repeatIndex - 1) },
        (_, offset) => ({
          index: journal.repeatIndex + offset + 1,
          status: "skipped",
          reason: "error",
        }),
      ),
      error: errorDetails(cause),
      cleanup: journal.cleanup,
    };
    return writeReportDocument(value, writeOptions, {
      suffix: "diagnostic",
      json: (safe, scenario, stamp) => ({ scenario, stamp, ...safe }),
      markdown: (safe, scenario, stamp) =>
        `# ERROR：${scenario}（${stamp}）\n\nrepeatIndex=${safe.repeatIndex}\n\n` +
        JSON.stringify(safe.error, null, 2) +
        "\n\n" +
        detailMarkdown(safe.compositions) +
        "\n\n```json\n" +
        JSON.stringify(safe, null, 2) +
        "\n```\n",
    });
  });
}
