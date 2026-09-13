/**
 * @module @x-agent-suite/runner/tests/cli
 * CLI 端到端：mock config 声明 3 场景，一条命令出报告；退出码只反映基础设施失败。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRunConfig, main } from "../src/cli.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "mock-run.config.ts");

/** 在独立临时目录跑一次 CLI。 */
async function runCli(): Promise<{ code: number; outDir: string }> {
  const outDir = await mkdtemp(join(tmpdir(), "xas-runner-cli-"));
  const previous = process.env.XAS_TEST_OUT_DIR;
  process.env.XAS_TEST_OUT_DIR = outDir;
  try {
    const code = await main(["run", FIXTURE]);
    return { code, outDir };
  } finally {
    if (previous === undefined) {
      delete process.env.XAS_TEST_OUT_DIR;
    } else {
      process.env.XAS_TEST_OUT_DIR = previous;
    }
  }
}

test("3 场景一条命令：行为失败不影响退出码，报告含 coverage", async () => {
  const { code, outDir } = await runCli();
  try {
    assert.equal(code, 0);
    const files = await readdir(outDir);
    const jsonReports = files.filter((file) => file.endsWith("-report.json"));
    assert.equal(jsonReports.length, 3, "三个场景应各出一份 JSON 报告");
    const passReport = jsonReports.find((file) =>
      file.includes(encodeURIComponent("demo/pass")),
    );
    assert.ok(passReport, "应存在 demo/pass 的报告");
    const serialized = await readFile(join(outDir, passReport), "utf8");
    assert.ok(serialized.includes("coverage"), "PASS 场景报告应含 coverage");
    assert.ok(
      serialized.includes("hardPassRate"),
      "config repeat: 2 应让报告含稳定率维度",
    );
    const mdReports = files.filter((file) => file.endsWith("-report.md"));
    assert.equal(mdReports.length, 3);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("diff 子命令：基线与候选对比点名维度迁移", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xas-runner-diff-"));
  try {
    const makeReport = (score: number, state: string, hardPass: boolean) => ({
      scenario: "demo/diff",
      stamp: "s",
      rows: [
        {
          scenario: "demo/diff",
          carrier: "default",
          promptVariant: "default",
          result: {
            observation: {
              text: "",
              toolCalls: [],
              toolCallsCount: 0,
              events: [],
            },
            artifact: {
              outcomes: [],
              aggregate: {
                pass: hardPass,
                score,
                rawScore: score,
                maxScore: 1,
                coverage: { evaluated: 1, total: 1 },
                dimensions: [
                  {
                    metric: "text-contains",
                    state,
                    contribution: score,
                    reason: "",
                  },
                ],
                reason: "",
              },
            },
            dryPass: true,
            hardPass,
            fuzzyPass: hardPass,
            latencyMs: 1,
          },
        },
      ],
    });
    const beforePath = join(dir, "before-report.json");
    const afterPath = join(dir, "after-report.json");
    await writeFile(beforePath, JSON.stringify(makeReport(1, "hit", true)));
    await writeFile(afterPath, JSON.stringify(makeReport(0, "miss", false)));

    const logs: string[] = [];
    const original = console.log;
    console.log = (line: string) => logs.push(String(line));
    let code = 2;
    try {
      code = await main(["diff", beforePath, afterPath]);
    } finally {
      console.log = original;
    }
    assert.equal(code, 0);
    const output = logs.join("\n");
    assert.ok(output.includes("CHANGED demo/diff"), output);
    assert.ok(output.includes("text-contains hit→miss"), output);
    assert.ok(output.includes("Δ-1.00"), output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("用法错误返回 2；config 路径不存在显式抛错", async () => {
  assert.equal(await main([]), 2);
  await assert.rejects(() =>
    loadRunConfig(FIXTURE.replace("mock-run", "ghost")),
  );
});
