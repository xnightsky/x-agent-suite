/**
 * @module @x-agent-suite/llm-fixture/live-credential
 * 解析显式或借用凭据，并在借用前验证渠道端点归属。
 */
import { homedir } from "node:os";
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
  const borrowed = await borrow(source, options.homeDir ?? homedir());
  if (borrowed.kind === "missing") return { reason: borrowed.reason };
  const mismatches = BORROWED_CREDENTIAL_ENDPOINT_FIELDS.filter(
    (field) => channel[field] !== borrowed[field],
  );
  return mismatches.length > 0
    ? { reason: `借用凭据渠道与当前端点不一致：${mismatches.join(", ")}` }
    : null;
}

/**
 * 按显式配置、环境变量、已验证借用渠道的顺序解析凭据。
 * @returns 解析出的凭据，或不满足安全前置条件时的显式 missing。
 */
export async function resolveLiveCredential(
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
