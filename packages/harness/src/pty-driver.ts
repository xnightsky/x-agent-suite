/**
 * @module @x-agent-suite/harness/pty-driver
 * PTY 长驻 AgentDriver：在 PTY 中拉起宿主 TUI，通过屏幕 idle 判定聚合 Observation。 // BOUNDARY-DEBT(harness): 宿主专用注释，迁移遗留
 * 采用纯屏幕 + I/O + FS 启发式判定；
 * driver 不观察结构化工具事件，因此工具调用列表为空，但宿主插件仍可自行提供 MCP。 // BOUNDARY-DEBT(harness): 宿主专用注释，迁移遗留
 * 不变量：
 * - start = backend.start → createSandbox → profile.writeConfig →
 *   [profile.installPlugins（声明 plugins 时）] →
 *   resolveHarnessCommand({ ptyCommand }) → PtyProcess.start → waitForScreen(ptyReadyPattern)；
 * - injectServer=false 时不构造也不传 reference MCP server，serverEntry 可省略；
 * - inject 先写 prompt 文本，等屏幕回显确认后再写提交键，然后等 PtyScreenWatcher 判定 idle；
 *   实测依据（某宿主 0.36.1，判据为顶部 `Session: session_<uuid>`）： // BOUNDARY-DEBT(harness): 宿主版本号，迁移遗留
 *   文本与 \r 同一 tick 连写时，5~6 字节输入可提交，而 42~44 字节必失败（回车被丢）；
 *   加 300ms 间隔即成功。与字符集无关（ASCII 44 字节同样失败），是某 TUI 框架需时间消费输入缓冲。 // BOUNDARY-DEBT(harness): 宿主专用注释，迁移遗留
 * - 同一时刻至多一轮 prompt 在飞；injectMode 固定 "followUp"；
 * - close 幂等，先关 PTY，再执行 sandboxTeardown，随后停 backend，最后清 sandbox。
 */
import type {
  DriverEvent,
  InboundEvent,
  LongLivedAgentDriver,
  Observation,
  Redactor,
} from "@x-agent-suite/contracts";
import { PtyProcess } from "@x-agent-suite/driver";
import { redactLiveError, redactValue } from "@x-agent-suite/llm-fixture";
import type { LlmBackend } from "@x-agent-suite/contracts";
import { createSandbox } from "@x-agent-suite/sandbox";
import type { SandboxContext } from "@x-agent-suite/contracts";
import { buildMcpServerSpec } from "./mcp-config";
import type { PluginInstallSpec } from "./plugin-install";
import type { ResolvedCommand } from "./resolve-command";
import type { HarnessProfile } from "@x-agent-suite/contracts";
import {
  delay,
  startPtyProcess,
  waitForPtyEcho,
  waitForPtyReady,
} from "./pty-io";
import { cleanupPtyDriverResources } from "./pty-cleanup";
import {
  createPtyScreenWatcher,
  type FsChangeWatcher,
  type PtyScreenWatcher,
} from "./pty-watcher";
import {
  startHarnessBackend,
  type StartedHarnessBackend,
} from "./backend-context";
import { createLifecycleError } from "./redaction";

/** createPtyAgentDriver 的选项。 */
export interface PtyAgentDriverOptions {
  /** 宿主适配档案。 */
  readonly profile: HarnessProfile;
  /** LLM backend（fixture 假端点或 live）。 */
  readonly backend: LlmBackend;
  /** reference mcp-stdio-entry.ts 绝对路径；injectServer=false 时省略。 */
  readonly serverEntry?: string;
  /** 注入 MCP server 进程的环境变量（E2E_HANDLE / E2E_SESSION_MODE 等）。 */
  readonly serverEnv?: Record<string, string>;
  /** MCP 配置中的 server 名；缺省 "reference"。 */
  readonly serverName?: string;
  /** 额外工作区目录（某宿主 --add-dir）；不传则 PTY 不附加项目。 */ // BOUNDARY-DEBT(harness): 宿主参数语义，profile 注册时声明
  readonly addDir?: string;
  /**
   * 待安装到沙箱的本地插件；非空时 profile 必须声明 installPlugins。
   * 用于验证真实插件加载路径（hooks + 插件内 MCP server）。
   */
  readonly plugins?: readonly PluginInstallSpec[];
  /** 是否把 E2E reference MCP 写入宿主配置；缺省 true。 */
  readonly injectServer?: boolean;
  /** sandbox 创建、宿主配置与插件安装完成后，PTY spawn 前的准备回调。 */
  readonly sandboxSetup?: (sandbox: SandboxContext) => Promise<void>;
  /** PTY 关闭后、backend 与 sandbox cleanup 前的清理回调。 */
  readonly sandboxTeardown?: (sandbox: SandboxContext) => Promise<void>;
  /** 等待 TUI 就绪的超时毫秒；默认 60000。 */
  readonly readyTimeoutMs?: number;
  /** 单轮 prompt 等待 idle 的硬超时毫秒；默认 180000。 */
  readonly promptTimeoutMs?: number;
  /** 等 prompt 文本回显到屏幕的超时毫秒；默认 10000。 */
  readonly echoTimeoutMs?: number;
  /** 屏幕稳定所需毫秒；默认 1500。 */
  readonly screenIdleMs?: number;
  /** I/O 静默所需毫秒；默认 500。 */
  readonly ioIdleMs?: number;
  /** 文件系统变更频率监视器；缺省不启用 FS 维度。 */
  readonly fsWatcher?: FsChangeWatcher;
  /** 测试注入：跳过 resolveHarnessCommand 直接使用该命令。 */
  readonly commandOverride?: ResolvedCommand;
}

/** PTY 长驻 driver：额外暴露 sandbox 与 screenTail 供诊断。 */
export interface PtyAgentDriver extends LongLivedAgentDriver {
  /** 本 driver 的隔离沙箱（start 后可用）。 */
  readonly sandbox: SandboxContext;
  /** 当前 PTY 屏幕尾部；PTY 已关闭时回退最近一轮快照。 */
  screenTail(): string;
}

const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 180_000;
const DEFAULT_ECHO_TIMEOUT_MS = 10_000;

/**
 * 回显确认后到写提交键的附加稳定间隔。
 * 实测（见模块头）：长输入下仅「已回显」不足以保证某 TUI 框架已消费完输入缓冲， // BOUNDARY-DEBT(harness): 宿主专用注释，迁移遗留
 * 300ms 为实测通过值，取 400ms 留余量。
 */
const SUBMIT_SETTLE_MS = 400;

/**
 * PTY 长驻 driver 实现。
 *
 * @behavior pty-driver-lifecycle
 * Given: 调用方以声明了 ptyArgs 的 profile 与 LlmBackend 构造 driver。
 * When: start → close。
 * Then: start 按 backend.start → createSandbox → writeConfig → [installPlugins]（声明
 *   plugins 时）→ 拉起 PTY → 等 ptyReadyPattern（并顺带处理 ptySetupSequence 对话框）；
 *   injectServer=false 时配置上下文不含 reference server；close 幂等，按 PTY →
 *   sandboxTeardown → backend → cleanupSandbox 顺序清理。
 * Failure: 重复 start、profile 未声明 ptyArgs、启用 reference MCP 却缺 serverEntry、
 *   声明 plugins 但 profile 无 installPlugins、start 前访问 sandbox，均显式报错。
 *
 * @behavior pty-driver-prompt-submit
 * Given: driver 已 start，某宿主在 PTY 中等待输入。 // BOUNDARY-DEBT(harness): 宿主专用注释，迁移遗留
 * When: inject(text)。
 * Then: 先写 prompt 文本、最多等 echoTimeoutMs（默认 10s）确认回显，再等提交前稳定间隔
 *   （SUBMIT_SETTLE_MS=400ms，实测依据见模块头某 TUI 框架粘贴缓冲消费时延）， // BOUNDARY-DEBT(harness): 宿主专用注释，迁移遗留
 *   写 \r 后再等一次启动间隔，最后等 watcher 判定 idle；Observation.text 为完整屏幕快照，
 *   toolCalls 恒为空（driver 不观察结构化工具事件）；轮次串行。
 * Failure: start 前或 close 后 inject 显式报错；回显超时只记录 echoTimeout 后宽容提交，
 *   idle 超时带最后屏幕抛错。
 *
 * @behavior pty-driver-cleanup-order
 * Given: driver 已 start，可能持有活跃 PTY、backend、sandbox。
 * When: close。
 * Then: 幂等，按 PTY（write Ctrl-C、waitExit）→ sandboxTeardown → backend.stop →
 *   cleanupSandbox 顺序清理；即使某阶段失败也继续后续清理。
 * Failure: 任一阶段失败时，在全部阶段尝试结束后抛 AggregateError，禁止清理假绿。
 */

class PtyAgentDriverImpl implements PtyAgentDriver {
  readonly injectMode = "followUp" as const;
  readonly redactor?: Redactor;

  private readonly profile: HarnessProfile;
  private readonly backend: LlmBackend;
  private readonly options: PtyAgentDriverOptions;
  private readonly eventLog: DriverEvent[] = [];
  private sandboxValue: SandboxContext | null = null;
  private pty: PtyProcess | null = null;
  private watcher: PtyScreenWatcher | null = null;
  private closePromise: Promise<void> | null = null;
  private roundChain: Promise<unknown> = Promise.resolve();
  private lastScreen = "";

  constructor(options: PtyAgentDriverOptions) {
    this.profile = options.profile;
    this.backend = options.backend;
    this.redactor = options.backend.redactor;
    this.options = options;
  }

  get sandbox(): SandboxContext {
    if (!this.sandboxValue) {
      throw new Error(
        `PtyAgentDriver(${this.profile.name}): start 之前 sandbox 不可用`,
      );
    }
    return this.sandboxValue;
  }

  /** 启动完整 PTY 生命周期；任一阶段失败都先完成清理再抛错。 */
  async start(): Promise<void> {
    if (this.sandboxValue || this.closePromise) {
      throw new Error(`PtyAgentDriver(${this.profile.name}): 重复 start`);
    }
    if (!this.profile.ptyArgs) {
      throw new Error(
        `PtyAgentDriver(${this.profile.name}): profile 未声明 ptyArgs，不支持 PTY 模式`,
      );
    }

    let stage = "backend";
    try {
      const backend = await startHarnessBackend(this.backend, this.profile);
      stage = "sandbox";
      const sandbox = await this.prepareSandbox(backend, (next) => {
        stage = next;
      });
      stage = "spawn";
      await this.launchPty(sandbox, (next) => {
        stage = next;
      });
    } catch (error) {
      let cleanupError: unknown;
      try {
        await this.close(`start[${stage}] failed`);
      } catch (closeError) {
        cleanupError = closeError;
      }
      throw createLifecycleError(
        `PtyAgentDriver(${this.profile.name})`,
        stage,
        error,
        cleanupError,
        this.redactor,
      );
    }
  }

  /** 创建并配置 sandbox，最后执行 spawn 前准备。 */
  private async prepareSandbox(
    backend: StartedHarnessBackend,
    setStage: (stage: string) => void,
  ): Promise<SandboxContext> {
    const live = this.backend.mode === "live";
    const sandbox = await createSandbox({
      ...this.profile.sandbox,
      stripEnv: live ? [] : this.profile.stripEnv,
      runtimeDir: true,
      env: backend.env,
    });
    this.sandboxValue = sandbox;
    this.applyConfigDir(sandbox);

    setStage("config");
    const configBase = {
      serverName: this.options.serverName,
      baseUrl: backend.baseUrl,
      apiKey: backend.apiKey,
      ...(backend.liveChannel ? { live: backend.liveChannel } : {}),
    };
    if (this.options.injectServer === false) {
      await this.profile.writeConfig(sandbox, {
        ...configBase,
        injectServer: false,
      });
    } else {
      if (!this.options.serverEntry) {
        throw new Error(
          `PtyAgentDriver(${this.profile.name}): 启用 reference MCP 时必须提供 serverEntry`,
        );
      }
      await this.profile.writeConfig(sandbox, {
        ...configBase,
        server: buildMcpServerSpec(
          this.options.serverEntry,
          this.options.serverEnv,
        ),
      });
    }
    setStage("install");
    await this.installPlugins(sandbox);
    setStage("setup");
    await this.options.sandboxSetup?.(sandbox);
    return sandbox;
  }

  /** 注入 profile 的隔离配置目录环境变量。 */
  private applyConfigDir(sandbox: SandboxContext): void {
    const dirEnv = this.profile.configDirEnv;
    if (!dirEnv) return;
    const dir = sandbox.configDirs?.[dirEnv.sandboxDir];
    if (!dir) {
      throw new Error(
        `PtyAgentDriver(${this.profile.name}): sandbox 缺少 ${dirEnv.sandboxDir}`,
      );
    }
    sandbox.env[dirEnv.env] = dir;
  }

  /** 安装调用方声明的宿主插件。 */
  private async installPlugins(sandbox: SandboxContext): Promise<void> {
    const plugins = this.options.plugins ?? [];
    if (plugins.length === 0) return;
    if (!this.profile.installPlugins) {
      throw new Error(
        `PtyAgentDriver(${this.profile.name}): profile 未声明 installPlugins，不支持插件安装`,
      );
    }
    await this.profile.installPlugins(sandbox, plugins);
  }

  /** 解析命令、拉起 PTY、等待 ready 并创建轮次 watcher。 */
  private async launchPty(
    sandbox: SandboxContext,
    setStage: (stage: string) => void,
  ): Promise<void> {
    this.pty = await startPtyProcess({
      profile: this.profile,
      sandbox,
      commandOverride: this.options.commandOverride,
      addDir: this.options.addDir,
    });
    setStage("ready");
    if (this.profile.ptyReadyPattern) {
      await waitForPtyReady(
        this.pty,
        this.profile,
        this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
        this.redactor,
      );
    }
    this.watcher = createPtyScreenWatcher({
      pty: this.pty,
      idlePatterns: this.profile.ptyIdlePatterns,
      promptPattern: this.profile.ptyPromptPattern,
      fsWatcher: this.options.fsWatcher,
      screenIdleMs: this.options.screenIdleMs,
      ioIdleMs: this.options.ioIdleMs,
      hardTimeoutMs: this.options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
    });
  }

  /** 发送首轮 prompt。 */
  sendPrompt(text: string): Promise<Observation> {
    return this.inject(text);
  }

  /** 向存活 TUI 会话注入 prompt；轮次串行。 */
  inject(text: string): Promise<Observation> {
    if (this.closePromise) {
      return Promise.reject(
        new Error(`PtyAgentDriver(${this.profile.name}): 已关闭，不能 inject`),
      );
    }
    if (!this.pty || !this.watcher) {
      return Promise.reject(
        new Error(
          `PtyAgentDriver(${this.profile.name}): start 之前不能 inject`,
        ),
      );
    }
    const run = this.roundChain.then(() => this.promptRound(text));
    this.roundChain = run.catch(() => {});
    return run as Promise<Observation>;
  }

  /** 按序暴露入站事件流；PTY 方案 A 无反向事件，close 后结束。 */
  async *inbound(): AsyncIterable<InboundEvent> {
    // PTY 方案 A 不消费结构化入站事件，返回空迭代器。
    return;
  }

  /** waitInbound 在本实现中不可用（无反向事件）。 */
  waitInbound(): Promise<InboundEvent> {
    return Promise.reject(
      new Error(
        `PtyAgentDriver(${this.profile.name}): PTY 方案 A 不支持 waitInbound`,
      ),
    );
  }

  /** 按序暴露底层事件流；close 后迭代结束。 */
  async *events(): AsyncIterable<DriverEvent> {
    for (const event of this.eventLog) {
      yield event;
    }
  }

  /** 当前 PTY 屏幕尾部；PTY 已关闭时回退最近一轮快照。 */
  screenTail(): string {
    const screen = this.pty?.screen() || this.lastScreen;
    return this.redact(screen.slice(-2_000));
  }

  /** 幂等关闭：关 PTY → sandboxTeardown → 停 backend → 清 sandbox。 */
  close(reason?: string): Promise<void> {
    this.closePromise ??= this.doClose(reason);
    return this.closePromise;
  }

  /** 执行一轮 prompt 注入并等待 idle。 */
  private async promptRound(text: string): Promise<Observation> {
    const pty = this.pty!;
    const watcher = this.watcher!;
    const eventsStart = this.eventLog.length;

    this.pushEvent("prompt", { text });
    pty.write(text);
    await this.waitForEcho(text);
    pty.write("\r");
    // 提交后先等宿主真正开始本轮，再交给 watcher：否则屏幕尚未变化，watcher 会立即
    // 判定 idle（实测 waitedMs=0）而把未开始的一轮误当已完成。
    await delay(SUBMIT_SETTLE_MS);

    const idle = await watcher.waitForIdle();
    this.lastScreen = idle.screen;
    this.pushEvent("idle", {
      reason: idle.reason,
      waitedMs: idle.waitedMs,
      cursor: idle.cursor,
    });
    if (idle.reason === "timeout") {
      throw new Error(
        `[timeout] PtyAgentDriver(${this.profile.name}) 当前轮次等待 idle 超时（${idle.waitedMs}ms）；` +
          `最后一屏：\n${this.redact(idle.screen.slice(-2_000))}`,
      );
    }

    return redactValue(
      {
        text: idle.screen,
        toolCalls: [],
        toolCallsCount: 0,
        events: this.eventLog.slice(eventsStart),
      },
      this.redactor,
    );
  }

  /**
   * 等 prompt 文本回显到屏幕，再附加一段稳定间隔，然后才允许写提交键。
   * marker 取首行前 12 个**非空白**字符：输入框会折行并插入边框与空白，整串/含空白
   * 匹配在长文本下必失败，回显误判会连带提交失效。
   * 回显超时不报错，仅记事件后照常提交（宽容不回显的宿主），但稳定间隔仍会等。
   */
  private async waitForEcho(text: string): Promise<void> {
    const echoed = await waitForPtyEcho(
      this.pty!,
      text,
      this.options.echoTimeoutMs ?? DEFAULT_ECHO_TIMEOUT_MS,
    );
    if (echoed !== undefined) {
      this.pushEvent(echoed ? "echo" : "echoTimeout", { text });
    }
    await delay(SUBMIT_SETTLE_MS);
  }

  /** 盖戳一条 DriverEvent 入日志。 */
  private pushEvent(type: string, payload: unknown): void {
    const event: DriverEvent = {
      type,
      timestamp: Date.now(),
      payload: redactValue(payload, this.redactor),
    };
    this.eventLog.push(event);
  }

  /** 对可观测文本应用 backend 提供的脱敏器。 */
  private redact(text: string): string {
    return this.redactor?.(text) ?? text;
  }

  /** 关闭实现：释放 watcher 后委托固定顺序的聚合资源清理。 */
  private async doClose(reason?: string): Promise<void> {
    this.pushEvent("closing", { reason });
    this.watcher?.dispose();
    this.watcher = null;
    const pty = this.pty;
    this.pty = null;
    try {
      await cleanupPtyDriverResources({
        profileName: this.profile.name,
        pty,
        backend: this.backend,
        sandbox: this.sandboxValue,
        ...(this.options.sandboxTeardown
          ? { sandboxTeardown: this.options.sandboxTeardown }
          : {}),
      });
    } catch (error) {
      throw redactLiveError(error, this.redactor);
    }
  }
}

/**
 * 创建 PTY 长驻 agent driver。
 * @param options profile、backend 与行为选项。
 */
export function createPtyAgentDriver(
  options: PtyAgentDriverOptions,
): PtyAgentDriver {
  return new PtyAgentDriverImpl(options);
}
