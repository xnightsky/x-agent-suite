/**
 * @module @x-agent-suite/llm-fixture/live-credential
 * 解析显式或借用凭据，并在借用前验证渠道端点归属。
 */
import { homedir } from "node:os";
import {
  LiveAuthConfigError,
  loadLiveAuthConfig,
  type LiveAuthEntry,
} from "./live-auth-config.ts";
import type {
  BorrowedCredentialResult,
  LiveChannel,
  LiveConfigOptions,
} from "./live-types.ts";

/** 借用凭据时必须与借用渠道一致的端点字段。 */
export const BORROWED_CREDENTIAL_ENDPOINT_FIELDS = [
  "wire",
  "baseUrl",
  "provider",
] as const;

/** 解析渠道的 API key：字面量优先，其次 apiKeyEnv 指向的环境变量；均无则 undefined。 */
export function resolveLiveApiKey(
  channel: LiveChannel,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (channel.apiKey) return channel.apiKey;
  if (channel.apiKeyEnv) return env[channel.apiKeyEnv] || undefined;
  return undefined;
}

/** resolveLiveCredential 的可选项（测试注入用；缺省取真实环境）。 */
export interface LiveCredentialOptions {
  /** carrier 名（harness 借用路径按它选 extractor）。 */
  readonly carrier: string;
  /** 环境变量表；缺省 process.env。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 用户 home 目录；缺省 os.homedir()。 */
  readonly homeDir?: string;
  /** 仓库根目录（repo-local 认证文件查找基点）。 */
  readonly repoRoot?: string;
  /** 当前时刻（epoch ms）；缺省 Date.now()。 */
  readonly now?: number;
  /** 渠道借用钩子；借用凭据前用于验证端点归属。 */
  readonly borrowChannel?: LiveConfigOptions["borrowChannel"];
  /** 凭证借用钩子；未提供时 credential: harness 直接返回 missing。 */
  readonly borrowCredential?: LiveConfigOptions["borrowCredential"];
}

/** 验证借用凭据将发送到借用渠道自己的端点。 */
async function verifyBorrowedChannel(
  channel: LiveChannel,
  options: LiveCredentialOptions,
): Promise<{ readonly reason: string } | null> {
  const borrow = options.borrowChannel;
  if (!borrow)
    return { reason: "未注入 borrowChannel 钩子，无法验证借用凭据端点" };
  const source = channel.harness ?? options.carrier;
  const borrowed = await borrow(
    source,
    options.homeDir ?? homedir(),
    channel.provider !== undefined ? { provider: channel.provider } : undefined,
  );
  if (borrowed.kind === "missing") return { reason: borrowed.reason };
  const mismatches = BORROWED_CREDENTIAL_ENDPOINT_FIELDS.filter(
    (field) =>
      !(field === "provider" && borrowed.provider === undefined) &&
      channel[field] !== borrowed[field],
  );
  return mismatches.length > 0
    ? { reason: `借用凭据渠道与当前端点不一致：${mismatches.join(", ")}` }
    : null;
}

/**
 * 按 runtime > auth-file > model-config 选择来源；来源存在但失败时不切换身份。
 * 代码显式/legacy channel 没有 credentialSource，继续旁路认证文件发现。
 */
export async function resolveLiveCredential(
  channel: LiveChannel,
  options: LiveCredentialOptions,
): Promise<BorrowedCredentialResult> {
  if (channel.credentialSource === "runtime") {
    return resolveRuntimeCredential(channel, options.env ?? process.env);
  }
  if (channel.credentialSource === "model-config") {
    const fromAuth = await resolveAuthFileCredential(channel, options);
    if (fromAuth) return fromAuth;
  }
  return resolveConfiguredCredential(channel, options);
}

/** 解析运行时覆盖；缺失不得回退到持久凭据。 */
function resolveRuntimeCredential(
  channel: LiveChannel,
  env: NodeJS.ProcessEnv,
): BorrowedCredentialResult {
  const direct = resolveLiveApiKey(channel, env);
  if (direct) {
    return {
      kind: "resolved",
      apiKey: direct,
      source: channel.apiKey
        ? "runtime apiKey 字面量"
        : `runtime env ${channel.apiKeyEnv}`,
    };
  }
  return {
    kind: "missing",
    required: true,
    reason: "runtime 凭据覆盖已声明，但 API key 不可用",
  };
}

/** 解析认证文件条目；返回 undefined 表示默认同名条目不存在，可回退内联。 */
async function resolveAuthFileCredential(
  channel: LiveChannel,
  options: LiveCredentialOptions,
): Promise<BorrowedCredentialResult | undefined> {
  const explicitProvider = channel.auth?.provider;
  const provider = explicitProvider ?? channel.provider;
  if (!provider) return undefined;
  const load = await loadLiveAuthConfig({
    env: options.env ?? process.env,
    repoRoot: options.repoRoot,
    homeDir: options.homeDir,
  });
  if (load.kind === "not-configured") {
    if (explicitProvider) {
      throw new LiveAuthConfigError(
        `provider "${provider}" 的 auth.provider 显式绑定没有认证文件`,
      );
    }
    return undefined;
  }
  const entry = Object.hasOwn(load.config.providers, provider)
    ? load.config.providers[provider]
    : undefined;
  if (!entry) {
    if (explicitProvider) {
      throw new LiveAuthConfigError(
        `provider "${provider}" 的 auth.provider 显式绑定条目不存在`,
      );
    }
    return undefined;
  }
  return resolveAuthEntry(provider, entry, options.env ?? process.env);
}

/** 解析已选认证文件条目；缺值必须显式 missing。 */
function resolveAuthEntry(
  provider: string,
  entry: LiveAuthEntry,
  env: NodeJS.ProcessEnv,
): BorrowedCredentialResult {
  const apiKey = entry.apiKey ?? (entry.apiKeyEnv ? env[entry.apiKeyEnv] : "");
  if (apiKey) {
    return {
      kind: "resolved",
      apiKey,
      source: entry.apiKey
        ? "auth file apiKey 字面量"
        : `auth file env ${entry.apiKeyEnv}`,
    };
  }
  return {
    kind: "missing",
    required: true,
    reason: `provider "${provider}" 的 auth file 环境变量 ${entry.apiKeyEnv} 未设置`,
  };
}

/** 既有内联与宿主借用解析。 */
async function resolveConfiguredCredential(
  channel: LiveChannel,
  options: LiveCredentialOptions,
): Promise<BorrowedCredentialResult> {
  if (
    channel.credential === "harness" &&
    (channel.apiKey !== undefined || channel.apiKeyEnv !== undefined)
  ) {
    return {
      kind: "missing",
      reason: "显式凭据与 credential: harness 不能同时声明",
    };
  }
  const direct = resolveLiveApiKey(channel, options.env ?? process.env);
  if (direct) return resolvedDirectCredential(channel, direct);
  if (channel.credential !== "harness") {
    return {
      kind: "missing",
      reason:
        "未配置 apiKey/apiKeyEnv，且未声明 credential: harness（不悄悄借用宿主登录态）",
    };
  }
  return resolveBorrowedCredential(channel, options);
}

function resolvedDirectCredential(
  channel: LiveChannel,
  apiKey: string,
): BorrowedCredentialResult {
  return {
    kind: "resolved",
    apiKey,
    source: channel.apiKey
      ? "config apiKey 字面量"
      : `env ${channel.apiKeyEnv}`,
  };
}

async function resolveBorrowedCredential(
  channel: LiveChannel,
  options: LiveCredentialOptions,
): Promise<BorrowedCredentialResult> {
  if (channel.from !== "harness") {
    return {
      kind: "missing",
      reason: '借用凭据 credential: "harness" 必须同时声明 from: "harness"',
    };
  }
  const invalidChannel = await verifyBorrowedChannel(channel, options);
  if (invalidChannel) return { kind: "missing", reason: invalidChannel.reason };
  const borrow = options.borrowCredential;
  if (!borrow) {
    return {
      kind: "missing",
      reason: "未注入 borrowCredential 钩子，无法解析 credential: harness",
    };
  }
  return borrow(channel.harness ?? options.carrier, {
    homeDir: options.homeDir ?? homedir(),
    env: options.env ?? process.env,
    now: options.now ?? Date.now(),
    provider: channel.provider,
  });
}
