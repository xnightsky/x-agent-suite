/**
 * @module @x-agent-suite/recall/load
 * 全量前置装载：显式 target、registry、effects-only Plan、场景 provision 与执行候选。
 * 不变量：不读取 x-agent-suite.config.ts；ExecutionPlan 不依赖 ScenarioSpec，不创建 Driver。
 */
import { resolve } from "node:path";
import type { ScenarioSpec } from "@x-agent-suite/contracts";
import { createHarnessLiveConfigHooks } from "@x-agent-suite/harness";
import {
  LIVE_CONFIG_PATH_ENV,
  loadLiveConfig,
  loadTargetTagCatalog,
  resolveLiveTargets,
  type LiveConfigOptions,
  type LiveTargetSelection,
} from "@x-agent-suite/llm-fixture";
import { findRecallFiles } from "./discovery.ts";
import { compileRecallFile } from "./compile.ts";
import { loadRecallEffectsPlan, type RecallEffects } from "./effects.ts";
import {
  resolveRecallExecution,
  type RecallResolvedExecution,
} from "./execution.ts";
import { loadRecallRegistry, type RecallRegistry } from "./registry.ts";
import { isNonEmptyString, isPositiveInteger, isRecord } from "./validation.ts";

/** Recall 装载选项；selection 至少包含 carrier/provider/model 之一。 */
export interface LoadRecallOptions {
  /** 调用 cwd。 */
  readonly cwd?: string;
  /** 私有全局 TargetTags 的发现 home；测试可注入隔离目录。 */
  readonly homeDir?: string;
  /** 显式考卷 YAML 或目录。 */
  readonly target?: string;
  /** 显式 target 选择器。 */
  readonly selection: LiveTargetSelection;
  /** 私密 live 配置路径，映射到 E2E_LIVE_CONFIG_PATH。 */
  readonly liveConfigPath?: string;
  /** 独立 Criterion/profile/EffectsProfile 注册表。 */
  readonly registryPath?: string;
  /** effects-only 执行 Plan。 */
  readonly planPath?: string;
  /** 仅当前调用的 live 审批。 */
  readonly approveLive?: boolean;
  /** 场景资源 rootDir。 */
  readonly rootDir?: string;
  /** 每个 case 的独立 repeat。 */
  readonly repeat?: number;
  /** 报告根目录。 */
  readonly outDir?: string;
}

/** effects-only ExecutionPlan；不含 driver/mode/cliRef/criteria/provision。 */
export interface RecallExecutionPlan {
  /** 已归一化的执行副作用策略。 */
  readonly effects: RecallEffects;
}

/** 已完成全部前置校验的 Recall 输入。 */
export interface LoadedRecall {
  /** 调用 cwd。 */
  readonly cwd: string;
  /** 场景资源根目录。 */
  readonly rootDir: string;
  /** 考卷文件列表。 */
  readonly files: readonly string[];
  /** 独立实现注册表。 */
  readonly registry: RecallRegistry;
  /** effects-only ExecutionPlan。 */
  readonly plan: RecallExecutionPlan;
  /** 编译后的场景。 */
  readonly scenarios: readonly ScenarioSpec[];
  /** 每个显式选择 target 的唯一执行实现。 */
  readonly executions: readonly RecallResolvedExecution[];
  /** 现有 live 配置与借用 hooks。 */
  readonly config: LiveConfigOptions;
  /** 每 case repeat。 */
  readonly repeat: number;
  /** 报告根目录。 */
  readonly outDir: string;
}

function validateSelection(selection: LiveTargetSelection): void {
  if (!isRecord(selection))
    throw new Error("Recall target selection 必须是对象");
  for (const value of Object.values(selection)) {
    if (value !== undefined && !isNonEmptyString(value)) {
      throw new Error("Recall target selection 值必须是非空字符串");
    }
  }
  if (!selection.carrier && !selection.provider && !selection.model) {
    throw new Error(
      "必须显式指定 --carrier/--provider/--model，拒绝隐式执行默认目标",
    );
  }
}

function liveConfigOptions(
  cwd: string,
  liveConfigPath?: string,
  homeDir?: string,
): LiveConfigOptions {
  const env = { ...process.env };
  if (liveConfigPath) env[LIVE_CONFIG_PATH_ENV] = liveConfigPath;
  return {
    env,
    repoRoot: cwd,
    ...(homeDir ? { homeDir } : {}),
    ...createHarnessLiveConfigHooks(),
  };
}

function assertUniqueScenarioIds(scenarios: readonly ScenarioSpec[]): void {
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.id))
      throw new Error("Recall Scenario ID 重复：" + scenario.id);
    seen.add(scenario.id);
  }
}

async function loadScenarios(
  files: readonly string[],
  rootDir: string,
  registry: RecallRegistry,
): Promise<readonly ScenarioSpec[]> {
  const scenarios: ScenarioSpec[] = [];
  for (const file of files) {
    scenarios.push(
      ...(await compileRecallFile(file, {
        rootDir,
        criteria: registry.criteria,
      })),
    );
  }
  assertUniqueScenarioIds(scenarios);
  return scenarios;
}

async function resolveExecutions(options: {
  readonly config: LiveConfigOptions;
  readonly selection: LiveTargetSelection;
  readonly effects: RecallEffects;
  readonly registry: RecallRegistry;
  readonly requireBorrowed: boolean;
  readonly approveLive: boolean;
}): Promise<readonly RecallResolvedExecution[]> {
  const live = await loadLiveConfig(options.config);
  const resolved = resolveLiveTargets(live, options.selection);
  if (resolved.kind !== "configured") {
    throw new Error("Recall live target 未配置：" + resolved.reason);
  }
  const catalog = await loadTargetTagCatalog({
    liveConfig: live,
    homeDir: options.config.homeDir,
  });
  return resolved.targets.map((target) =>
    resolveRecallExecution({
      target,
      catalog,
      effects: options.effects,
      registry: options.registry,
      requireBorrowed: options.requireBorrowed,
      liveReviewApproved: options.approveLive,
    }),
  );
}

/** 加载完整 Recall 输入；所有错误均发生在 Driver 创建之前。 */
export async function loadRecall(
  options: LoadRecallOptions,
): Promise<LoadedRecall> {
  validateSelection(options.selection);
  const cwd = resolve(options.cwd ?? process.cwd());
  if (options.repeat !== undefined && !isPositiveInteger(options.repeat)) {
    throw new Error("Recall repeat 必须是正整数");
  }
  const registryPath = options.registryPath
    ? resolve(cwd, options.registryPath)
    : undefined;
  const planPath = options.planPath
    ? resolve(cwd, options.planPath)
    : undefined;
  const registry = await loadRecallRegistry(registryPath);
  const effects = await loadRecallEffectsPlan(planPath, registry);
  const files = await findRecallFiles({
    cwd,
    target: options.target,
    excludePath: planPath,
  });
  const rootDir = options.rootDir ? resolve(cwd, options.rootDir) : cwd;
  const scenarios = await loadScenarios(files, rootDir, registry);
  const hasProvision = scenarios.some(
    (scenario) => scenario.provision !== undefined,
  );
  if (hasProvision && planPath === undefined) {
    throw new Error(
      "场景包含 provision，必须显式提供 --plan；direct 不得隐式挂载",
    );
  }

  const liveConfigPath = options.liveConfigPath
    ? resolve(cwd, options.liveConfigPath)
    : undefined;
  const config = liveConfigOptions(cwd, liveConfigPath, options.homeDir);
  const executions = await resolveExecutions({
    config,
    selection: options.selection,
    effects,
    registry,
    requireBorrowed: hasProvision || effects.kind !== "none",
    approveLive: options.approveLive ?? false,
  });
  return {
    cwd,
    rootDir,
    files,
    registry,
    plan: { effects },
    scenarios,
    executions,
    config,
    repeat: options.repeat ?? 1,
    outDir: options.outDir
      ? resolve(cwd, options.outDir)
      : resolve(cwd, ".tmp/x-agent-suite"),
  };
}
