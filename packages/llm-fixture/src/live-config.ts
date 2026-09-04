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
import type { WireProtocol } from "@x-agent-suite/contracts";
import {
  BORROWED_CREDENTIAL_ENDPOINT_FIELDS,
  resolveLiveApiKey,
} from "./live-credential.ts";
import type {
  BorrowedChannelResult,
  LiveChannel,
  LiveChannelPricing,
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
export type {
  BorrowedChannelResult,
  BorrowedCredentialResult,
  LiveChannel,
  LiveChannelPricing,
  LiveChannelResult,
  LiveConfigLoad,
  LiveConfigOptions,
  LiveConfigSource,
} from "./live-types.ts";

/** 显式配置文件路径的环境变量名。 */
export const LIVE_CONFIG_PATH_ENV = "E2E_LIVE_CONFIG_PATH";

/** 私密配置文件名：repo 根、~/ 与 ~/.config/x-agent-suite/ 下同名（被 .gitignore 的 `.env*` 规则覆盖）。 */
export const LIVE_CONFIG_FILE = ".env.e2e.yaml";

/** 合法 wire 取值（历史名称；消费者可扩展，框架只负责校验已知值）。 */
const VALID_WIRES: readonly string[] = [
  "openai-responses",
  "openai-chat",
  "anthropic-messages",
  // BOUNDARY-DEBT(harness): gemini-generate 为历史协议标识
  "gemini-generate",
];

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
    if (value !== undefined && value !== "") {
      out[field] = value;
    }
  }
  return out as Partial<LiveChannel>;
}

/** 校验并归一一份原始配置对象为 LiveChannel；不合法返回原因字符串。 */
function validateChannel(
  raw: unknown,
): { channel: LiveChannel } | { reason: string } {
  if (typeof raw !== "object" || raw === null) {
    return { reason: "渠道声明必须是对象" };
  }
  const record = raw as Record<string, unknown>;
  const missing = (["wire", "baseUrl", "model"] as const).filter(
    (k) => typeof record[k] !== "string" || record[k] === "",
  );
  if (missing.length > 0) {
    return { reason: `渠道声明缺字段: ${missing.join(", ")}` };
  }
  if (!VALID_WIRES.includes(record.wire as string)) {
    return {
      reason: `wire "${String(record.wire)}" 非法（可用: ${VALID_WIRES.join(", ")}）`,
    };
  }
  const channel: LiveChannel = {
    wire: record.wire as WireProtocol,
    baseUrl: record.baseUrl as string,
    model: record.model as string,
    ...(typeof record.apiKey === "string" ? { apiKey: record.apiKey } : {}),
    ...(typeof record.apiKeyEnv === "string"
      ? { apiKeyEnv: record.apiKeyEnv }
      : {}),
    ...(record.credential !== undefined
      ? record.credential === "harness"
        ? { credential: "harness" as const }
        : undefined
      : {}),
    ...(record.from !== undefined
      ? record.from === "harness"
        ? { from: "harness" as const }
        : undefined
      : {}),
    ...(typeof record.provider === "string"
      ? { provider: record.provider }
      : {}),
    ...(typeof record.harness === "string" && record.harness !== ""
      ? { harness: record.harness }
      : {}),
    ...(typeof record.harnessBaseUrl === "string" &&
    record.harnessBaseUrl !== ""
      ? { harnessBaseUrl: record.harnessBaseUrl }
      : {}),
    ...(typeof record.pricing === "object" && record.pricing !== null
      ? { pricing: record.pricing as LiveChannelPricing }
      : {}),
  };
  if (record.credential !== undefined && channel.credential === undefined) {
    return {
      reason: `credential 只支持 "harness"（借用宿主登录态），实际: ${String(record.credential)}`,
    };
  }
  if (record.from !== undefined && channel.from === undefined) {
    return {
      reason: `from 只支持 "harness"（借用宿主渠道配置），实际: ${String(record.from)}`,
    };
  }
  if (channel.apiKey !== undefined && channel.apiKeyEnv !== undefined) {
    return { reason: "apiKey 与 apiKeyEnv 不能同时声明" };
  }
  if (
    channel.credential === "harness" &&
    (channel.apiKey !== undefined || channel.apiKeyEnv !== undefined)
  ) {
    return { reason: "显式凭据与 credential: harness 不能同时声明" };
  }
  if (channel.credential === "harness" && channel.from !== "harness") {
    return {
      reason: '借用凭据 credential: "harness" 必须同时声明 from: "harness"',
    };
  }
  return { channel };
}

/** 返回实际借用凭据时被声明覆盖的端点字段。 */
function borrowedEndpointOverrides(
  record: Record<string, unknown>,
  borrowed: Extract<BorrowedChannelResult, { kind: "resolved" }>,
): string[] {
  if (record.apiKey !== undefined || record.apiKeyEnv !== undefined) return [];
  return BORROWED_CREDENTIAL_ENDPOINT_FIELDS.filter(
    (field) => record[field] !== undefined && record[field] !== borrowed[field],
  );
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

/**
 * 逐 carrier 校验原始声明；`from: harness` 的先调用 borrowChannel 钩子合并借用配置
 * （yaml 显式字段覆盖借用值，未给显式凭证时隐含 credential: "harness"），
 * 钩子未提供或借用失败进 invalid 并记原因。
 */
async function validateCarriers(
  raw: Record<string, unknown>,
  options: Required<Pick<LiveConfigOptions, "homeDir" | "borrowChannel">>,
): Promise<{
  channels: Record<string, LiveChannel>;
  invalid: Record<string, string>;
}> {
  const channels: Record<string, LiveChannel> = {};
  const invalid: Record<string, string> = {};
  for (const [carrier, decl] of Object.entries(raw)) {
    let merged = decl;
    if (
      typeof decl === "object" &&
      decl !== null &&
      (decl as Record<string, unknown>).from === "harness"
    ) {
      const record = decl as Record<string, unknown>;
      const borrowFrom =
        typeof record.harness === "string" && record.harness !== ""
          ? record.harness
          : carrier;
      const providerHint =
        typeof record.provider === "string" && record.provider !== ""
          ? record.provider
          : undefined;
      if (!options.borrowChannel) {
        invalid[carrier] =
          "from: harness 需要 borrowChannel 钩子；当前未注入借用能力";
        continue;
      }
      const borrowed = await options.borrowChannel(
        borrowFrom,
        options.homeDir,
        providerHint !== undefined ? { provider: providerHint } : undefined,
      );
      if (borrowed.kind !== "resolved") {
        invalid[carrier] = `from: harness 借用失败：${borrowed.reason}`;
        continue;
      }
      const endpointOverrides = borrowedEndpointOverrides(record, borrowed);
      if (endpointOverrides.length > 0) {
        invalid[carrier] =
          `借用凭据时不能覆盖借用端点字段：${endpointOverrides.join(", ")}`;
        continue;
      }
      if (
        providerHint !== undefined &&
        record.model === undefined &&
        borrowed.model === undefined
      ) {
        invalid[carrier] =
          `provider 借用目标 "${providerHint}" 无宿主默认 model 可借（默认 model 属于默认 provider），须显式声明 model`;
        continue;
      }
      merged = {
        // yaml 显式字段覆盖借用值
        wire: record.wire ?? borrowed.wire,
        baseUrl: record.baseUrl ?? borrowed.baseUrl,
        model: record.model ?? borrowed.model,
        provider: record.provider ?? borrowed.provider,
        harnessBaseUrl: record.harnessBaseUrl ?? borrowed.harnessBaseUrl,
        ...record,
        // 未给显式凭证时隐含借用宿主登录态
        ...(record.credential === undefined &&
        record.apiKey === undefined &&
        record.apiKeyEnv === undefined
          ? { credential: "harness" }
          : {}),
      };
    }
    const validated = validateChannel(merged);
    if ("channel" in validated) {
      channels[carrier] = validated.channel;
    } else {
      invalid[carrier] = validated.reason;
    }
  }
  return { channels, invalid };
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
    const { channels, invalid } = await validateCarriers(result.raw, {
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
  if (hasCredentialOverride) delete overridden.credential;
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
    channel: validated.channel,
    source: fromEnv ? "env" : load.kind === "loaded" ? load.source : "env",
  };
}
