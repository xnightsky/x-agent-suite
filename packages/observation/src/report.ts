/**
 * @module @x-agent-suite/observation/report
 * ScenarioResult 列表 → 报告文件：
 * 每次运行同时产出 .md（给人看的结论表）与 .json（完整明细）。
 * 不变量：写入前递归建目录；stamp 默认可生成、测试可钉死；
 * json 保留完整 Observation / artifact / tool 入参与 stdout/stderr tail（排查用）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ReportPaths,
  ScenarioReportRow,
  WriteReportsOptions,
} from "@x-agent-suite/contracts";

export type {
  ReportPaths,
  ScenarioReportRow,
  WriteReportsOptions,
} from "@x-agent-suite/contracts";

/** 默认输出目录：仓库根 .tmp/reports（按本文件位置推导，与 cwd 无关）。 */
const DEFAULT_OUT_DIR = fileURLToPath(
  new URL("../../../.tmp/reports", import.meta.url),
);

/** 校验用于报告文件名的单个安全路径段。 */
function assertSafeStamp(stamp: string): void {
  if (
    !stamp ||
    stamp === "." ||
    stamp === ".." ||
    stamp.includes("\0") ||
    stamp.includes("/") ||
    stamp.includes("\\") ||
    isAbsolute(stamp)
  ) {
    throw new Error(`stamp 必须是安全路径段：${JSON.stringify(stamp)}`);
  }
}

/** 解析并确认文件仍位于报告根目录下。 */
function resolveReportPath(root: string, filename: string): string {
  const target = resolve(root, filename);
  const nested = relative(root, target);
  if (
    !nested ||
    nested === ".." ||
    nested.startsWith(`..${sep}`) ||
    isAbsolute(nested)
  ) {
    throw new Error(`报告路径逃逸输出目录：${filename}`);
  }
  return target;
}

/** pass 标记：通过 ✓，失败 ✗。 */
function mark(pass: boolean): string {
  return pass ? "✓" : "✗";
}

/** 渲染 md 结论表。 */
/** 递归脱敏 JSON 值的键和值。 */
function redactJsonValue(
  value: unknown,
  redact: (text: string) => string,
): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value))
    return value.map((item) => redactJsonValue(item, redact));
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const safeKey = uniqueJsonKey(output, redact(key));
    output[safeKey] = redactJsonValue(nested, redact);
  }
  return output;
}

/** 为脱敏后碰撞的 JSON 键生成稳定且不含原值的后缀。 */
function uniqueJsonKey(
  output: Readonly<Record<string, unknown>>,
  base: string,
): string {
  let candidate = base;
  let suffix = 2;
  while (Object.hasOwn(output, candidate)) candidate = `${base}#${suffix++}`;
  return candidate;
}

/** 脱敏序列化异常，避免 V8 的循环属性路径暴露秘密。 */
function redactSerializationCause(
  cause: unknown,
  redact: NonNullable<WriteReportsOptions["redact"]> | undefined,
): unknown {
  if (!redact) return cause;
  if (!(cause instanceof Error)) return new Error(redact(String(cause)));
  const safe = new Error(redact(cause.message));
  safe.name = redact(cause.name);
  if (cause.stack) safe.stack = redact(cause.stack);
  return safe;
}

/** 先按 JSON 语义复制，再递归脱敏报告中的全部字符串。 */
function prepareRows<Artifact>(
  rows: readonly ScenarioReportRow<Artifact>[],
  redact: NonNullable<WriteReportsOptions["redact"]> | undefined,
): readonly ScenarioReportRow<Artifact>[] {
  let copied: unknown;
  try {
    copied = JSON.parse(JSON.stringify(rows));
  } catch (cause) {
    throw new Error("报告数据无法序列化（可能包含循环引用）", {
      cause: redactSerializationCause(cause, redact),
    });
  }
  return (
    redact ? redactJsonValue(copied, redact) : copied
  ) as ScenarioReportRow<Artifact>[];
}

/** 渲染 md 结论表。 */
function renderMarkdown<Artifact = Record<string, unknown>>(
  rows: readonly ScenarioReportRow<Artifact>[],
  scenarioId: string,
  stamp: string,
): string {
  const lines = [
    `# 报告：${scenarioId}（${stamp}）`,
    "",
    "| scenario | carrier | prompt | dry | hard | fuzzy | calls | 耗时(ms) | cost($) | error |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of rows) {
    const r = row.result;
    lines.push(
      `| ${row.scenario} | ${row.carrier} | ${row.promptVariant}` +
        ` | ${mark(r.dryPass)} | ${mark(r.hardPass)} | ${mark(r.fuzzyPass)}` +
        ` | ${r.observation.toolCallsCount} | ${r.latencyMs} | ${r.costUsd ?? "—"} | ${r.error ?? "—"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * 把 ScenarioResult 列表写成 md + json 报告。
 * @returns 实际落盘的两个文件路径。
 */
export async function writeScenarioReports<Artifact = Record<string, unknown>>(
  rows: readonly ScenarioReportRow<Artifact>[],
  options: WriteReportsOptions,
): Promise<ReportPaths> {
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const rawStamp =
    options.stamp ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
  const stamp = options.redact?.(rawStamp) ?? rawStamp;
  assertSafeStamp(stamp);
  const scenarioId = options.redact?.(options.scenarioId) ?? options.scenarioId;
  const safeRows = prepareRows(rows, options.redact);
  const scenarioSegment = encodeURIComponent(scenarioId);
  const mdPath = resolveReportPath(
    outDir,
    `${stamp}-${scenarioSegment}-report.md`,
  );
  const jsonPath = resolveReportPath(
    outDir,
    `${stamp}-${scenarioSegment}-report.json`,
  );
  await mkdir(outDir, { recursive: true });
  await writeFile(mdPath, renderMarkdown(safeRows, scenarioId, stamp), "utf8");
  await writeFile(
    jsonPath,
    JSON.stringify({ scenario: scenarioId, stamp, rows: safeRows }, null, 2),
    "utf8",
  );
  return { mdPath, jsonPath };
}
