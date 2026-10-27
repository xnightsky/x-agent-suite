/**
 * @module @x-agent-suite/llm-fixture/live-auth-config
 * 可选 live 认证文件：严格 YAML 校验与显式/repo/home 发现。
 * 不变量：模型配置加载不调用本模块；诊断不回显 secret 或 YAML 原始行。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/** 认证文件显式路径的环境变量名。 */
export const LIVE_AUTH_CONFIG_PATH_ENV = "E2E_AUTH_CONFIG_PATH";

/** 可选认证文件名。 */
export const LIVE_AUTH_CONFIG_FILE = ".env.auth.yaml";

/** 认证文件读取、YAML 或 schema 错误。 */
export class LiveAuthConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LiveAuthConfigError";
  }
}

/** 单个 provider 的 API-key 凭据声明。 */
export interface LiveAuthEntry {
  readonly type: "api_key";
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
}

/** 认证文件的逻辑结构。 */
export interface LiveAuthConfig {
  readonly version: 1;
  readonly providers: Readonly<Record<string, LiveAuthEntry>>;
}

/** 认证文件来源。 */
export type LiveAuthConfigSource = "explicit-path" | "repo-local" | "home-dot";

/** 认证文件加载结果。 */
export type LiveAuthConfigLoad =
  | {
      readonly kind: "loaded";
      readonly source: LiveAuthConfigSource;
      readonly path: string;
      readonly config: LiveAuthConfig;
    }
  | { readonly kind: "not-configured" };

/** 认证文件发现选项。 */
export interface LiveAuthConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly repoRoot?: string;
  readonly homeDir?: string;
}

function fail(message: string): never {
  throw new LiveAuthConfigError(message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path + " 必须是对象");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path + " 必须是非空字符串");
  }
  return value;
}

function parseEntry(value: unknown, provider: string): LiveAuthEntry {
  const path = "providers." + provider;
  const record = asRecord(value, path);
  const unknown = Object.keys(record).filter(
    (key) => !["type", "apiKey", "apiKeyEnv"].includes(key),
  );
  if (unknown.length > 0) fail(path + " 含未知字段：" + unknown.join(", "));
  if (record.type !== "api_key") fail(path + ".type 必须为 api_key");
  const hasKey = record.apiKey !== undefined;
  const hasKeyEnv = record.apiKeyEnv !== undefined;
  if (hasKey === hasKeyEnv) fail(path + " 的 apiKey 与 apiKeyEnv 必须恰好声明一个");
  return {
    type: "api_key",
    ...(hasKey ? { apiKey: requiredString(record.apiKey, path + ".apiKey") } : {}),
    ...(hasKeyEnv
      ? { apiKeyEnv: requiredString(record.apiKeyEnv, path + ".apiKeyEnv") }
      : {}),
  };
}

/** 解析并严格校验一份认证 YAML；错误不包含配置值。 */
export function parseLiveAuthConfig(text: string): LiveAuthConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    throw new LiveAuthConfigError("Live 认证 YAML 解析失败");
  }
  const root = asRecord(parsed, "Live 认证配置");
  const unknown = Object.keys(root).filter(
    (key) => !["version", "providers"].includes(key),
  );
  if (unknown.length > 0) fail("Live 认证配置含未知字段：" + unknown.join(", "));
  if (root.version !== 1) fail("Live 认证配置 version 必须为 1");
  const providers = asRecord(root.providers, "providers");
  return {
    version: 1,
    providers: Object.fromEntries(
      Object.entries(providers).map(([provider, value]) => {
        if (provider.trim() === "") fail("providers 的 provider ID 不得为空");
        return [provider, parseEntry(value, provider)];
      }),
    ),
  };
}

/** 按 explicit > repo > home 发现认证文件；默认文件均缺失时返回未配置。 */
export async function loadLiveAuthConfig(
  options: LiveAuthConfigOptions = {},
): Promise<LiveAuthConfigLoad> {
  const env = options.env ?? process.env;
  const repoRoot =
    options.repoRoot ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const homeDir = options.homeDir ?? homedir();
  const explicit = env[LIVE_AUTH_CONFIG_PATH_ENV];
  const candidates: readonly {
    readonly source: LiveAuthConfigSource;
    readonly path: string;
  }[] = explicit
    ? [{ source: "explicit-path", path: explicit }]
    : [
        { source: "repo-local", path: join(repoRoot, LIVE_AUTH_CONFIG_FILE) },
        { source: "home-dot", path: join(homeDir, LIVE_AUTH_CONFIG_FILE) },
      ];

  for (const candidate of candidates) {
    let text: string;
    try {
      text = await readFile(candidate.path, "utf8");
    } catch (error) {
      if (
        !explicit &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw new LiveAuthConfigError(
        "无法读取 Live 认证文件：" + candidate.path,
        { cause: error },
      );
    }
    let config: LiveAuthConfig;
    try {
      config = parseLiveAuthConfig(text);
    } catch (error) {
      throw new LiveAuthConfigError(
        "Live 认证文件无效：" + candidate.path,
        { cause: error },
      );
    }
    return { kind: "loaded", source: candidate.source, path: candidate.path, config };
  }
  return { kind: "not-configured" };
}
