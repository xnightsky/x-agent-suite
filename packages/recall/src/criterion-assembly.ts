/**
 * @module @x-agent-suite/recall/criterion-assembly
 * 按已选 target 装配实际引用的动态判据；每 target 每工厂恰好调用一次。
 * 不变量：
 * - 引用收集只看 expect 键存在性（Object.keys 语义），false/0/null/空串均算引用；
 * - 装配只准备闭包与无资源 client，不启动 Driver、不联网、不调用模型；
 * - 工厂返回的 name/scope 必须与声明严格一致，装配不得增减判据或改变考卷选择；
 * - 装配错误只含 scope:name 与阶段（create / 形状校验），不回显 context/config 或插件异常内容。
 */
import { createRecallCompositionCriteria } from "./first-of-criterion.ts";
import { mechanicalEntries } from "./first-of-dsl.ts";
import type { Criterion, ScenarioSpec } from "@x-agent-suite/contracts";
import type {
  LiveConfigOptions,
  TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";
import type { RecallEffects } from "./effects.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import type {
  RecallCriterionFactory,
  RecallCriterionFactoryContext,
  RecallCriterionRegistration,
  RecallRegistry,
} from "./registry.ts";
import { isRecord } from "./validation.ts";
import { createRecallJudgeCriteria } from "./judge-criterion.ts";
import { preflightRecallAssertionScores } from "./assertion-score.ts";
import { recallVariableResolver } from "./recall-var.ts";

/** assembleRecallCriteria 入参。 */
export interface AssembleRecallCriteriaOptions {
  /** 独立 registry 声明（静态判据 + 通用工厂）。 */
  readonly registry: RecallRegistry;
  /** 已编译场景；引用收集扫描 turn 与 case expect。 */
  readonly scenarios: readonly ScenarioSpec[];
  /** 当前已选 target 的执行实现。 */
  readonly execution: RecallResolvedExecution;
  /** 现有 live 配置与借用 hooks。 */
  readonly config: LiveConfigOptions;
  /** 通用四层能力目录（与主执行同源）。 */
  readonly catalog: TargetTagCatalog;
  /** 本次命令归一化后的 live 批准。 */
  readonly liveReviewApproved: boolean;
  /** 已归一化的执行副作用策略。 */
  readonly effects: RecallEffects;
}

/**
 * 收集全部场景机械判据引用；内部 Judge 键由专用装配器处理。
 *
 * @behavior recall-criterion-reference-presence
 * Given: 编译场景的 turn/session expect 和 Recall 私有 Judge 元数据。
 * When: 按 Object.keys 收集引用并区分 scope。
 * Then: false、0、null、空串均算已引用；内部 Judge 名不重复计入机械判据集合。
 * Failure: 不解释 expect 内容、不求值、不调用工厂；falsy 不得被当成未声明。
 */
function collectReferences(
  scenarios: readonly ScenarioSpec[],
): ReadonlySet<string> {
  const referenced = new Set<string>();
  for (const scenario of scenarios) {
    for (const turn of scenario.turns) {
      for (const [name] of mechanicalEntries(turn.expect)) {
        referenced.add("turn:" + name);
      }
    }
    for (const [name] of mechanicalEntries(scenario.expect))
      referenced.add("session:" + name);
  }
  return referenced;
}

/** 判别注册项是通用工厂（加载期已保证 evaluate/create 恰居其一）。 */
function isCriterionFactory(
  registration: RecallCriterionRegistration,
): registration is RecallCriterionFactory {
  return "create" in registration && typeof registration.create === "function";
}

/**
 * 调用单个判据工厂并约束对外错误边界。
 *
 * @behavior recall-criterion-factory-error-boundary
 * Given: 已声明工厂、同源装配上下文和 scope:name 键。
 * When: await 工厂 create 并核对返回值。
 * Then: 返回 name/scope 与声明一致且含 evaluate 函数的 Criterion。
 * Failure: create 异常包装时保留 cause；畸形返回走形状校验错误；
 * 顶层 message 只含判据键与阶段，不回显 config、context 或插件敏感内容。
 */
async function createFromFactory(
  factory: RecallCriterionFactory,
  context: RecallCriterionFactoryContext,
  key: string,
): Promise<Criterion> {
  let returned: unknown;
  try {
    returned = await factory.create(context);
  } catch (cause) {
    throw new Error(`Recall 判据装配失败：${key}（阶段：create）`, { cause });
  }
  if (
    !isRecord(returned) ||
    typeof returned.evaluate !== "function" ||
    returned.name !== factory.name ||
    returned.scope !== factory.scope
  ) {
    throw new Error(`Recall 判据装配失败：${key}（阶段：形状校验）`);
  }
  return returned as unknown as Criterion;
}

/**
 * 按已选 target 装配实际引用的动态判据；静态判据原样保留，工厂按声明顺序就地替换。
 * 未引用工厂不调用；case expect 可引用 session 判据，内置 Judge 单独展开。
 *
 * @behavior recall-criterion-assembly
 * Given: 独立 registry、编译场景和同源执行上下文。
 * When: 收集 turn/session expect 引用并装配实际使用的工厂。
 * Then: 静态判据保持原对象与顺序；每 target 每工厂至多创建一次；
 * context.variables 提供同一无状态 Recall 解析器，不启动 Driver 或联网。
 * Failure: 工厂异常或返回 name/scope/evaluate 形状不符均中止装配，
 * 对外错误只含判据键和阶段，不回显配置或插件敏感细节。
 */
export async function assembleRecallCriteria(
  options: AssembleRecallCriteriaOptions,
): Promise<readonly Criterion[]> {
  preflightRecallAssertionScores(options);
  const referenced = collectReferences(options.scenarios);
  const { execution } = options;
  const context: RecallCriterionFactoryContext = {
    target: execution.target,
    config: options.config,
    tags: options.catalog,
    liveReviewApproved: options.liveReviewApproved,
    ...(execution.cliRef ? { cliRef: execution.cliRef } : {}),
    ...(execution.clientRef ? { clientRef: execution.clientRef } : {}),
    effects: options.effects,
    variables: recallVariableResolver,
  };
  const assembled: Criterion[] = [];
  for (const registration of options.registry.criteria) {
    if (!isCriterionFactory(registration)) {
      assembled.push(registration);
      continue;
    }
    const key = registration.scope + ":" + registration.name;
    if (!referenced.has(key)) continue;
    assembled.push(await createFromFactory(registration, context, key));
  }
  return [
    ...assembled,
    ...createRecallJudgeCriteria(options),
    ...createRecallCompositionCriteria(options, assembled),
  ];
}
