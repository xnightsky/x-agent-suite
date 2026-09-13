/**
 * 教程：Scenario Runner 一条命令跑完整考卷（纯 mock、零 token）。
 * 场景：CLI 加载 config（3 场景）→ 逐场景 driver/判据/聚合 → md+json 报告。
 * 运行：pnpm tutorial:runner（或 pnpm test 中自动跑）。
 * 覆盖对象：@x-agent-suite/runner 的 main / runScenarioSpec。
 * 注意：本文件是教程示例，不是框架 API。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { main } from "@x-agent-suite/runner";
import { printTutorialSummary, resolveTutorialOutDir } from "./support.ts";

/** 报告 JSON 中与聚合相关的最小形状。 */
interface ReportJson {
  readonly rows: readonly {
    readonly result: {
      readonly hardPass: boolean;
      readonly artifact?: {
        readonly aggregate?: {
          readonly score: number;
          readonly coverage: {
            readonly evaluated: number;
            readonly total: number;
          };
        };
      };
    };
    readonly repeat?: {
      readonly runs: number;
      readonly hardPassCount: number;
    };
  }[];
}

test("tutorial/scenario-runner：eval 一条命令跑 3 场景并出报告", async () => {
  const outDir = resolveTutorialOutDir(".tmp/tutorial/scenario-runner");
  const configPath = join(
    import.meta.dirname,
    "fixtures",
    "tutorial-runner.config.ts",
  );
  const exitCode = await main(["eval", configPath]);
  assert.equal(exitCode, 0, "行为失败不影响退出码");

  const files = (await readdir(outDir)).filter((file) =>
    file.endsWith("-report.json"),
  );
  assert.equal(files.length, 3, "三个场景应各出一份 JSON 报告");

  const scenarios = [];
  for (const file of files) {
    const report = JSON.parse(
      await readFile(join(outDir, file), "utf8"),
    ) as ReportJson;
    const row = report.rows[0]!;
    scenarios.push({
      hardPass: row.result.hardPass,
      score: row.result.artifact?.aggregate?.score ?? null,
      coverage: row.result.artifact?.aggregate?.coverage ?? null,
      repeat: row.repeat ?? null,
    });
  }
  const passScenario = scenarios.find((item) => item.score !== null);
  assert.ok(passScenario?.coverage, "聚合场景应含 coverage");

  printTutorialSummary({
    recipe: "scenario-runner",
    exitCode,
    reports: files.length,
    scenarios,
  });
});
