/**
 * @module @x-agent-suite/observation/report
 * ScenarioResult 列表 → 报告文件：
 * 每次运行同时产出 .md（给人看的结论表）与 .json（完整明细）。
 * 不变量：写入前递归建目录；stamp 默认可生成、测试可钉死；
 * json 保留完整 Observation / artifact / tool 入参与 stdout/stderr tail（排查用）。
 */
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cloneJsonValue } from "@x-agent-suite/assertions";
import type {
  RepeatStats,
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
    Object.defineProperty(output, safeKey, {
      value: redactJsonValue(nested, redact),
      enumerable: true,
      configurable: true,
      writable: true,
    });
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
function prepareReportValue<Value>(
  value: Value,
  redact: NonNullable<WriteReportsOptions["redact"]> | undefined,
): Value {
  let copied: unknown;
  try {
    copied = cloneJsonValue(value, "报告数据", {
      omitUnsupportedObjectProperties: true,
    });
  } catch (cause) {
    throw new Error("报告数据无法序列化为严格 JSON（可能包含循环引用）", {
      cause: redactSerializationCause(cause, redact),
    });
  }
  return (redact ? redactJsonValue(copied, redact) : copied) as Value;
}

/** 渲染 md 结论表。 */
export function renderScenarioMarkdown<Artifact = Record<string, unknown>>(
  rows: readonly ScenarioReportRow<Artifact>[],
  scenarioId: string,
  stamp: string,
): string {
  const lines = [
    `# 报告：${scenarioId}（${stamp}）`,
    "",
    "| scenario | carrier | prompt | dry | hard | fuzzy | 稳定率 | calls | 耗时(ms) | cost($) | error |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of rows) {
    const r = row.result;
    lines.push(
      `| ${row.scenario} | ${row.carrier} | ${row.promptVariant}` +
        ` | ${mark(r.dryPass)} | ${mark(r.hardPass)} | ${mark(r.fuzzyPass)}` +
        ` | ${formatRepeat(row.repeat)}` +
        ` | ${r.observation.toolCallsCount} | ${r.latencyMs} | ${r.costUsd ?? "—"} | ${r.error ?? "—"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** 渲染稳定率单元格：通过率 + 可选聚合分均值。 */
function formatRepeat(repeat: RepeatStats | undefined): string {
  if (!repeat) return "—";
  const base = `${repeat.hardPassCount}/${repeat.runs}`;
  return repeat.score ? `${base} μ${repeat.score.mean.toFixed(2)}` : base;
}

/**
 * 把 ScenarioResult 列表写成 md + json 报告。
 * @returns 实际落盘的两个文件路径。
 */
export async function writeScenarioReports<Artifact = Record<string, unknown>>(
  rows: readonly ScenarioReportRow<Artifact>[],
  options: WriteReportsOptions,
): Promise<ReportPaths> {
  return writeReportDocument(rows, options, {
    suffix: "report",
    json: (safeRows, scenarioId, stamp) => ({
      scenario: scenarioId,
      stamp,
      rows: safeRows,
    }),
    markdown: renderScenarioMarkdown,
  });
}

/** 单文件原子发布：读者只见完整旧版或新版；不承诺 md/json 双文件事务。 */
async function publishReportFile(path: string, content: string): Promise<void> {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (cause) {
    try {
      await rm(temporary, { force: true });
    } catch (cleanup) {
      throw new AggregateError(
        [cause, cleanup],
        "报告发布与临时文件清理均失败",
      );
    }
    throw cause;
  }
}

/** 通用安全文档写盘：同源路径、严格 JSON、递归脱敏与 0600；不伪造结果行。 */
export async function writeReportDocument<Value>(
  value: Value,
  options: WriteReportsOptions,
  render: {
    readonly suffix: "report" | "diagnostic";
    readonly json: (safe: Value, scenario: string, stamp: string) => unknown;
    readonly markdown: (safe: Value, scenario: string, stamp: string) => string;
  },
): Promise<ReportPaths> {
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const rawStamp =
    options.stamp ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
  const stamp = options.redact?.(rawStamp) ?? rawStamp;
  assertSafeStamp(stamp);
  const scenarioId = options.redact?.(options.scenarioId) ?? options.scenarioId;
  const safe = prepareReportValue(value, options.redact);
  const stem = `${stamp}-${encodeURIComponent(scenarioId)}-${render.suffix}`;
  const mdPath = resolveReportPath(outDir, stem + ".md");
  const jsonPath = resolveReportPath(outDir, stem + ".json");
  const json = JSON.stringify(render.json(safe, scenarioId, stamp), null, 2);
  const markdown = render.markdown(safe, scenarioId, stamp);
  await mkdir(outDir, { recursive: true });
  for (const [path, content] of [
    [mdPath, markdown],
    [jsonPath, json],
  ] as const) {
    await publishReportFile(path, content);
  }
  return { mdPath, jsonPath };
}
