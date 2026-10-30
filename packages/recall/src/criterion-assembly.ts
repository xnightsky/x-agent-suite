/**
 * @module @x-agent-suite/recall/criterion-assembly
 * 按已选 target 装配实际引用的动态判据；每 target 每工厂恰好调用一次。
 * 不变量：
 * - 引用收集只看 expect 键存在性（Object.keys 语义），false/0/null/空串均算引用；
 * - 装配只准备闭包与无资源 client，不启动 Driver、不联网、不调用模型；
 * - 工厂返回的 name/scope 必须与声明严格一致，装配不得增减判据或改变考卷选择；
 * - 装配错误只含 scope:name 与阶段（create / 形状校验），不回显 context/config 或插件异常内容。
 */
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

/** assembleRecallCriteria 入参。 */
export interface AssembleRecallCriteriaOptions {
  /** 独立 registry 声明（静态判据 + 通用工厂）。 */
  readonly registry: RecallRegistry;
  /** 已编译场景；引用收集只扫 turns[].expect。 */
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

/** 收集全部场景 turn.expect 的引用键（字段存在即算引用）。 */
function collectTurnReferences(
  scenarios: readonly ScenarioSpec[],
): ReadonlySet<string> {
  const referenced = new Set<string>();
  for (const scenario of scenarios) {
    for (const turn of scenario.turns) {
      if (!turn.expect) continue;
      for (const name of Object.keys(turn.expect)) {
        referenced.add("turn:" + name);
      }
    }
  }
  return referenced;
}

/** 判别注册项是通用工厂（加载期已保证 evaluate/create 恰居其一）。 */
function isCriterionFactory(
  registration: RecallCriterionRegistration,
): registration is RecallCriterionFactory {
  return "create" in registration && typeof registration.create === "function";
}

/** 调用工厂并包装错误：message 只含 scope:name 与阶段，cause 链保留。 */
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
 * 未引用工厂不调用；session scope 工厂声明合法，但当前 DSL 无 session 引用入口。
 */
export async function assembleRecallCriteria(
  options: AssembleRecallCriteriaOptions,
): Promise<readonly Criterion[]> {
  const referenced = collectTurnReferences(options.scenarios);
  const { execution } = options;
  const context: RecallCriterionFactoryContext = {
    target: execution.target,
    config: options.config,
    tags: options.catalog,
    liveReviewApproved: options.liveReviewApproved,
    ...(execution.cliRef ? { cliRef: execution.cliRef } : {}),
    ...(execution.clientRef ? { clientRef: execution.clientRef } : {}),
    effects: options.effects,
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
  return assembled;
}
