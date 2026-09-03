/**
 * @module @x-agent-suite/harness/driver
 * createHarnessDriver：一次性 headless harness 驱动。
 * 流程：
 * start = backend.start → createSandbox（stripEnv + backend env 注入）→
 * profile.writeConfig → resolveHarnessCommand；
 * sendPrompt 才拉起一次性进程（prompt 在 argv），消费 stdout JSONL 经
 * profile.createParser 归一成 Observation；close 关进程、停 backend、清 sandbox。
 * live 分支（backend.mode === "live"）：不注入 fixture 专用环境，已解析渠道由
 * writeConfig/liveEnv 接入沙箱；sandbox 目录需求完全由 profile 声明。
 * 不变量：
 * - 断言只看结构化 status（Observation.toolCalls[].status），不看退出码；
 * - CLI 不可用抛 HarnessUnavailableError，由 preflight 降级 skip；
 * - close 幂等。
 */
import { JsonlProcess } from "@x-agent-suite/driver";
import type {
  DriverEvent,
  Observation,
  Redactor,
  ToolCall,
} from "@x-agent-suite/contracts";
import { redactLiveError, redactValue } from "@x-agent-suite/llm-fixture";
import type { LlmBackend } from "@x-agent-suite/contracts";
import { createSandbox } from "@x-agent-suite/sandbox";
import { cleanupSandbox } from "@x-agent-suite/sandbox";
import type { SandboxContext } from "@x-agent-suite/contracts";
import { buildMcpServerSpec } from "./mcp-config";
import { resolveHarnessCommand, type ResolvedCommand } from "./resolve-command";
import type {
  HarnessDriver,
  HarnessProfile,
  ParsedEvent,
} from "@x-agent-suite/contracts";
import { startHarnessBackend } from "./backend-context";
import { createLifecycleError } from "./redaction";

/** createHarnessDriver 的选项。 */
export interface HarnessDriverOptions {
  /** mcp-stdio-entry.ts 绝对路径。 */
  readonly serverEntry: string;
  /** 注入 MCP server 进程的环境变量（E2E_HANDLE / E2E_SESSION_MODE 等）。 */
  readonly serverEnv?: Record<string, string>;
  /** MCP 配置中的 server 名；缺省 "reference"。 */
  readonly serverName?: string;
  /** 模型侧可见的工具名白名单；缺省放行 `<serverName>` 下全部 MCP 工具。 */
  readonly allowedTools?: readonly string[];
  /** sendPrompt 超时（毫秒）；默认 120_000。 */
  readonly promptTimeoutMs?: number;
  /** 测试注入：跳过 resolveHarnessCommand 直接使用该命令。 */
  readonly commandOverride?: ResolvedCommand;
}

const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;

/** 一次性 headless harness driver 实现。 */
class HarnessDriverImpl implements HarnessDriver {
  readonly profile: HarnessProfile;
  readonly redactor?: Redactor;

  private readonly backend: LlmBackend;
  private readonly options: HarnessDriverOptions;
  private readonly log: DriverEvent[] = [];
  private sandboxValue: SandboxContext | null = null;
  private command: ResolvedCommand | null = null;
  private activeProc: JsonlProcess | null = null;
  private lastProc: JsonlProcess | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(
    profile: HarnessProfile,
    backend: LlmBackend,
    options: HarnessDriverOptions,
  ) {
    this.profile = profile;
    this.backend = backend;
    this.redactor = backend.redactor;
    this.options = options;
  }

  get sandbox(): SandboxContext {
    if (!this.sandboxValue) {
      throw new Error(
        `HarnessDriver(${this.profile.name}): start 之前 sandbox 不可用`,
      );
    }
    return this.sandboxValue;
  }

  /** 启动：起假端点、建沙箱、写 MCP 配置、解析 CLI 命令。 */
  async start(): Promise<void> {
    if (this.sandboxValue || this.closePromise) {
      throw new Error(`HarnessDriver(${this.profile.name}): 重复 start`);
    }
    let stage = "backend";
    try {
      const backend = await startHarnessBackend(this.backend, this.profile);
      stage = "sandbox";
      const sandbox = await this.prepareSandbox(backend.env);
      stage = "config";
      await this.profile.writeConfig(sandbox, {
        server: buildMcpServerSpec(
          this.options.serverEntry,
          this.options.serverEnv,
        ),
        serverName: this.options.serverName,
        baseUrl: backend.baseUrl,
        apiKey: backend.apiKey,
        ...(backend.liveChannel ? { live: backend.liveChannel } : {}),
      });
      stage = "command";
      this.command =
        this.options.commandOverride ??
        (await resolveHarnessCommand({
          name: this.profile.command,
          win32: this.profile.win32,
        }));
    } catch (error) {
      let cleanupError: unknown;
      try {
        await this.close();
      } catch (closeError) {
        cleanupError = closeError;
      }
      throw createLifecycleError(
        `HarnessDriver(${this.profile.name})`,
        stage,
        error,
        cleanupError,
        this.redactor,
      );
    }
  }

  /** 创建并立即登记 sandbox，再注入声明的配置目录环境变量。 */
  private async prepareSandbox(
    env: Record<string, string>,
  ): Promise<SandboxContext> {
    const sandbox = await createSandbox({
      ...this.profile.sandbox,
      stripEnv: this.backend.mode === "live" ? [] : this.profile.stripEnv,
      env,
    });
    this.sandboxValue = sandbox;
    const dirEnv = this.profile.configDirEnv;
    if (!dirEnv) return sandbox;
    const dir = sandbox.configDirs?.[dirEnv.sandboxDir];
    if (!dir) {
      throw new Error(
        `HarnessDriver(${this.profile.name}): sandbox 缺少 ${dirEnv.sandboxDir}`,
      );
    }
    sandbox.env[dirEnv.env] = dir;
    return sandbox;
  }

  /** 发送一条 prompt：拉起一次性进程，消费 JSONL 至进程退出，聚合 Observation。 */
  async sendPrompt(text: string): Promise<Observation> {
    const sandbox = this.sandbox;
    if (this.closePromise) {
      throw new Error(
        `HarnessDriver(${this.profile.name}): 已关闭，不能 sendPrompt`,
      );
    }
    const command = this.command!;
    const serverName = this.options.serverName ?? "reference";
    const args = [
      ...command.argsPrefix,
      ...this.profile.headlessArgs(text, {
        mode: this.backend.mode,
        configFilePath: sandbox.configFilePath,
        allowedTools: this.options.allowedTools ?? [`mcp__${serverName}__*`],
      }),
    ];
    const proc = new JsonlProcess({
      command: command.command,
      args,
      cwd: sandbox.cwd,
      env: sandbox.env,
      closeStdinAfterStart: true,
    });
    this.activeProc = proc;
    this.lastProc = proc;
    try {
      await proc.start();
      return await this.collect(proc);
    } finally {
      this.activeProc = null;
      await proc.close();
    }
  }

  /** 最近一次进程的 stderr 尾部，用于失败诊断。 */
  stderrTail(): string {
    return this.redact(this.lastProc?.stderrTail() ?? "");
  }

  /** 按序返回已累计的底层事件（一次性 driver 无长驻流，回放日志）。 */
  async *events(): AsyncIterable<DriverEvent> {
    for (const event of this.log) {
      yield event;
    }
  }

  /** 幂等关闭：终止活动进程、停 backend、清 sandbox。 */
  async close(): Promise<void> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  /** 尝试全部资源清理阶段，并在末尾聚合错误。 */
  private async closeResources(): Promise<void> {
    const errors: unknown[] = [];
    const attempt = async (run: () => void | Promise<void>): Promise<void> => {
      try {
        await run();
      } catch (error) {
        errors.push(redactValue(error, this.redactor));
      }
    };
    await attempt(() => this.activeProc?.close());
    await attempt(() => this.backend.stop());
    if (this.sandboxValue)
      await attempt(() => cleanupSandbox(this.sandboxValue!));
    if (errors.length === 0) return;
    const detail = errors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("; ");
    throw redactLiveError(
      new AggregateError(
        errors,
        `HarnessDriver(${this.profile.name}) close: ${detail}`,
      ),
      this.redactor,
    );
  }

  /** 消费进程 stdout JSONL 至退出（带超时），聚合 Observation。 */
  private async collect(proc: JsonlProcess): Promise<Observation> {
    const parse = this.profile.createParser();
    const texts: string[] = [];
    const toolCalls: ToolCall[] = [];
    let steps: number | undefined;
    const timeoutMs = this.options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consumeError: Error | undefined;
    let timedOut = false;

    const consume = (async (): Promise<void> => {
      try {
        for await (const line of proc.lines()) {
          const safeLine = redactValue(line, this.redactor);
          this.applyParsed(parse(safeLine), texts, toolCalls);
          const last = this.log[this.log.length - 1];
          if (last?.type === "result") {
            const payload = last.payload as { steps?: number } | undefined;
            steps = payload?.steps;
          }
        }
      } catch (error) {
        consumeError = redactLiveError(error, this.redactor);
        throw consumeError;
      }
    })();

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(
          new Error(
            `HarnessDriver(${this.profile.name}): sendPrompt 超时（${timeoutMs}ms）`,
          ),
        );
      }, timeoutMs);
    });

    try {
      await Promise.race([consume, timeout]);
    } catch (error) {
      const base = this.redact(
        error instanceof Error ? error.message : String(error),
      );
      const extra =
        timedOut && consumeError ? `；消费错误: ${consumeError.message}` : "";
      const stderr = this.redact(proc.stderrTail());
      throw new Error(`${base}${extra}${stderr ? `；stderr: ${stderr}` : ""}`, {
        cause: redactValue(error, this.redactor),
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        // timeout 获胜时，消费循环可能仍在挂起读取 stdout；
        // 只附加 rejection handler 避免 unhandled rejection，不阻塞返回。
        consume.catch((error) => {
          console.error(
            `[HarnessDriver] 超时后消费循环延迟错误: ${this.redact(error instanceof Error ? error.message : String(error))}`,
          );
        });
      } else {
        // 消费正常结束或抛错，等它 settle 以保留完整上下文。
        await consume.catch(() => {});
      }
    }
    return redactValue(
      {
        text: texts.join(""),
        toolCalls,
        toolCallsCount: toolCalls.length,
        steps,
        events: [...this.log],
      },
      this.redactor,
    );
  }

  /** 把一条 ParsedEvent 盖戳入日志并聚合文本/工具调用。 */
  private applyParsed(
    parsed: ParsedEvent | readonly ParsedEvent[] | null,
    texts: string[],
    toolCalls: ToolCall[],
  ): void {
    if (!parsed) {
      return;
    }
    const safeParsed = redactValue(parsed, this.redactor);
    const events: readonly ParsedEvent[] = Array.isArray(safeParsed)
      ? safeParsed
      : [safeParsed as ParsedEvent];
    for (const item of events) {
      const event: DriverEvent = {
        type: item.type,
        timestamp: Date.now(),
        payload: item.payload,
      };
      this.log.push(event);
      if (item.type === "text") {
        texts.push(String((item.payload as { text?: string })?.text ?? ""));
      } else if (item.type === "tool_call") {
        toolCalls.push(item.payload as ToolCall);
      }
    }
  }

  /** 对可观测文本应用 backend 提供的脱敏器。 */
  private redact(text: string): string {
    return this.redactor?.(text) ?? text;
  }
}

/**
 * 创建一次性 headless harness driver。
 * @param profile 宿主适配档案。
 * @param backend LLM backend（fixture 假端点或 live）。
 * @param options server 入口与行为选项。
 */
export function createHarnessDriver(
  profile: HarnessProfile,
  backend: LlmBackend,
  options: HarnessDriverOptions,
): HarnessDriver {
  return new HarnessDriverImpl(profile, backend, options);
}
