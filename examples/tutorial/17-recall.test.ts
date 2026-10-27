/**
 * 教程：原生 .recall 自动发现、严格编译、多轮执行与双格式报告（零 token）。
 * 运行：pnpm tutorial:recall。本文件是消费者侧示例，不是框架 API。
 */
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRecall } from "@x-agent-suite/recall";
import { main } from "../../packaging/cli.ts";
import { printTutorialSummary, resolveTutorialOutDir } from "./support.ts";

test("tutorial/recall：自动发现多轮考卷并生成报告", async () => {
  const outDir = resolveTutorialOutDir(".tmp/tutorial/recall");
  const cwd = await mkdtemp(join(tmpdir(), "xas-tutorial-recall-"));
  try {
    await mkdir(join(cwd, ".recall"));
    await writeFile(join(cwd, "package.json"), '{"type":"module"}\n');
    await writeFile(join(cwd, "CONTEXT.md"), "read only context");
    await writeFile(
      join(cwd, ".recall", "x-agent-suite.config.ts"),
      "export { default } from " +
        JSON.stringify(
          new URL("./fixtures/tutorial-recall.config.ts", import.meta.url).href,
        ) +
        ";\n",
    );
    await writeFile(
      join(cwd, ".recall", "project-rules.yaml"),
      `version: 1
id: tutorial-recall
context:
  files: [CONTEXT.md]
cases:
  - id: multi-turn
    turns:
      - send: first
        expect:
          text-contains: [first]
      - send: second
        expect:
          text-contains: [second]
`,
    );
    const loaded = await loadRecall({ cwd });
    const provision = loaded.scenarios[0]!.provision as {
      context: { files: { path: string; content: string }[] };
    };
    assert.equal(provision.context.files[0]!.content, "read only context");

    const before = new Set(await readdir(outDir).catch(() => []));
    const exitCode = await main(["recall"], { cwd });
    assert.equal(exitCode, 0);
    const files = (await readdir(outDir)).filter(
      (file) => file.endsWith("-report.json") && !before.has(file),
    );
    assert.equal(files.length, 1);
    const report = JSON.parse(await readFile(join(outDir, files[0]!), "utf8"));
    assert.equal(report.scenario, "tutorial-recall/multi-turn");
    printTutorialSummary({
      recipe: "recall",
      exitCode,
      reports: files.length,
      scenario: report.scenario,
      turns: loaded.scenarios[0]!.turns.length,
      contextPath: provision.context.files[0]!.path,
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
