#!/usr/bin/env node
/**
 * @module scripts/check-boundary
 * 边界守卫：扫描 packages/ 与 tests/，禁止具体被测系统标识泄露。
 *
 * 设计约束：本库是通用 Agent 测试套件框架，不认识任何具体 Agent / CLI / 宿主 /
 * 协议 / 判据名。凡领域特有概念，应通过注册表或 metadata 自由区表达。
 *
 * 豁免机制：含 `BOUNDARY-DEBT(<消费者>): <原因与回收条件>` 标记的行豁免检查；
 * 独占一行的标记也可豁免下一非空行。两种形式都计入债务清单。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["packages", "tests"];
const SCAN_EXTENSIONS = new Set([".ts", ".mjs", ".js", ".mts", ".cts"]);

const DEBT_MARKER = /BOUNDARY-DEBT\s*\([^)]+\):/;
const STANDALONE_DEBT_MARKER = /^\s*\/\/\s*BOUNDARY-DEBT\s*\([^)]+\):/;

// 初始空词汇表。随着消费者接入和具体 profile 落地，逐步补充。
// 注意：通用词（如 agent、driver、observation、scenario）不应加入。
const FORBIDDEN = [
  // 已知的具体 CLI / 宿主名示例（后续按需扩展）
  { pattern: /\bkimi\b/i, hint: "具体 CLI 名，应作为 profile 注册" },
  { pattern: /\bcodex\b/i, hint: "具体 CLI 名，应作为 profile 注册" },
  { pattern: /\bclaude\b/i, hint: "具体 CLI 名，应作为 profile 注册" },
  { pattern: /\bgemini\b/i, hint: "具体 CLI 名，应作为 profile 注册" },
  { pattern: /\bpi\b/i, hint: "具体 CLI 名，应作为 profile 注册" },
];

const DEBT_WARN_THRESHOLD = 10;

// 测试目录可包含具体宿主用例，不参与词汇阻断；其中的 BOUNDARY-DEBT 仍读取并计数。
const SKIP_DIRS = ["packages/harness/tests", "packages/llm-fixture/tests"];

async function collectFiles(dir) {
  const absolute = path.join(ROOT, dir);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true, recursive: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name)),
    )
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter((file) => !file.split(path.sep).includes("node_modules"));
}

async function main() {
  const violations = [];
  const debts = [];
  let scanned = 0;

  for (const dir of SCAN_DIRS) {
    for (const file of await collectFiles(dir)) {
      scanned += 1;
      const relative = path.relative(ROOT, file).replaceAll("\\", "/");
      const skipViolations = SKIP_DIRS.some((skip) =>
        relative.startsWith(`${skip}/`),
      );
      const lines = (await readFile(file, "utf8")).split(/\r?\n/);

      const debtExemptions = new Set();
      lines.forEach((line, index) => {
        if (DEBT_MARKER.test(line)) {
          debts.push({ file: relative, line: index + 1, text: line.trim() });
          if (STANDALONE_DEBT_MARKER.test(line)) {
            let next = index + 1;
            while (next < lines.length && lines[next].trim() === "") next += 1;
            debtExemptions.add(next);
          }
        }
      });

      lines.forEach((line, index) => {
        if (DEBT_MARKER.test(line) || debtExemptions.has(index)) return;
        if (skipViolations) return;
        for (const { pattern, hint } of FORBIDDEN) {
          if (pattern.test(line)) {
            violations.push({
              file: relative,
              line: index + 1,
              text: line.trim(),
              hint,
            });
            break;
          }
        }
      });
    }
  }

  console.log(`边界守卫：扫描 ${scanned} 个文件（${SCAN_DIRS.join(", ")}）`);

  if (debts.length > 0) {
    console.log(`\n边界债务 ${debts.length} 条：`);
    for (const debt of debts) {
      console.log(`  ${debt.file}:${debt.line}  ${debt.text}`);
    }
    if (debts.length > DEBT_WARN_THRESHOLD) {
      console.log(
        `\n  提示：债务超过 ${DEBT_WARN_THRESHOLD} 条，建议做一次回收。`,
      );
    }
  }

  if (violations.length > 0) {
    console.error(`\n发现 ${violations.length} 处领域词汇泄漏：\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ${violation.text}`);
      console.error(`    → ${violation.hint}\n`);
    }
    console.error("处理方式（按优先级）：");
    console.error("  1. 改用 metadata / evidence 自由区表达");
    console.error("  2. 改为注册机制（判据 / driver / profile / 失败类别）");
    console.error(
      "  3. 确实必须穿透：加 // BOUNDARY-DEBT(<消费者>): <原因与回收条件>",
    );
    process.exit(1);
  }

  console.log(
    `\n边界守卫通过：${SCAN_DIRS.map((d) => `${d}/`).join(" 与 ")} 内无领域词汇泄漏。`,
  );
}

await main();
