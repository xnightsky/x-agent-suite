/**
 * @module @x-agent-suite/llm-fixture/live-carriers
 * Carrier 执行元数据与 channelsFrom 渠道目录引用。
 * 不变量：元数据不下传 LiveChannel；来源只提供目录，不转移 default 或执行实现。
 */
import { normalizeDefaultTargets } from "./live-targets.ts";
import type {
  LiveCarrierResolution,
  LiveChannel,
} from "./live-types.ts";

type CarrierMetadataResult =
  | { readonly metadata: LiveCarrierResolution }
  | { readonly reason: string };

/** 解析 Carrier 级执行元数据；缺省 kind 为 cli。 */
export function parseCarrierMetadata(
  record?: Record<string, unknown>,
): CarrierMetadataResult {
  if (!record) return { metadata: { kind: "cli" } };
  const kind = record.kind ?? "cli";
  if (kind !== "cli" && kind !== "ephemeral-client") {
    return { reason: "kind 只支持 cli 或 ephemeral-client" };
  }
  const clientRef = record.clientRef;
  if (kind === "ephemeral-client") {
    if (typeof clientRef !== "string" || clientRef === "") {
      return { reason: "ephemeral-client 必须声明非空 clientRef" };
    }
  } else if (clientRef !== undefined) {
    return { reason: "cli 不得声明 clientRef" };
  }
  const channelCarrier = record.channelsFrom;
  if (channelCarrier !== undefined) {
    if (typeof channelCarrier !== "string" || channelCarrier === "") {
      return { reason: "channelsFrom 必须是非空字符串" };
    }
  }
  return {
    metadata: {
      kind,
      ...(kind === "ephemeral-client"
        ? { clientRef: clientRef as string }
        : {}),
      ...(typeof channelCarrier === "string" ? { channelCarrier } : {}),
    },
  };
}

/** 删除不得下传到 Provider/LiveChannel 的 Carrier 元数据。 */
export function stripCarrierMetadata(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !["kind", "clientRef", "channelsFrom"].includes(key),
    ),
  );
}

interface ReferencedChannels {
  readonly available: readonly LiveChannel[];
  readonly defaults: readonly LiveChannel[];
  readonly channel?: LiveChannel;
}

/** 复用来源 Carrier 的可选渠道，并只按当前 Carrier 的 default 选择目标。 */
export function resolveReferencedChannels(
  record: Record<string, unknown>,
  sourceRecord: Record<string, unknown> | undefined,
  sourceAvailable: readonly LiveChannel[] | undefined,
  sourceInvalid: string | undefined,
): ReferencedChannels | { readonly reason: string } {
  const unexpected = Object.keys(record).filter(
    (key) => !["kind", "clientRef", "channelsFrom", "default"].includes(key),
  );
  if (unexpected.length > 0) {
    return {
      reason: "channelsFrom 不得与渠道字段同时声明：" + unexpected.join(", "),
    };
  }
  if (sourceInvalid) return { reason: "channelsFrom 来源无效：" + sourceInvalid };
  if (
    !sourceRecord ||
    sourceRecord.providers === undefined ||
    sourceRecord.channelsFrom !== undefined ||
    !sourceAvailable
  ) {
    return {
      reason: "channelsFrom 来源必须直接持有 providers，且禁止链式或循环引用",
    };
  }
  if (record.default === undefined) {
    return { available: sourceAvailable, defaults: [] };
  }
  const refs = sourceAvailable.map((channel) => ({
    provider: channel.provider ?? "",
    model: channel.model,
  }));
  const normalized = normalizeDefaultTargets(record.default, refs);
  if ("reason" in normalized) return normalized;
  const defaults = normalized.targets.map((target) =>
    sourceAvailable.find(
      (channel) =>
        channel.provider === target.provider && channel.model === target.model,
    ),
  );
  if (defaults.some((channel) => channel === undefined)) {
    return { reason: "default 目标未能归一到 channelsFrom 可选渠道" };
  }
  const channels = defaults as LiveChannel[];
  return { available: sourceAvailable, defaults: channels, channel: channels[0] };
}
