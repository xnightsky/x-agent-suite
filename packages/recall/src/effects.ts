/**
 * @module @x-agent-suite/recall/effects
 * 执行 Plan effects DSL：none/use/inline、严格缺省与精确命令门禁。
 * 不变量：Plan 不含 provision/driver/mode/cliRef/criteria；use 与 inline 互斥。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { RecallRegistry } from "./registry.ts";
import {
  assertKnownFields,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  requiredString,
} from "./validation.ts";

/** 模型工具策略。 */
export type RecallToolsPolicy = "none" | "read-only" | "allowlist";

/** 命令权限；仅支持完整命令字符串精确匹配，deny 优先。 */
export interface RecallCommandsPolicy {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

/** 消费者 EffectsProfile 的可序列化字段。 */
export interface RecallEffectsProfile {
  readonly tools?: RecallToolsPolicy;
  readonly commands?: {
    readonly allow?: readonly string[];
    readonly deny?: readonly string[];
  };
  readonly maxSteps?: number;
  readonly timeoutMs?: number;
  readonly workspace?: "isolated";
  readonly cleanup?: "required";
}

/** 已归一化的执行副作用策略。 */
export interface RecallEffects {
  readonly kind: "none" | "inline" | "use";
  readonly attribution: string;
  readonly tools: RecallToolsPolicy;
  readonly commands: RecallCommandsPolicy;
  readonly maxSteps: number;
  readonly timeoutMs: number;
  readonly workspace: "isolated";
  readonly cleanup: "required";
}

const EMPTY_REGISTRY: Pick<RecallRegistry, "effectsProfiles"> = {
  effectsProfiles: {},
};

function normalizeCommands(value: unknown): RecallCommandsPolicy {
  if (value === undefined) return { allow: [], deny: [] };
  if (!isRecord(value)) throw new Error("Recall effects.commands 必须是对象");
  assertKnownFields(value, ["allow", "deny"], "Recall effects.commands");
  const read = (key: "allow" | "deny"): readonly string[] => {
    const entries = value[key];
    if (entries === undefined) return [];
    if (!Array.isArray(entries) || !entries.every(isNonEmptyString)) {
      throw new Error(
        "Recall effects.commands." + key + " 必须是非空字符串数组",
      );
    }
    return entries;
  };
  return { allow: read("allow"), deny: read("deny") };
}

function normalizeEffects(
  value: unknown,
  kind: RecallEffects["kind"],
  attribution: string,
): RecallEffects {
  if (!isRecord(value)) throw new Error("Recall effects 必须是对象或 none");
  assertKnownFields(
    value,
    ["tools", "commands", "maxSteps", "timeoutMs", "workspace", "cleanup"],
    "Recall effects",
  );
  const tools = value.tools ?? "none";
  if (tools !== "none" && tools !== "read-only" && tools !== "allowlist") {
    throw new Error("Recall effects.tools 必须是 none/read-only/allowlist");
  }
  const maxSteps = value.maxSteps ?? 1;
  const timeoutMs = value.timeoutMs ?? 30_000;
  if (!isPositiveInteger(maxSteps))
    throw new Error("Recall effects.maxSteps 必须是正整数");
  if (!isPositiveInteger(timeoutMs)) {
    throw new Error("Recall effects.timeoutMs 必须是正整数");
  }
  if ((value.workspace ?? "isolated") !== "isolated") {
    throw new Error("Recall effects.workspace 当前仅支持 isolated");
  }
  if ((value.cleanup ?? "required") !== "required") {
    throw new Error("Recall effects.cleanup 当前仅支持 required");
  }
  return {
    kind,
    attribution,
    tools,
    commands: normalizeCommands(value.commands),
    maxSteps,
    timeoutMs,
    workspace: "isolated",
    cleanup: "required",
  };
}

function parseEffects(
  value: unknown,
  registry: Pick<RecallRegistry, "effectsProfiles">,
): RecallEffects {
  if (value === "none") return normalizeEffects({}, "none", "none");
  if (!isRecord(value))
    throw new Error("Recall effects 必须是 none/use/inline");
  if (value.use !== undefined) {
    if (Object.keys(value).length !== 1) {
      throw new Error("Recall effects.use 与 inline 字段互斥");
    }
    const name = requiredString(value.use, "Recall effects.use");
    const profile = registry.effectsProfiles[name];
    if (!profile) throw new Error("Recall EffectsProfile 未注册：" + name);
    return normalizeEffects(profile, "use", "use:" + name);
  }
  return normalizeEffects(value, "inline", "inline");
}

function parsePlan(source: string, path: string): unknown {
  let document: unknown;
  try {
    document = parse(source, { strict: true, uniqueKeys: true });
  } catch (cause) {
    throw new Error("Recall 执行 Plan YAML 解析失败：" + path, { cause });
  }
  if (!isRecord(document)) throw new Error("Recall 执行 Plan 顶层必须是对象");
  assertKnownFields(document, ["version", "effects"], "Recall 执行 Plan");
  if (document.version !== 1)
    throw new Error("Recall 执行 Plan version 必须为 1");
  if (document.effects === undefined)
    throw new Error("Recall 执行 Plan effects 必填");
  return document.effects;
}

/** 加载执行 Plan 或显式 use:权限引用；无输入时返回 effects:none。 */
export async function loadRecallEffectsPlan(
  path?: string,
  registry: Pick<RecallRegistry, "effectsProfiles"> = EMPTY_REGISTRY,
): Promise<RecallEffects> {
  if (path === undefined) return normalizeEffects({}, "none", "none");
  if (path.startsWith("use:")) {
    return parseEffects(
      { use: requiredString(path.slice(4), "Recall Plan use") },
      registry,
    );
  }
  const filePath = resolve(path);
  const source = await readFile(filePath, "utf8").catch((cause: unknown) => {
    throw new Error("无法读取 Recall 执行 Plan：" + filePath, { cause });
  });
  return parseEffects(parsePlan(source, filePath), registry);
}

/** 精确命令门禁：deny 优先，随后必须命中 allow；默认全拒绝。 */
export function isRecallCommandAllowed(
  effects: Pick<RecallEffects, "commands">,
  command: string,
): boolean {
  if (effects.commands.deny.includes(command)) return false;
  return effects.commands.allow.includes(command);
}
