/**
 * @module @x-agent-suite/llm-fixture/sniff-gate
 * 嗅探门禁（sniff gate）：live 开跑前的一轮最小真实调用——
 * 连通 → 鉴权 → tool calling 能力 →（尽力）模型标识回报。
 * 不变量：
 * - 任一阶段不过返回结构化 SniffResult（含 stage 与可读原因），供 skip 记录，绝不抛裸错；
 * - 原因文本一律经 redactLiveSecrets 脱敏（baseUrl 与 apiKey 不外泄）；
 * - 整个尝试受统一 deadline 约束；超时 abort 请求，不让 credential hook 之后继续发请求；
 * - transport 可注入：单元测试用 FakeProviderBackend 或桩当被嗅探端，不烧 token；
 * - 与 preflight 并列：preflight 验 harness 可用性，sniff 验渠道/模型可用性与能力。
 */
import {
  resolveLiveCredential,
  type BorrowedCredentialResult,
  type LiveChannel,
} from "./live-config.ts";
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
  /** 整个 sniff 尝试的 deadline（毫秒）；默认 20_000。 */
  readonly timeoutMs?: number;
  /** 环境变量表（apiKeyEnv 解析用）；缺省 process.env。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 仓库根目录（repo-local 认证文件查找基点）。 */
  readonly repoRoot?: string;
  /** 用户 home 目录（home 级认证文件查找基点）。 */
  readonly homeDir?: string;
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

interface SniffAttemptContext {
  readonly carrier: string;
  readonly channel: LiveChannel;
  readonly transport: LiveTransport;
  readonly options: SniffOptions;
  readonly signal: AbortSignal;
  readonly resolvedSecrets: string[];
  readonly timeoutReason: string;
  readonly fail: (stage: SniffStage, reason: string) => SniffResult;
}

/** 超时错误使用固定文本，不携带请求头或 URL。 */
function timeoutMessage(timeoutMs: number): string {
  return `sniff 超时（${timeoutMs}ms）`;
}

/** 与 AbortSignal 竞速；超时/取消时拒绝，底层 Promise 仍由其自身负责停止。 */
function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  message: string,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(message));
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error(message));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([operation, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

/** 判断阶段函数是否已返回结构化 sniff 失败。 */
function isSniffResult(value: unknown): value is SniffResult {
  return typeof value === "object" && value !== null && "ok" in value;
}

/** 在整体 deadline 内解析凭据；超时或失败都不得继续请求。 */
async function sniffCredential(
  context: SniffAttemptContext,
): Promise<BorrowedCredentialResult | SniffResult> {
  let credential: BorrowedCredentialResult;
  try {
    credential = await abortable(
      resolveLiveCredential(context.channel, {
        carrier: context.carrier,
        env: context.options.env ?? process.env,
        repoRoot: context.options.repoRoot,
        homeDir: context.options.homeDir,
        borrowChannel: context.options.borrowChannel,
        borrowCredential: context.options.borrowCredential,
      }),
      context.signal,
      context.timeoutReason,
    );
  } catch (error) {
    return context.fail(
      "auth",
      context.signal.aborted
        ? `认证配置失败：${context.timeoutReason}`
        : `认证配置失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (credential.kind === "resolved") {
    context.resolvedSecrets.push(credential.apiKey);
  }
  if (
    credential.kind === "missing" &&
    (credential.required || context.channel.credential === "harness")
  ) {
    return context.fail("auth", credential.reason);
  }
  return credential;
}

/** 在整体 deadline 内送出请求并取得原始响应；超时先 abort 再返回失败。 */
async function sniffResponse(
  context: SniffAttemptContext,
  apiKey: string | undefined,
): Promise<{ status: number; text: string } | SniffResult> {
  if (context.signal.aborted) {
    return context.fail("connectivity", `请求失败：${context.timeoutReason}`);
  }
  let request: ReturnType<typeof buildLiveRequest>;
  try {
    request = buildLiveRequest(context.channel.wire, {
      baseUrl: context.channel.baseUrl,
      model: context.channel.model,
      apiKey,
      messages: [
        {
          role: "user",
          text: `调用工具 ${SNIFF_TOOL.name}（参数 echo="ping"），不要输出其它内容。`,
        },
      ],
      tools: [SNIFF_TOOL],
      maxTokens: 256,
      signal: context.signal,
    });
  } catch (error) {
    return context.fail(
      "connectivity",
      `请求构造失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return await abortable(
      context.transport(request),
      context.signal,
      context.timeoutReason,
    );
  } catch (error) {
    return context.fail(
      "connectivity",
      context.signal.aborted
        ? `请求失败：${context.timeoutReason}`
        : `请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
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
  const controller = new AbortController();
  const resolvedSecrets: string[] = [];
  const timeoutReason = timeoutMessage(timeoutMs);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fail = (stage: SniffStage, reason: string): SniffResult => ({
    ok: false,
    carrier,
    stage,
    reason: redactLiveSecrets(reason, [channel], resolvedSecrets),
  });
  const context: SniffAttemptContext = {
    carrier,
    channel,
    transport,
    options,
    signal: controller.signal,
    resolvedSecrets,
    timeoutReason,
    fail,
  };
  try {
    const credential = await sniffCredential(context);
    if (isSniffResult(credential)) return credential;
    const response = await sniffResponse(
      context,
      credential.kind === "resolved" ? credential.apiKey : undefined,
    );
    if (isSniffResult(response)) return response;
    if (controller.signal.aborted) {
      return fail("connectivity", `请求失败：${timeoutReason}`);
    }
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
  } finally {
    clearTimeout(timer);
  }
}
