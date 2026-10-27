/**
 * @module @x-agent-suite/llm-fixture/live-config
 * 私密配置区：live 模式的渠道/模型声明，配置文件为 YAML。
 * 加载顺序（高优先级在前）：
 * 1. env 覆盖：`E2E_LIVE_<CARRIER>_BASE_URL|MODEL|API_KEY|API_KEY_ENV|WIRE`
 *    （carrier 名大写化、非字母数字转下划线；字段级覆盖，叠加在文件声明之上）；
 * 2. `E2E_LIVE_CONFIG_PATH` 指向的显式配置文件；
 * 3. 仓库内 `.env.e2e.yaml`（被 .gitignore 的 `.env*` 规则覆盖）；
 * 4. `~/.env.e2e.yaml`（home 级点文件，跨仓库共享）；
 * 5. `~/.config/x-agent-suite/.env.e2e.yaml`（历史路径名，便于记忆与拷贝）。
 * 不变量：
 * - 凭证两种方式：本区显式配置（apiKey / apiKeyEnv）或通过 borrowCredential 钩子借用宿主 CLI 登录态
 *   （不复制 key 进本仓，借来的 token 兼容性由 sniff 门禁仲裁）；
 * - 缺文件 / 缺 carrier 声明 / 声明缺字段 → 显式「未配置」结果，绝不抛异常，
 *   live 测试据此 skip；
 * - baseUrl 与 apiKey 属私密信息，任何日志/报告输出必须经 redactLiveSecrets 脱敏；
 * - 本模块不发起任何网络请求。
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { expandCarrier, hasExpandedCarrierFormat } from "./live-targets.ts";
import { resolveCarrierChannel, validateChannel } from "./live-channel.ts";
import {
  BORROWED_CREDENTIAL_ENDPOINT_FIELDS,
  resolveLiveApiKey,
} from "./live-credential.ts";
import type {
  LiveChannel,
  LiveChannelResult,
  LiveConfigLoad,
  LiveConfigOptions,
  LiveConfigSource,
} from "./live-types.ts";

export {
  resolveLiveApiKey,
  resolveLiveCredential,
  type LiveCredentialOptions,
} from "./live-credential.ts";
export { resolveLiveTargets } from "./live-targets.ts";
export type {
  BorrowedChannelResult,
  BorrowedCredentialResult,
  LiveChannel,
  LiveChannelPricing,
  LiveChannelResult,
  LiveConfigLoad,
  LiveConfigOptions,
  LiveConfigSource,
  LiveConfigWarning,
  LiveTargetRef,
  LiveTargetSelection,
  LiveTargetsResult,
  ResolvedLiveTarget,
} from "./live-types.ts";

/** 显式配置文件路径的环境变量名。 */
export const LIVE_CONFIG_PATH_ENV = "E2E_LIVE_CONFIG_PATH";

/** 私密配置文件名：repo 根、~/ 与 ~/.config/x-agent-suite/ 下同名（被 .gitignore 的 `.env*` 规则覆盖）。 */
export const LIVE_CONFIG_FILE = ".env.e2e.yaml";

/** carrier 名归一为 env 变量中段：大写、非字母数字转下划线。 */
function envInfix(carrier: string): string {
  return carrier.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/** carrier 的 env 覆盖字段集合（仅列出出现过的字段）。 */
function envOverride(
  carrier: string,
  env: NodeJS.ProcessEnv,
): Partial<LiveChannel> {
  const prefix = `E2E_LIVE_${envInfix(carrier)}_`;
  const out: Record<string, string> = {};
  const map: Record<string, string> = {
    BASE_URL: "baseUrl",
    MODEL: "model",
    API_KEY: "apiKey",
    API_KEY_ENV: "apiKeyEnv",
    WIRE: "wire",
  };
  for (const [suffix, field] of Object.entries(map)) {
    const value = env[`${prefix}${suffix}`];
    if (value !== undefined) {
      out[field] = value;
    }
  }
  return out as Partial<LiveChannel>;
}

/** 读取并解析一份配置文件；不存在返回 null，解析失败返回原因。carriers 保持原始声明（from: harness 在 load 阶段才合并借用）。 */
async function readConfigFile(
  path: string,
): Promise<
  { raw: Record<string, unknown> } | { notFound: true } | { reason: string }
> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { notFound: true };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return {
      reason: `配置文件 YAML 解析失败（${path}）：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const carriers = (parsed as Record<string, unknown>)?.carriers;
  if (typeof carriers !== "object" || carriers === null) {
    return { reason: `配置文件缺少 carriers 对象（${path}）` };
  }
  return { raw: carriers as Record<string, unknown> };
}

/** 继承默认优先复用目录渠道；provider-less 仅在逻辑目标唯一时归一。 */
function matchInheritedChannel(
  available: readonly LiveChannel[],
  inherited: LiveChannel,
): { channel: LiveChannel } | { reason: string } {
  const matches = available.filter(
    (item) =>
      item.model === inherited.model &&
      (inherited.provider === undefined ||
        item.provider === inherited.provider),
  );
  if (matches.length > 1) {
    return {
      reason: `继承默认模型 "${inherited.model}" 对应多个可选 provider，请显式声明 default`,
    };
  }
  return { channel: matches[0] ?? inherited };
}

/** 解析新格式的全部可选目标与默认目标。 */
async function validateExpandedCarrier(
  carrier: string,
  record: Record<string, unknown>,
  options: Required<Pick<LiveConfigOptions, "homeDir" | "borrowChannel">>,
): Promise<
  | { available: LiveChannel[]; defaults: LiveChannel[]; channel?: LiveChannel }
  | { reason: string }
> {
  const expanded = expandCarrier(record);
  if ("reason" in expanded) return expanded;
  const available: LiveChannel[] = [];
  for (const item of expanded.expanded.available) {
    const resolved = await resolveCarrierChannel(
      carrier,
      item.declaration,
      options,
    );
    if ("reason" in resolved) return resolved;
    available.push(resolved.channel);
  }
  if (expanded.expanded.inheritDefault) {
    const inherited = await resolveCarrierChannel(
      carrier,
      expanded.expanded.inheritDeclaration,
      options,
    );
    if ("reason" in inherited) return inherited;
    const matched = matchInheritedChannel(available, inherited.channel);
    if ("reason" in matched) return matched;
    const { channel } = matched;
    if (!available.includes(channel)) available.push(channel);
    return { available, defaults: [channel], channel };
  }
  const defaults = expanded.expanded.defaults.map((target) =>
    available.find(
      (item) =>
        item.provider === target.provider && item.model === target.model,
    ),
  );
  if (defaults.some((channel) => channel === undefined)) {
    return { reason: "default 目标未能归一到可选渠道" };
  }
  const channels = defaults as LiveChannel[];
  return { available, defaults: channels, channel: channels[0] };
}

/** 逐 carrier 校验声明并生成可选目录、默认目标与兼容告警。 */
async function validateCarriers(
  raw: Record<string, unknown>,
  options: Required<Pick<LiveConfigOptions, "homeDir" | "borrowChannel">>,
): Promise<{
  channels: Record<string, LiveChannel>;
  available: Record<string, readonly LiveChannel[]>;
  defaults: Record<string, readonly LiveChannel[]>;
  invalid: Record<string, string>;
  warnings: {
    code: "deprecated-carrier-model";
    carrier: string;
    message: string;
  }[];
}> {
  const channels: Record<string, LiveChannel> = {};
  const available: Record<string, readonly LiveChannel[]> = {};
  const defaults: Record<string, readonly LiveChannel[]> = {};
  const invalid: Record<string, string> = {};
  const warnings: {
    code: "deprecated-carrier-model";
    carrier: string;
    message: string;
  }[] = [];
  for (const [carrier, decl] of Object.entries(raw)) {
    const record =
      typeof decl === "object" && decl !== null
        ? (decl as Record<string, unknown>)
        : undefined;
    if (record && hasExpandedCarrierFormat(record)) {
      const resolved = await validateExpandedCarrier(carrier, record, options);
      if ("reason" in resolved) {
        invalid[carrier] = resolved.reason;
      } else {
        available[carrier] = resolved.available;
        defaults[carrier] = resolved.defaults;
        if (resolved.channel) channels[carrier] = resolved.channel;
      }
      continue;
    }
    const resolved = await resolveCarrierChannel(carrier, decl, options);
    if ("reason" in resolved) {
      invalid[carrier] = resolved.reason;
      continue;
    }
    channels[carrier] = resolved.channel;
    available[carrier] = [resolved.channel];
    defaults[carrier] = [resolved.channel];
    if (
      record &&
      (record.provider !== undefined || record.model !== undefined)
    ) {
      warnings.push({
        code: "deprecated-carrier-model",
        carrier,
        message: `carriers.${carrier}.provider/model 已弃用，请迁移到 providers 与 default；本次仍按旧格式执行`,
      });
    }
  }
  return { channels, available, defaults, invalid, warnings };
}

/**
 * 加载私密配置区文件（不叠加 env 覆盖；env 在 resolveLiveChannel 阶段按字段叠加）。
 * 查找顺序：E2E_LIVE_CONFIG_PATH > repo .env.e2e.yaml > ~/.env.e2e.yaml > ~/.config/x-agent-suite/.env.e2e.yaml。
 */
export async function loadLiveConfig(
  options: LiveConfigOptions = {},
): Promise<LiveConfigLoad> {
  const env = options.env ?? process.env;
  const repoRoot =
    options.repoRoot ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const homeDir = options.homeDir ?? homedir();

  const explicit = env[LIVE_CONFIG_PATH_ENV];
  const candidates: {
    source: Exclude<LiveConfigSource, "env">;
    path: string;
  }[] = explicit
    ? [{ source: "explicit-path", path: explicit }]
    : [
        { source: "repo-local", path: join(repoRoot, LIVE_CONFIG_FILE) },
        { source: "home-dot", path: join(homeDir, LIVE_CONFIG_FILE) },
        {
          source: "user-home",
          path: join(homeDir, ".config", "x-agent-suite", LIVE_CONFIG_FILE),
        },
      ];

  for (const candidate of candidates) {
    const result = await readConfigFile(candidate.path);
    if ("notFound" in result) {
      continue;
    }
    if ("reason" in result) {
      return { kind: "not-configured", reason: result.reason };
    }
    const { channels, available, defaults, invalid, warnings } =
      await validateCarriers(result.raw, {
        homeDir,
        borrowChannel:
          options.borrowChannel ??
          (() =>
            Promise.resolve({
              kind: "missing",
              reason: "未注入 borrowChannel 钩子",
            })),
      });
    return {
      kind: "loaded",
      source: candidate.source,
      path: candidate.path,
      channels,
      available,
      defaults,
      warnings,
      invalid,
    };
  }
  return {
    kind: "not-configured",
    reason: explicit
      ? `${LIVE_CONFIG_PATH_ENV} 指向的文件不存在（${explicit}）`
      : `未找到 ${LIVE_CONFIG_FILE}（repo 根、~/ 或 ~/.config/x-agent-suite/）`,
  };
}

/**
 * 解析单 carrier 的生效渠道：env 字段级覆盖叠加在文件声明之上。
 * 任何缺失/非法均返回「未配置」结果（不抛异常），live 测试据此 skip。
 */
export function resolveLiveChannel(
  load: LiveConfigLoad,
  carrier: string,
  env: NodeJS.ProcessEnv = process.env,
): LiveChannelResult {
  const override = envOverride(carrier, env);
  const fromEnv = Object.keys(override).length > 0;
  const base: Partial<LiveChannel> =
    load.kind === "loaded" ? { ...load.channels[carrier] } : {};
  const hasCredentialOverride =
    override.apiKey !== undefined || override.apiKeyEnv !== undefined;
  const usesBorrowedCredential =
    base.credential === "harness" && !hasCredentialOverride;
  const endpointOverrides = usesBorrowedCredential
    ? BORROWED_CREDENTIAL_ENDPOINT_FIELDS.filter(
        (field) =>
          override[field] !== undefined && override[field] !== base[field],
      )
    : [];
  if (endpointOverrides.length > 0) {
    return {
      kind: "not-configured",
      carrier,
      reason: `借用凭据时不能由环境变量覆盖端点字段：${endpointOverrides.join(", ")}`,
    };
  }
  const overridden = { ...base, ...override };
  if (
    base.credential === "harness" &&
    hasCredentialOverride &&
    !resolveLiveApiKey(overridden as LiveChannel, env)
  ) {
    return {
      kind: "not-configured",
      carrier,
      reason: "覆盖借用渠道的显式凭据不可用，拒绝回退到借用凭据",
    };
  }
  if (hasCredentialOverride) {
    delete overridden.auth;
    delete overridden.credential;
    if (override.apiKey !== undefined) delete overridden.apiKeyEnv;
    if (override.apiKeyEnv !== undefined) delete overridden.apiKey;
  }
  const merged = overridden;
  const validated = validateChannel(merged);
  if ("reason" in validated) {
    let reason: string;
    if (
      fromEnv ||
      (load.kind === "loaded" && load.channels[carrier] !== undefined)
    ) {
      // env 覆盖后仍缺字段，或文件声明部分合法但合并不全。
      reason = validated.reason;
    } else if (load.kind === "loaded" && load.invalid[carrier] !== undefined) {
      reason = load.invalid[carrier];
    } else if (load.kind === "loaded") {
      reason = `配置文件未声明 carrier "${carrier}"，且 env 未覆盖`;
    } else {
      reason = `${load.reason}；且 env 未声明 E2E_LIVE_${envInfix(carrier)}_*`;
    }
    return { kind: "not-configured", carrier, reason };
  }
  return {
    kind: "configured",
    carrier,
    channel: hasCredentialOverride
      ? { ...validated.channel, credentialSource: "runtime" as const }
      : validated.channel,
    source: fromEnv ? "env" : load.kind === "loaded" ? load.source : "env",
  };
}
