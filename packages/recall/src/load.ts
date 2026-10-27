/**
 * @module @x-agent-suite/recall/load
 * 一次完成配置、发现、全部考卷与跨文件 ID 校验，然后才允许进入执行。
 */
import { dirname, resolve } from "node:path";
import type { ScenarioSpec } from "@x-agent-suite/contracts";
import { loadRecallConfig, type RecallConfig } from "./config.ts";
import { findRecallConfig, findRecallFiles } from "./discovery.ts";
import { compileRecallFile } from "./compile.ts";

/** Recall 加载选项；路径均相对 cwd，cwd 缺省 process.cwd()。 */
export interface LoadRecallOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly target?: string;
}

/** 已通过全部定义校验的一次 Recall 运行输入。 */
export interface LoadedRecall {
  readonly cwd: string;
  readonly configPath: string;
  readonly files: readonly string[];
  readonly rootDir: string;
  readonly config: RecallConfig;
  readonly scenarios: readonly ScenarioSpec[];
}

/** 加载完整 Recall 输入；此函数不调用 createDriver。 */
export async function loadRecall(
  options: LoadRecallOptions = {},
): Promise<LoadedRecall> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = await findRecallConfig(cwd, options.configPath);
  const config = await loadRecallConfig(configPath);
  const files = await findRecallFiles({
    cwd,
    configPath,
    target: options.target,
    configuredFiles: config.files,
  });
  const rootDir = config.rootDir
    ? resolve(dirname(configPath), config.rootDir)
    : cwd;
  const scenarios: ScenarioSpec[] = [];
  for (const file of files) {
    scenarios.push(
      ...(await compileRecallFile(file, {
        rootDir,
        criteria: config.criteria,
      })),
    );
  }
  assertUniqueScenarioIds(scenarios);
  return { cwd, configPath, files, rootDir, config, scenarios };
}

function assertUniqueScenarioIds(scenarios: readonly ScenarioSpec[]): void {
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) {
      throw new Error("Recall 编译后的 Scenario ID 重复：" + scenario.id);
    }
    seen.add(scenario.id);
  }
}
