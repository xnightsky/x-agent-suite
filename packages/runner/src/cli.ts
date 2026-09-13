/**
 * @module @x-agent-suite/runner/cli
 * CLI 入口：`x-agent-suite run <config-module>`。
 * 不变量：
 * - 退出码只反映基础设施失败（配置错误、driver 异常），评分不达标不影响退出码
 *   （确定性层与行为层分离，见 docs/spec/scenario-evaluation.md）；
 * - 配置文件为代码模块（判据与 driver 工厂本就是代码，YAML 放不下函数）。
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ReportDocument, ScenarioSpec } from "@x-agent-suite/contracts";
import {
  diffScenarioReports,
  writeScenarioReports,
  type ReportDiffLens,
  type ScenarioReportDiff,
} from "@x-agent-suite/observation";
import {
  runScenarioSpec,
  type RunnerArtifact,
  type RunScenarioSpecDeps,
} from "./run-scenario.ts";
import { runScenarioRepeat } from "./repeat.ts";

/** 运行配置：config 模块的 default 导出形状。 */
export interface RunConfig {
  /** 待跑场景（声明 1+ 个）。 */
  readonly scenarios: readonly ScenarioSpec[];
  /** 消费者 driver 工厂。 */
  readonly createDriver: RunScenarioSpecDeps["createDriver"];
  /** 可用判据集。 */
  readonly criteria: RunScenarioSpecDeps["criteria"];
  /** 报告输出目录（缺省 .tmp/x-agent-suite）。 */
  readonly outDir?: string;
  /** 每个场景重复执行次数（缺省 1；大于 1 时报告含稳定率维度）。 */
  readonly repeat?: number;
}

/** 加载 config 模块并校验形状；非法显式抛错。 */
export async function loadRunConfig(configPath: string): Promise<RunConfig> {
  const module = (await import(pathToFileURL(resolve(configPath)).href)) as {
    default?: Partial<RunConfig>;
  };
  const config = module.default;
  if (
    !config ||
    !Array.isArray(config.scenarios) ||
    config.scenarios.length === 0 ||
    typeof config.createDriver !== "function" ||
    !Array.isArray(config.criteria)
  ) {
    throw new Error(
      `config 必须 default 导出 { scenarios（非空数组）, createDriver（函数）, criteria（数组） }：${configPath}`,
    );
  }
  return config as RunConfig;
}

/** RunnerArtifact 的 diff 镜头：聚合分 + 维度状态。 */
const runnerLens: ReportDiffLens = {
  score: (artifact) =>
    (artifact as RunnerArtifact | undefined)?.aggregate?.score,
  dimensions: (artifact) =>
    (artifact as RunnerArtifact | undefined)?.aggregate?.dimensions.map(
      (dimension) => ({
        metric: Array.isArray(dimension.metric)
          ? dimension.metric.join("+")
          : (dimension.metric as string),
        state: dimension.state,
      }),
    ) ?? [],
};

/** 读取一个报告 JSON 文件。 */
async function readReport(path: string): Promise<ReportDocument> {
  return JSON.parse(await readFile(path, "utf8")) as ReportDocument;
}

/** 加载 diff 输入：单个 JSON 文件或目录（收集 *-report.json 按场景索引）。 */
async function loadDiffTarget(
  path: string,
): Promise<Map<string, ReportDocument>> {
  const reports = new Map<string, ReportDocument>();
  const info = await stat(path);
  const files = info.isDirectory()
    ? (await readdir(path))
        .filter((file) => file.endsWith("-report.json"))
        .map((file) => join(path, file))
    : [path];
  for (const file of files) {
    const report = await readReport(file);
    reports.set(report.scenario, report);
  }
  return reports;
}

/** 渲染一个场景的 diff 行。 */
function formatDiff(diff: ScenarioReportDiff): string {
  if (!diff.changed) return `UNCHANGED ${diff.scenario}`;
  const parts: string[] = [];
  if (diff.hardPass) {
    parts.push(
      `hardPass ${diff.hardPass.before ? "✓" : "✗"}→${diff.hardPass.after ? "✓" : "✗"}`,
    );
  }
  if (diff.score) {
    parts.push(
      `score ${diff.score.before}→${diff.score.after}（Δ${diff.score.delta.toFixed(2)}）`,
    );
  }
  for (const dimension of diff.dimensions) {
    parts.push(`${dimension.metric} ${dimension.before}→${dimension.after}`);
  }
  if (diff.hardPassRate) {
    parts.push(`稳定率 ${diff.hardPassRate.before}→${diff.hardPassRate.after}`);
  }
  return `CHANGED ${diff.scenario}：${parts.join("；")}`;
}

/** diff 子命令：对比两份报告（文件或目录），返回进程退出码。 */
async function diffMain(argv: readonly string[]): Promise<number> {
  const [beforePath, afterPath] = argv;
  if (!beforePath || !afterPath) {
    console.error(
      "用法：x-agent-suite diff <before.json|目录> <after.json|目录>",
    );
    return 2;
  }
  const before = await loadDiffTarget(beforePath);
  const after = await loadDiffTarget(afterPath);
  let changedCount = 0;
  for (const [scenario, afterReport] of after) {
    const beforeReport = before.get(scenario);
    if (!beforeReport) {
      console.log(`NEW ${scenario}（基线中不存在）`);
      continue;
    }
    const diff = diffScenarioReports(beforeReport, afterReport, runnerLens);
    if (diff.changed) changedCount += 1;
    console.log(formatDiff(diff));
  }
  for (const scenario of before.keys()) {
    if (!after.has(scenario))
      console.log(`REMOVED ${scenario}（候选中不存在）`);
  }
  console.log(`diff 完成：${changedCount} 个场景有变化`);
  return 0;
}

/** CLI 主入口；返回进程退出码。 */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, configPath] = argv;
  if (command === "diff") {
    return diffMain(argv.slice(1));
  }
  // 命令名对齐业界词汇（promptfoo eval / inspect eval），run 保留为别名。
  if ((command !== "run" && command !== "eval") || !configPath) {
    console.error(
      "用法：x-agent-suite eval <config-module>（或 run <config-module>）",
    );
    return 2;
  }
  const config = await loadRunConfig(configPath);
  const outDir = config.outDir ?? ".tmp/x-agent-suite";
  const repeat = config.repeat ?? 1;
  let infraFailures = 0;

  for (const spec of config.scenarios) {
    try {
      if (repeat > 1) {
        const { results, stats } = await runScenarioRepeat(spec, {
          createDriver: config.createDriver,
          criteria: config.criteria,
          repeat,
        });
        const last = results[results.length - 1]!;
        await writeScenarioReports(
          [
            {
              scenario: spec.id,
              carrier: "default",
              promptVariant: "default",
              result: last,
              repeat: stats,
            },
          ],
          { scenarioId: spec.id, outDir },
        );
        const aggregate = (last.artifact as RunnerArtifact).aggregate;
        const scoreText = aggregate ? ` score=${aggregate.score}` : "";
        console.log(
          `${last.hardPass ? "PASS" : "FAIL"} ${spec.id} 稳定率=${stats.hardPassCount}/${stats.runs}${scoreText}`,
        );
        continue;
      }
      const result = await runScenarioSpec(spec, {
        createDriver: config.createDriver,
        criteria: config.criteria,
      });
      const aggregate = (result.artifact as RunnerArtifact).aggregate;
      await writeScenarioReports(
        [
          {
            scenario: spec.id,
            carrier: "default",
            promptVariant: "default",
            result,
          },
        ],
        { scenarioId: spec.id, outDir },
      );
      const scoreText = aggregate
        ? ` score=${aggregate.score} coverage=${aggregate.coverage.evaluated}/${aggregate.coverage.total}`
        : "";
      console.log(
        `${result.hardPass ? "PASS" : "FAIL"} ${spec.id}${scoreText}`,
      );
    } catch (error) {
      infraFailures += 1;
      console.error(
        `ERROR ${spec.id}：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return infraFailures > 0 ? 1 : 0;
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
