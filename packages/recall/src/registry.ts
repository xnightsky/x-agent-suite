/**
 * @module @x-agent-suite/recall/registry
 * 独立消费者注册表：Criterion/通用判据工厂、borrowed execution profile、EffectsProfile 与 transport。
 * 不变量：registry 只注册实现；target/mode/cliRef 由 live 配置与 TargetTags 决策；
 * 工厂只在装配期被调用，registry 本身不创建 Driver、不联网。
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AgentDriver,
  Criterion,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import type {
  LiveBackend,
  LiveConfigOptions,
  LiveTransport,
  ResolvedLiveTarget,
  TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";
import type { RecallEffects, RecallEffectsProfile } from "./effects.ts";
import { assertKnownFields, isNonEmptyString, isRecord } from "./validation.ts";

/** 判据描述：编译期只需 name/scope 验证考卷引用。 */
export interface RecallCriterionDescriptor {
  /** 判据名；考卷 expect 按名引用。 */
  readonly name: Criterion["name"];
  /** 判据作用域；当前考卷只引用 turn 级。 */
  readonly scope: Criterion["scope"];
}

/**
 * 通用判据装配上下文：同一来源的 target/config/tags/批准。
 * 不变量：全部取自同一次官方加载，工厂不得重读环境或再次选择模型。
 */
export interface RecallCriterionFactoryContext {
  /** 当前已选完整 target。 */
  readonly target: ResolvedLiveTarget;
  /** 现有 live 配置与借用 hooks。 */
  readonly config: LiveConfigOptions;
  /** 通用四层能力目录。 */
  readonly tags: TargetTagCatalog;
  /** 本次命令归一化后的 live 批准；不代表永久授权。 */
  readonly liveReviewApproved: boolean;
  /** borrowed 的唯一 CLI 能力目录/profile。 */
  readonly cliRef?: string;
  /** ephemeral-client 的注册实现引用。 */
  readonly clientRef?: string;
  /** 已归一化的执行副作用策略；不推导额外权限。 */
  readonly effects: RecallEffects;
}

/**
 * 通用判据工厂：按 target 装配一次并复用。
 * 不变量：返回 Criterion 的 name/scope 必须与声明严格一致；装配期不启动 Driver、不联网、不调用模型。
 */
export interface RecallCriterionFactory extends RecallCriterionDescriptor {
  /** 按已选 target 装配判据；每 target 每工厂恰好调用一次。 */
  readonly create: (
    context: RecallCriterionFactoryContext,
  ) => Criterion | Promise<Criterion>;
}

/** 判据注册项：静态 Criterion（有 evaluate）或通用工厂（有 create），恰居其一。 */
export type RecallCriterionRegistration = Criterion | RecallCriterionFactory;

/** borrowed Driver 创建上下文；由每次 case/repeat 独立传入。 */
export interface RecallProfileDriverContext {
  /** 当前场景及其 Recall DSL 编译出的 provision。 */
  readonly spec: ScenarioSpec;
  /** 当前 target 的独立 LiveBackend。 */
  readonly backend: LiveBackend;
  /** 当前完整 target。 */
  readonly target: ResolvedLiveTarget;
  /** CLI 执行引用；与 clientRef 恰居其一。 */
  readonly cliRef?: string;
  /** 临时 Client 执行引用；与 cliRef 恰居其一。 */
  readonly clientRef?: string;
  /** 当前显式 effects；场景 provision 仍在 spec 内，不做执行级合并。 */
  readonly effects: RecallEffects;
  /** 本次命令的运行参数；消费者必须校验支持的字段，不得改变 target 或安全策略。 */
  readonly executionParams: Readonly<Record<string, unknown>>;
}

/** 消费者 CLI 或临时 Client 执行实现。 */
export interface RecallExecutionProfile {
  /** 该实现服务的 carrier。 */
  readonly carrier: string;
  /** 创建符合当前 effects 与场景 provision 的 Driver。 */
  readonly createDriver: (
    context: RecallProfileDriverContext,
  ) => AgentDriver | Promise<AgentDriver>;
}

/** 独立注册表模块 default 导出形状。 */
export interface RecallRegistry {
  /** 考卷 expect 可用判据：静态 Criterion 与通用工厂可混合注册。 */
  readonly criteria: readonly RecallCriterionRegistration[];
  /** 按 cliRef/clientRef 注册的执行实现。 */
  readonly profiles: Readonly<Record<string, RecallExecutionProfile>>;
  /** 按名称注册的可序列化 EffectsProfile。 */
  readonly effectsProfiles: Readonly<Record<string, RecallEffectsProfile>>;
  /** 可选 transport；生产缺省 fetch，测试可注入 fake。 */
  readonly transport?: LiveTransport;
}

/** 返回不注册任何实现的安全空表。 */
export function emptyRecallRegistry(): RecallRegistry {
  return { criteria: [], profiles: {}, effectsProfiles: {} };
}

function validateCriteria(
  value: unknown,
): readonly RecallCriterionRegistration[] {
  if (!Array.isArray(value))
    throw new Error("Recall registry.criteria 必须是数组");
  const seen = new Set<string>();
  for (const criterion of value) {
    if (!isRecord(criterion))
      throw new Error("Recall registry.criteria 含非法项");
    if (!isNonEmptyString(criterion.name))
      throw new Error("Recall 判据 name 必须是非空字符串");
    if (criterion.scope !== "turn" && criterion.scope !== "session")
      throw new Error("Recall 判据 scope 必须是 turn 或 session");
    const hasEvaluate = typeof criterion.evaluate === "function";
    const hasCreate = typeof criterion.create === "function";
    if (hasEvaluate === hasCreate) {
      throw new Error("Recall 判据 evaluate 与 create 必须恰有一个是函数");
    }
    const key = String(criterion.scope) + ":" + String(criterion.name);
    if (seen.has(key)) throw new Error("Recall 判据重复注册：" + key);
    seen.add(key);
  }
  return value as readonly RecallCriterionRegistration[];
}

function validateProfiles(
  value: unknown,
): Readonly<Record<string, RecallExecutionProfile>> {
  if (!isRecord(value)) throw new Error("Recall registry.profiles 必须是对象");
  for (const [cliRef, profile] of Object.entries(value)) {
    if (!isNonEmptyString(cliRef) || !isRecord(profile)) {
      throw new Error("Recall registry.profiles 含非法 profile：" + cliRef);
    }
    assertKnownFields(
      profile,
      ["carrier", "createDriver"],
      "Recall profile " + cliRef,
    );
    if (!isNonEmptyString(profile.carrier)) {
      throw new Error("Recall profile.carrier 必须是非空字符串：" + cliRef);
    }
    if (typeof profile.createDriver !== "function") {
      throw new Error("Recall profile.createDriver 必须是函数：" + cliRef);
    }
  }
  return value as Readonly<Record<string, RecallExecutionProfile>>;
}

function validateEffectsProfiles(
  value: unknown,
): Readonly<Record<string, RecallEffectsProfile>> {
  if (!isRecord(value))
    throw new Error("Recall registry.effectsProfiles 必须是对象");
  for (const [name, profile] of Object.entries(value)) {
    if (!isNonEmptyString(name) || !isRecord(profile)) {
      throw new Error("Recall registry.effectsProfiles 含非法项：" + name);
    }
  }
  return value as Readonly<Record<string, RecallEffectsProfile>>;
}

function validateRegistry(value: unknown, path: string): RecallRegistry {
  if (!isRecord(value))
    throw new Error("Recall registry 必须 default 导出对象：" + path);
  assertKnownFields(
    value,
    ["criteria", "profiles", "effectsProfiles", "transport"],
    "Recall registry",
  );
  const transport = value.transport;
  if (transport !== undefined && typeof transport !== "function") {
    throw new Error("Recall registry.transport 必须是函数");
  }
  return {
    criteria: validateCriteria(value.criteria ?? []),
    profiles: validateProfiles(value.profiles ?? {}),
    effectsProfiles: validateEffectsProfiles(value.effectsProfiles ?? {}),
    ...(transport ? { transport: transport as LiveTransport } : {}),
  };
}

/** 加载显式 registry 模块；无路径时返回空表，不读取任何默认 TS 配置。 */
export async function loadRecallRegistry(
  path?: string,
): Promise<RecallRegistry> {
  if (path === undefined) return emptyRecallRegistry();
  const filePath = resolve(path);
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(filePath).href)) as {
      default?: unknown;
    };
  } catch (cause) {
    throw new Error("Recall registry 导入失败：" + filePath, { cause });
  }
  return validateRegistry(module.default, filePath);
}
