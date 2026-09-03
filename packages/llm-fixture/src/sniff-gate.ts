/**
 * @module @x-agent-suite/llm-fixture/sniff-gate
 * 嗅探门禁（sniff gate）：live 开跑前的一轮最小真实调用——
 * 连通 → 鉴权 → tool calling 能力 →（尽力）模型标识回报。
 * 不变量：
 * - 任一阶段不过返回结构化 SniffResult（含 stage 与可读原因），供 skip 记录，绝不抛裸错；
 * - 原因文本一律经 redactLiveSecrets 脱敏（baseUrl 与 apiKey 不外泄）；
 * - transport 可注入：单元测试用 FakeProviderBackend 或桩当被嗅探端，不烧 token；
 * - 与 preflight 并列：preflight 验 harness 可用性，sniff 验渠道/模型可用性与能力。
 */
import { resolveLiveCredential, type LiveChannel } from "./live-config.ts";
import { redactLiveSecrets } from "./redact.ts";
import { parseLiveResponse } from "./live-parse.ts";
import {
  buildLiveRequest,
  createFetchTransport,
  type LiveTransport,
} from "./live-wires.ts";

/** 嗅探阶段标识。 */
export type SniffStage = "connectivity" | "auth" | "tool-calling";

/** 嗅探结果：通过（含尽力回报的模型标识）或结构化失败。 */
export type SniffResult =
  | {
      readonly ok: true;
      readonly carrier: string;
      /** 响应回填的模型标识（尽力；部分渠道不回填）。 */
      readonly modelReported?: string;
      /** 嗅探耗时（毫秒）。 */
      readonly latencyMs: number;
    }
  | {
      readonly ok: false;
      readonly carrier: string;
      /** 未过的阶段。 */
      readonly stage: SniffStage;
      /** 可读原因（已脱敏）。 */
      readonly reason: string;
    };

/** sniffLiveChannel 的可选项。 */
export interface SniffOptions {
  /** 注入 transport；缺省为全局 fetch。 */
  readonly transport?: LiveTransport;
  /** 嗅探超时（毫秒）；默认 20_000。 */
  readonly timeoutMs?: number;
  /** 环境变量表（apiKeyEnv 解析用）；缺省 process.env。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 渠道借用钩子（借用凭据前用于验证端点归属）。 */
  readonly borrowChannel?: import("./live-config.ts").LiveConfigOptions["borrowChannel"];
  /** 凭证借用钩子（credential: harness 时使用）。 */
  readonly borrowCredential?: import("./live-config.ts").LiveConfigOptions["borrowCredential"];
}

/** 嗅探探针工具：最小参数面，只验证「模型能发出合法工具调用」。 */
const SNIFF_TOOL = {
  name: "__e2e_sniff_probe",
  description: "E2E 嗅探探针：回显 echo 入参。",
  parameters: {
    type: "object",
    properties: { echo: { type: "string" } },
    required: ["echo"],
  },
} as const;

const DEFAULT_TIMEOUT_MS = 20_000;

/** 带超时的 transport 调用。 */
async function callWithTimeout(
  transport: LiveTransport,
  request: Parameters<LiveTransport>[0],
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      transport(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`sniff 超时（${timeoutMs}ms）`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * 对一个 carrier 的声明渠道跑嗅探门禁。
 * @param carrier 渠道归属的 carrier 标识。
 * @param channel 私密配置区解析出的渠道声明。
 * @returns 结构化结果；任何失败均不抛异常。
 */
export async function sniffLiveChannel(
  carrier: string,
  channel: LiveChannel,
  options: SniffOptions = {},
): Promise<SniffResult> {
  const started = Date.now();
  const transport = options.transport ?? createFetchTransport();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const credential = await resolveLiveCredential(channel, {
    carrier,
    env: options.env ?? process.env,
    borrowChannel: options.borrowChannel,
    borrowCredential: options.borrowCredential,
  });
  const resolvedSecrets =
    credential.kind === "resolved" ? [credential.apiKey] : [];
  const fail = (stage: SniffStage, reason: string): SniffResult => ({
    ok: false,
    carrier,
    stage,
    reason: redactLiveSecrets(reason, [channel], resolvedSecrets),
  });
  if (credential.kind === "missing" && channel.credential === "harness") {
    return fail("auth", credential.reason);
  }
  const request = buildLiveRequest(channel.wire, {
    baseUrl: channel.baseUrl,
    model: channel.model,
    apiKey: credential.kind === "resolved" ? credential.apiKey : undefined,
    messages: [
      {
        role: "user",
        text: `调用工具 ${SNIFF_TOOL.name}（参数 echo="ping"），不要输出其它内容。`,
      },
    ],
    tools: [SNIFF_TOOL],
    maxTokens: 256,
  });

  // 阶段 1：连通
  let response: { status: number; text: string };
  try {
    response = await callWithTimeout(transport, request, timeoutMs);
  } catch (error) {
    return fail(
      "connectivity",
      `请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 阶段 2：鉴权
  if (response.status === 401 || response.status === 403) {
    return fail(
      "auth",
      `HTTP ${response.status}（鉴权失败，检查 apiKey / apiKeyEnv 声明）`,
    );
  }
  if (response.status >= 400) {
    return fail(
      "connectivity",
      `HTTP ${response.status}：${response.text.slice(0, 200)}`,
    );
  }

  // 阶段 3：tool calling 能力（+ 阶段 4：尽力回报模型标识）
  let completion;
  try {
    completion = parseLiveResponse(
      channel.wire,
      response.status,
      response.text,
    );
  } catch (error) {
    return fail(
      "tool-calling",
      `响应解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (completion.toolCalls.length === 0) {
    return fail(
      "tool-calling",
      "响应未包含工具调用（渠道/模型可能不具备 tool calling 能力）",
    );
  }
  return {
    ok: true,
    carrier,
    latencyMs: Date.now() - started,
    ...(completion.model ? { modelReported: completion.model } : {}),
  };
}
