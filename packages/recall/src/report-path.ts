/** @module @x-agent-suite/recall/report-path
 * 目标报告目录归因与路径安全，正常/错误报告使用同一规则。
 */
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { RecallResolvedExecution } from "./execution.ts";
import { encodeSafePathSegment } from "./validation.ts";
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
