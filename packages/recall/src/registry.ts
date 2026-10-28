/**
 * @module @x-agent-suite/recall/registry
 * 独立消费者注册表：Criterion、borrowed execution profile、EffectsProfile 与 transport。
 * 不变量：registry 只注册实现；target/mode/cliRef 由 live 配置与 TargetTags 决策。
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
  LiveTransport,
  ResolvedLiveTarget,
} from "@x-agent-suite/llm-fixture";
import type { RecallEffects, RecallEffectsProfile } from "./effects.ts";
import { assertKnownFields, isNonEmptyString, isRecord } from "./validation.ts";

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
  /** 考卷 expect 可用判据。 */
  readonly criteria: readonly Criterion[];
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

function validateCriteria(value: unknown): readonly Criterion[] {
  if (!Array.isArray(value))
    throw new Error("Recall registry.criteria 必须是数组");
  const seen = new Set<string>();
  for (const criterion of value) {
    if (!isRecord(criterion))
      throw new Error("Recall registry.criteria 含非法项");
    const key = String(criterion.scope) + ":" + String(criterion.name);
    if (seen.has(key)) throw new Error("Recall 判据重复注册：" + key);
    seen.add(key);
  }
  return value as readonly Criterion[];
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
