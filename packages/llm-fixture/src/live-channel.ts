/**
 * @module @x-agent-suite/llm-fixture/live-channel
 * 单条 LiveChannel 的声明校验与宿主渠道借用合并。
 * 不变量：不读文件、不发起网络请求；借用端点不得被隐式重定向。
 */
import type { WireProtocol } from "@x-agent-suite/contracts";
import { BORROWED_CREDENTIAL_ENDPOINT_FIELDS } from "./live-credential.ts";
import type {
  BorrowedChannelResult,
  LiveChannel,
  LiveChannelPricing,
  LiveConfigOptions,
} from "./live-types.ts";

const VALID_WIRES: readonly string[] = [
  "openai-responses",
  "openai-chat",
  "anthropic-messages",
  // BOUNDARY-DEBT(harness): gemini-generate 为历史协议标识
  "gemini-generate",
];

/** 单条声明的校验结果。 */
export type CarrierChannelResult =
  { readonly channel: LiveChannel } | { readonly reason: string };

/** 校验可选认证文件绑定。 */
function validateAuth(
  raw: unknown,
):
  | { readonly auth: { readonly provider: string } }
  | { readonly reason: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { reason: "auth 必须是对象" };
  }
  const record = raw as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => key !== "provider");
  if (unknown.length > 0) {
    return { reason: `auth 含未知字段：${unknown.join(", ")}` };
  }
  if (typeof record.provider !== "string" || record.provider.trim() === "") {
    return { reason: "auth.provider 必须是非空字符串" };
  }
  return { auth: { provider: record.provider } };
}

/** 校验并归一一份原始配置对象为 LiveChannel；不合法返回原因字符串。 */
export function validateChannel(raw: unknown): CarrierChannelResult {
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
  const parsedAuth =
    record.auth === undefined ? undefined : validateAuth(record.auth);
  if (parsedAuth && "reason" in parsedAuth) return parsedAuth;
  const channel: LiveChannel = {
    credentialSource: "model-config",
    ...(parsedAuth && "auth" in parsedAuth ? { auth: parsedAuth.auth } : {}),
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
    record.auth !== undefined &&
    (record.apiKey !== undefined ||
      record.apiKeyEnv !== undefined ||
      record.credential !== undefined)
  ) {
    return {
      reason: "auth.provider 不能与内联 apiKey/apiKeyEnv/credential 同时声明",
    };
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
  if (
    record.apiKey !== undefined ||
    record.apiKeyEnv !== undefined ||
    record.auth !== undefined
  )
    return [];
  return BORROWED_CREDENTIAL_ENDPOINT_FIELDS.filter(
    // provider-less 宿主的配置键只是逻辑目录名；wire/baseUrl 仍必须一致。
    (field) =>
      !(field === "provider" && borrowed.provider === undefined) &&
      record[field] !== undefined &&
      record[field] !== borrowed[field],
  );
}

/** 复用借用与端点校验流程解析一条模型声明。 */
export async function resolveCarrierChannel(
  carrier: string,
  decl: unknown,
  options: Required<Pick<LiveConfigOptions, "homeDir" | "borrowChannel">>,
): Promise<CarrierChannelResult> {
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
      return {
        reason: "from: harness 需要 borrowChannel 钩子；当前未注入借用能力",
      };
    }
    const borrowed = await options.borrowChannel(
      borrowFrom,
      options.homeDir,
      providerHint !== undefined ? { provider: providerHint } : undefined,
    );
    if (borrowed.kind !== "resolved") {
      return { reason: `from: harness 借用失败：${borrowed.reason}` };
    }
    const endpointOverrides = borrowedEndpointOverrides(record, borrowed);
    if (endpointOverrides.length > 0) {
      return {
        reason: `借用凭据时不能覆盖借用端点字段：${endpointOverrides.join(", ")}`,
      };
    }
    if (
      providerHint !== undefined &&
      record.model === undefined &&
      borrowed.model === undefined
    ) {
      return {
        reason: `provider 借用目标 "${providerHint}" 无宿主默认 model 可借（默认 model 属于默认 provider），须显式声明 model`,
      };
    }
    merged = {
      wire: record.wire ?? borrowed.wire,
      baseUrl: record.baseUrl ?? borrowed.baseUrl,
      model: record.model ?? borrowed.model,
      provider: record.provider ?? borrowed.provider,
      harnessBaseUrl: record.harnessBaseUrl ?? borrowed.harnessBaseUrl,
      ...record,
      ...(record.auth === undefined &&
      record.credential === undefined &&
      record.apiKey === undefined &&
      record.apiKeyEnv === undefined
        ? { credential: "harness" }
        : {}),
    };
  }
  return validateChannel(merged);
}
