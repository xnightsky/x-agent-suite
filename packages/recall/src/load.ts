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
  type LiveConfigLoad,
  type LiveConfigOptions,
  type LiveTargetSelection,
  type TargetTagCatalog,
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
import { copyExecutionParams } from "./execution-params.ts";

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
  /** effects-only 执行 Plan 文件或 use:权限引用。 */
  readonly planPath?: string;
  /** 仅当前调用的 live 审批。 */
  readonly approveLive?: boolean;
  /** 场景资源 rootDir。 */
  readonly rootDir?: string;
  /** 每个 case 的独立 repeat。 */
  readonly repeat?: number;
  /** 报告根目录。 */
  readonly outDir?: string;
  /** 本次调用的执行参数，仅由选中的消费者 Profile/Adapter 解释。 */
  readonly executionParams?: Readonly<Record<string, unknown>>;
}

/** effects-only ExecutionPlan；不含 driver/mode/cliRef/criteria/provision。 */
export interface RecallExecutionPlan {
  /** 已归一化的执行副作用策略。 */
  readonly effects: RecallEffects;
}

/** loadRecallCore 结果：公开加载结果 + 装配所需的同源 catalog 与归一化批准。 */
export interface RecallLoadCore {
  /** 公开加载形状，与 loadRecall 返回值一致。 */
  readonly loaded: LoadedRecall;
  /** 与主执行同源的四层能力目录；不公开到包 index。 */
  readonly catalog: TargetTagCatalog;
  /** 归一化后的本次命令 live 批准（approveLive ?? false）。 */
  readonly liveReviewApproved: boolean;
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
  /** 经 JSON 校验的本次调用参数，不进入渠道、标签或考卷。 */
  readonly executionParams: Readonly<Record<string, unknown>>;
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

/** 单次加载 live 配置并构建同源 catalog；target 解析与判据装配共用这一次结果。 */
async function resolveLiveCatalog(options: {
  readonly config: LiveConfigOptions;
}): Promise<{
  readonly live: LiveConfigLoad;
  readonly catalog: TargetTagCatalog;
}> {
  const live = await loadLiveConfig(options.config);
  const catalog = await loadTargetTagCatalog({
    liveConfig: live,
    homeDir: options.config.homeDir,
  });
  return { live, catalog };
}

async function resolveExecutions(options: {
  readonly live: LiveConfigLoad;
  readonly selection: LiveTargetSelection;
  readonly effects: RecallEffects;
  readonly registry: RecallRegistry;
  readonly catalog: TargetTagCatalog;
  readonly liveReviewApproved: boolean;
}): Promise<readonly RecallResolvedExecution[]> {
  const resolved = resolveLiveTargets(options.live, options.selection);
  if (resolved.kind !== "configured") {
    throw new Error("Recall live target 未配置：" + resolved.reason);
  }
  return resolved.targets.map((target) =>
    resolveRecallExecution({
      target,
      catalog: options.catalog,
      effects: options.effects,
      registry: options.registry,
      liveReviewApproved: options.liveReviewApproved,
    }),
  );
}

/** 归一本次调用的全部路径；不读取文件，不做存在性检查。 */
function resolveLoadPaths(
  cwd: string,
  options: Pick<
    LoadRecallOptions,
    "registryPath" | "planPath" | "rootDir" | "liveConfigPath" | "outDir"
  >,
): {
  readonly registryPath?: string;
  readonly planPath?: string;
  readonly rootDir: string;
  readonly liveConfigPath?: string;
  readonly outDir: string;
} {
  return {
    ...(options.registryPath
      ? { registryPath: resolve(cwd, options.registryPath) }
      : {}),
    ...(options.planPath
      ? {
          planPath: options.planPath.startsWith("use:")
            ? options.planPath
            : resolve(cwd, options.planPath),
        }
      : {}),
    rootDir: options.rootDir ? resolve(cwd, options.rootDir) : cwd,
    ...(options.liveConfigPath
      ? { liveConfigPath: resolve(cwd, options.liveConfigPath) }
      : {}),
    outDir: options.outDir
      ? resolve(cwd, options.outDir)
      : resolve(cwd, ".tmp/x-agent-suite"),
  };
}

/**
 * 加载完整 Recall 输入并保留装配所需同源数据（catalog 与归一化批准）。
 * 所有错误均发生在 Driver 创建之前；不公开到包 index，仅供 run 装配使用。
 */
export async function loadRecallCore(
  options: LoadRecallOptions,
): Promise<RecallLoadCore> {
  validateSelection(options.selection);
  const executionParams = copyExecutionParams(options.executionParams ?? {});
  const cwd = resolve(options.cwd ?? process.cwd());
  if (options.repeat !== undefined && !isPositiveInteger(options.repeat)) {
    throw new Error("Recall repeat 必须是正整数");
  }
  const paths = resolveLoadPaths(cwd, options);
  const registry = await loadRecallRegistry(paths.registryPath);
  const effects = await loadRecallEffectsPlan(paths.planPath, registry);
  const files = await findRecallFiles({
    cwd,
    target: options.target,
    excludePath: paths.planPath?.startsWith("use:")
      ? undefined
      : paths.planPath,
  });
  const scenarios = await loadScenarios(files, paths.rootDir, registry);
  const config = liveConfigOptions(cwd, paths.liveConfigPath, options.homeDir);
  const liveReviewApproved = options.approveLive ?? false;
  const { live, catalog } = await resolveLiveCatalog({ config });
  const executions = await resolveExecutions({
    live,
    selection: options.selection,
    effects,
    registry,
    catalog,
    liveReviewApproved,
  });
  return {
    catalog,
    liveReviewApproved,
    loaded: {
      cwd,
      executionParams,
      rootDir: paths.rootDir,
      files,
      registry,
      plan: { effects },
      scenarios,
      executions,
      config,
      repeat: options.repeat ?? 1,
      outDir: paths.outDir,
    },
  };
}

/** 加载完整 Recall 输入；所有错误均发生在 Driver 创建之前。 */
export async function loadRecall(
  options: LoadRecallOptions,
): Promise<LoadedRecall> {
  return (await loadRecallCore(options)).loaded;
}
