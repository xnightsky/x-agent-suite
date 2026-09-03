/**
 * @module @x-agent-suite/llm-fixture/live
 * LiveBackend：reference host live 对照组专用——框架直连私密配置区声明的真实 provider，
 * 从响应 usage 提取 token 数供 costUsd 估算。
 * 不变量：
 * - 仅 reference host live 对照组使用；harness live 路径不覆盖 base URL、不注入模型；
 * - 渠道未配置时 start 抛 LiveNotConfiguredError（显式类型，由调用方降级 skip）；
 * - 无本地资源（不起 server），stop 幂等 no-op；
 * - 错误显式抛出（LiveHttpError / 解析错误），不静默吞掉。
 */
import type { LlmBackend, Redactor } from "@x-agent-suite/contracts";
import {
  loadLiveConfig,
  resolveLiveChannel,
  resolveLiveCredential,
  type BorrowedCredentialResult,
  type LiveChannel,
  type LiveChannelPricing,
  type LiveConfigOptions,
} from "./live-config.ts";
import { parseLiveResponse } from "./live-parse.ts";
import {
  createSecretRedactor,
  redactLiveError,
  redactValue,
} from "./redact.ts";
import {
  buildLiveRequest,
  createFetchTransport,
  type LiveCompletion,
  type LiveMessage,
  type LiveToolSpec,
  type LiveTransport,
  type LiveUsage,
} from "./live-wires.ts";

/** 渠道未配置错误：matrix / 测试闸门据此降级 skip。 */
export class LiveNotConfiguredError extends Error {
  /** 未配置的 carrier。 */
  readonly carrier: string;

  constructor(carrier: string, reason: string) {
    super(`carrier "${carrier}" 的 live 渠道未配置：${reason}`);
    this.name = "LiveNotConfiguredError";
    this.carrier = carrier;
  }
}

/** LiveBackend 构造选项。 */
export interface LiveBackendOptions {
  /** carrier 标识（私密配置区的声明主体）。 */
  readonly carrier: string;
  /** 显式渠道声明；缺省时 start() 从私密配置区解析。 */
  readonly channel?: LiveChannel;
  /** 注入 transport；缺省为全局 fetch。 */
  readonly transport?: LiveTransport;
  /** 配置区查找选项（测试注入用）。 */
  readonly config?: LiveConfigOptions;
}

/** complete 的输入。 */
export interface LiveCompleteInput {
  /** 归一消息序列。 */
  readonly messages: readonly LiveMessage[];
  /** 工具声明（可选）。 */
  readonly tools?: readonly LiveToolSpec[];
  /** 最大输出 token（可选）。 */
  readonly maxTokens?: number;
}

/**
 * 直连真实 provider 的 LlmBackend（reference host live 对照组用）。
 * start() 返回声明渠道的 baseUrl 与解析后的 apiKey；complete() 发一轮补全并累计 usage。
 */
export class LiveBackend implements LlmBackend {
  /** backend 模式，固定 live。 */
  readonly mode = "live" as const;
  /** carrier 标识。 */
  readonly carrier: string;

  private readonly options: LiveBackendOptions;
  private readonly transport: LiveTransport;
  private channelValue: LiveChannel | null = null;
  private apiKeyValue = "";
  private redactText: Redactor = createSecretRedactor([]);
  private readonly usageLog: LiveUsage[] = [];

  /** 当前已解析 live secrets 的稳定脱敏接缝。 */
  readonly redactor: Redactor = (text) => this.redactText(text);

  constructor(options: LiveBackendOptions) {
    this.options = options;
    this.carrier = options.carrier;
    this.transport = options.transport ?? createFetchTransport();
  }

  /** 解析渠道（显式声明或私密配置区）并返回 baseUrl/apiKey。 */
  async start(): Promise<{ baseUrl: string; apiKey: string }> {
    try {
      if (!this.channelValue) await this.resolveChannel();
      this.refreshRedactor();
      const credential: BorrowedCredentialResult = await resolveLiveCredential(
        this.channelValue!,
        {
          carrier: this.carrier,
          env: this.options.config?.env ?? process.env,
          homeDir: this.options.config?.homeDir,
          borrowChannel: this.options.config?.borrowChannel,
          borrowCredential: this.options.config?.borrowCredential,
        },
      );
      if (
        credential.kind === "missing" &&
        this.channelValue!.credential === "harness"
      ) {
        throw new LiveNotConfiguredError(this.carrier, credential.reason);
      }
      this.apiKeyValue =
        credential.kind === "resolved" ? credential.apiKey : "";
      this.refreshRedactor();
      return { baseUrl: this.channelValue!.baseUrl, apiKey: this.apiKeyValue };
    } catch (error) {
      throw redactLiveError(error, this.redactor);
    }
  }

  /** 从显式选项或私密配置区解析渠道。 */
  private async resolveChannel(): Promise<void> {
    if (this.options.channel) {
      this.channelValue = this.options.channel;
      return;
    }
    const load = await loadLiveConfig(this.options.config);
    const result = resolveLiveChannel(
      load,
      this.carrier,
      this.options.config?.env ?? process.env,
    );
    if (result.kind !== "configured") {
      throw new LiveNotConfiguredError(this.carrier, result.reason);
    }
    this.channelValue = result.channel;
  }

  /** 根据当前渠道和凭据刷新脱敏器。 */
  private refreshRedactor(): void {
    const channel = this.channelValue;
    const secrets = [
      channel?.baseUrl ?? "",
      channel?.apiKey ?? "",
      this.apiKeyValue,
    ];
    try {
      const origin = new URL(channel?.baseUrl ?? "").origin;
      if (origin && origin !== "null") secrets.push(origin);
    } catch {
      // 非 URL 形态按整串处理即可。
    }
    this.redactText = createSecretRedactor(secrets);
  }

  /** 幂等 no-op（无本地资源）。 */
  stop(): Promise<void> {
    return Promise.resolve();
  }

  /** 已解析的渠道（start 后可用）；harness live 分支据此写沙箱真实配置/注入借用 env。 */
  get channel(): LiveChannel {
    if (!this.channelValue) {
      throw new Error("LiveBackend.channel 必须先 start()");
    }
    return this.channelValue;
  }

  /** 发一轮补全，返回归一结果（含 usage 与模型标识）；必须先 start。 */
  async complete(input: LiveCompleteInput): Promise<LiveCompletion> {
    const channel = this.channelValue;
    if (!channel) {
      throw new Error("LiveBackend.complete 必须先 start()");
    }
    try {
      const request = buildLiveRequest(channel.wire, {
        baseUrl: channel.baseUrl,
        model: channel.model,
        apiKey: this.apiKeyValue || undefined,
        messages: input.messages,
        tools: input.tools,
        maxTokens: input.maxTokens,
      });
      const response = await this.transport(request);
      const completion = parseLiveResponse(
        channel.wire,
        response.status,
        response.text,
      );
      if (completion.usage) this.usageLog.push(completion.usage);
      return redactValue(completion, this.redactor);
    } catch (error) {
      throw redactLiveError(error, this.redactor);
    }
  }

  /** 已累计的各轮 usage（供 costUsd 估算）。 */
  usages(): readonly LiveUsage[] {
    return [...this.usageLog];
  }
}

/**
 * 由 usage 与单价估算成本（美元）；无 pricing 声明时返回 undefined，不编造成本。
 */
export function estimateCostUsd(
  usage: LiveUsage,
  pricing?: LiveChannelPricing,
): number | undefined {
  if (!pricing) {
    return undefined;
  }
  return (
    (usage.promptTokens * pricing.inputPerMTokUsd) / 1e6 +
    (usage.completionTokens * pricing.outputPerMTokUsd) / 1e6
  );
}
