/**
 * @module cedar/change-report
 * 根据隔离工作区的改动清单生成 JSON 统计；先校验输入，再创建产物。
 * 不变量：只接受工作区内路径，禁止覆盖既有报告，不访问网络。
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function workspacePath(value) {
  if (typeof value !== "string" || !value) throw new Error("missing path");
  const path = resolve(value);
  const nested = relative(process.cwd(), path);
  if (nested === ".." || nested.startsWith(".." + sep) || isAbsolute(nested)) {
    throw new Error("path escapes workspace");
  }
  return path;
}

async function buildReport() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output") {
    throw new Error("expected --input <file> --output <file>");
  }
  const input = workspacePath(args[1]);
  const output = workspacePath(args[3]);
  const value = JSON.parse(await readFile(input, "utf8"));
  if (
    !Array.isArray(value?.changes) ||
    !value.changes.every(
      (item) =>
        item &&
        ["added", "fixed"].includes(item.type) &&
        typeof item.text === "string" &&
        item.text.trim(),
    )
  ) {
    throw new Error("invalid changes: expected added/fixed entries with text");
  }
  const report = {
    total: value.changes.length,
    added: value.changes.filter((item) => item.type === "added").length,
    fixed: value.changes.filter((item) => item.type === "fixed").length,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({ output: relative(process.cwd(), output), report }),
  );
}

try {
  await buildReport();
} catch (error) {
  console.error("CHANGE_INPUT_INVALID: " + error.message);
  process.exitCode = 1;
}
