/**
 * @module profiles/pi-recall
 * 消费者侧 Pi Recall Driver：把 Pi 宿主启动参数、隔离配置投影、原生 JSONL 证据与资源清理收口到一个公开工厂。
 *
 * 不变量：
 * - 只服务 live borrowed 执行：不读 auth.json、不写真实 HOME，凭据只经 writePiLiveConfig 投影进隔离目录；
 * - 默认关闭所有发现面；受信任 Profile 可显式开启隔离工作区的上下文文件，工具策略单独由 effects 兑现；
 * - --tools 只是工具集裁剪（read-only 与 allowlist 都只放行固定四个原生只读工具）；文件系统边界与步数预算
 *   由守卫扩展兑现，守卫只覆盖当前 tools/path/maxSteps；
 * - 证据只认原生事件：agent_end 判完成，tool_execution_end 判工具成败，message_end 的 stopReason/usage
 *   判错误、截断与用量；退出码与模型自述都不作为证据；
 * - 只支持单轮：spec.turns 超过一轮在工厂阶段就拒绝，绝不靠拼接历史伪造上下文；
 * - 消费者可用 appendSystemPrompt 注入自己受信任的追加系统提示词，内容原样透传、本模块不解释。
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentDriver,
  HarnessDriver,
  HarnessProfile,
  ParsedEvent,
  SandboxContext,
  ScenarioSpec,
  ToolCall,
} from "@x-agent-suite/contracts";
import {
  createHarnessDriver,
  type ResolvedCommand,
} from "@x-agent-suite/harness";
import {
  materializeRecallProvision,
  type RecallEffects,
  type RecallProfileDriverContext,
} from "@x-agent-suite/recall";
import { writePiLiveConfig } from "./pi-config.ts";

/** 隔离配置目录语义键：与 writePiLiveConfig 读取的 sandbox.configDirs.piHome 一致。 */
const PI_HOME_DIR = "piHome";
/** 守卫扩展文件名。 */
const GUARD_FILE = "pi-recall-guard.ts";
/** 原生只读工具集；仅裁剪工具集，不构成文件系统沙箱。 */
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
/** 默认干净启动参数；项目上下文仅由受信任选项显式开启。 */
const CLEAN_START_ARGS = [
  "--mode",
  "json",
  "--print",
  "--no-session",
  "--no-context-files",
  "--no-skills",
  "--no-extensions",
  "--no-mcp",
  "--no-prompt-templates",
  // headless 无交互确认入口：显式信任本次隔离工作区，并关闭启动期网络行为。
  "--approve",
  "--offline",
] as const;
/** 允许进入子进程的环境变量；harness live 分支不套用 profile.stripEnv，必须在此显式收敛。 */
const SANDBOX_ENV_ALLOWLIST = new Set(
  (
    "HOME USERPROFILE APPDATA LOCALAPPDATA PATH PATHEXT SystemRoot SYSTEMROOT ComSpec COMSPEC " +
    "TMPDIR TEMP TMP LANG LC_ALL TERM PI_CODING_AGENT_DIR " +
    "http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY"
  ).split(" "),
);

/** createPiRecallDriver 的注入选项。 */
export interface PiRecallDriverOptions {
  /** 测试注入：跳过宿主 CLI 解析直接使用该命令（等价 HarnessDriverOptions.commandOverride）。 */
  readonly commandOverride?: ResolvedCommand;
  /**
   * 消费者受信任的追加系统提示词；仅映射 --append-system-prompt，内容由消费者自己构建，
   * 本模块不读取消费者路径、也不从考卷推测内容。
   */
  readonly appendSystemPrompt?: string;
  /** 默认 off；project 允许宿主原生发现隔离工作区中的项目上下文文件。 */
  readonly contextFiles?: "off" | "project";
}

/** 原生 usage 累计值。 */
interface NativeUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

/** 一轮原生 JSONL 的累计证据。 */
interface NativeState {
  text: string;
  steps: number;
  completed: boolean;
  budgetAborted: boolean;
  usage: NativeUsage;
}

/** 在创建任何执行资源前拒绝当前工厂不能兑现的声明。 */
function assertSupported(
  { spec, executionParams, effects }: RecallProfileDriverContext,
  options: PiRecallDriverOptions,
): void {
  if (
    options.contextFiles !== undefined &&
    options.contextFiles !== "off" &&
    options.contextFiles !== "project"
  ) {
    throw new Error("Pi Recall Driver contextFiles 只支持 off/project");
  }
  if (spec.turns.length > 1) {
    throw new Error(
      "Pi Recall Driver 只支持单轮场景，headless 不保留多轮上下文",
    );
  }
  if (
    options.appendSystemPrompt !== undefined &&
    !options.appendSystemPrompt.trim()
  ) {
    throw new Error("Pi Recall Driver appendSystemPrompt 必须是非空字符串");
  }
  const unsupported = Object.keys(executionParams).filter(
    (key) => key !== "thinkingLevel",
  );
  if (unsupported.length > 0) {
    throw new Error(
      "Pi Recall Driver executionParams 仅支持 thinkingLevel，不支持：" +
        unsupported.join(","),
    );
  }
  if (effects.commands.allow.length > 0) {
    throw new Error(
      "Pi Recall Driver 不提供命令执行工具，无法兑现 effects.commands.allow",
    );
  }
}

/** 守卫扩展源码：只兑现当前策略——工具白名单、工作区路径容器校验与轮次预算中断。 */
function guardSource(workspace: string, maxSteps: number): string {
  return [
    "import { realpathSync } from 'node:fs';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "",
    "export default function (pi) {",
    "  const workspace = " + JSON.stringify(workspace) + ";",
    "  const allowedTools = " + JSON.stringify([...READ_ONLY_TOOLS]) + ";",
    "  pi.on('tool_call', (event) => {",
    "    if (!allowedTools.includes(event.toolName)) {",
    "      return { block: true, reason: 'Pi Recall Driver：工具不在只读白名单内' };",
    "    }",
    "    try {",
    "      const target = realpathSync(resolve(workspace, event.input?.path ?? '.'));",
    "      const nested = relative(workspace, target);",
    "      if (nested === '..' || nested.startsWith('..' + sep) || isAbsolute(nested)) {",
    "        return { block: true, reason: 'Pi Recall Driver：路径越出隔离工作区' };",
    "      }",
    "    } catch (error) {",
    "      return { block: true, reason: 'Pi Recall Driver：路径不可用 ' + (error?.code ?? 'unknown') };",
    "    }",
    "    return undefined;",
    "  });",
    "  pi.on('turn_end', async (event, ctx) => {",
    "    if (event.turnIndex >= " +
      String(maxSteps - 1) +
      ") await ctx.abort();",
    "  });",
    "}",
    "",
  ].join("\n");
}

/** 累计原生 usage；缺字段按 0 计，不臆造数值。 */
function accumulateUsage(target: NativeUsage, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  for (const key of Object.keys(target) as (keyof NativeUsage)[]) {
    const count = Number((usage as Record<string, unknown>)[key] ?? 0);
    if (Number.isFinite(count)) target[key] += count;
  }
}

/** 单条 assistant 消息：错误/截断显式抛出，文本、思考与 usage 入账。 */
function applyMessage(state: NativeState, message: unknown): null {
  const value = message as
    | {
        role?: string;
        stopReason?: string;
        errorMessage?: string;
        content?: { type?: string; text?: string; thinking?: string }[];
        usage?: unknown;
      }
    | undefined;
  if (value?.role !== "assistant") return null;
  state.steps += 1;
  if (value.stopReason === "error" || value.stopReason === "aborted") {
    throw new Error(
      "Pi provider " +
        value.stopReason +
        "：" +
        (value.errorMessage ?? "未知错误"),
    );
  }
  if (value.stopReason === "length") {
    throw new Error("Pi provider 输出被截断（stopReason=length）");
  }
  const content = Array.isArray(value.content) ? value.content : [];
  state.text = content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n");
  accumulateUsage(state.usage, value.usage);
  return null;
}

/** 解析 Pi 原生 JSONL：工具调用按 start/end 成对归一，agent_end 才是完成信号。 */
function createParser(
  state: NativeState,
): (line: unknown) => ParsedEvent | readonly ParsedEvent[] | null {
  const pending = new Map<string, { name: string; input: unknown }>();
  return (line): ParsedEvent | readonly ParsedEvent[] | null => {
    const event = line as
      | {
          type?: string;
          message?: unknown;
          toolCallId?: string;
          toolName?: string;
          args?: unknown;
          result?: unknown;
          isError?: boolean;
          aborted?: boolean;
        }
      | undefined;
    if (event?.type === "message_end")
      return applyMessage(state, event.message);
    if (event?.type === "tool_execution_start" && event.toolCallId) {
      pending.set(event.toolCallId, {
        name: String(event.toolName ?? ""),
        input: event.args ?? {},
      });
      return null;
    }
    if (event?.type === "tool_execution_end" && event.toolCallId) {
      if (!pending.has(event.toolCallId)) {
        throw new Error("Pi 原生工具调用缺少开始事件：" + event.toolCallId);
      }
      const call = pending.get(event.toolCallId)!;
      pending.delete(event.toolCallId);
      const toolCall: ToolCall = {
        name: call.name,
        input: call.input,
        output: event.result,
        status: event.isError ? "failed" : "completed",
      };
      return { type: "tool_call", payload: toolCall };
    }
    if (event?.type === "agent_end") {
      if (pending.size > 0) {
        throw new Error("Pi 原生工具调用缺少结束事件，证据不闭合");
      }
      state.completed = true;
      return [
        { type: "text", payload: { text: state.text } },
        { type: "result", payload: { steps: state.steps } },
      ];
    }
    // agent_settled 是原生收尾信号：aborted 表示守卫在预算上限处中断了会话。
    if (event?.type === "agent_settled") {
      if (event.aborted === true) state.budgetAborted = true;
      return null;
    }
    return null;
  };
}

/** 宿主配置与守卫文件由同一个 profile 持有，不再向工厂往返传递路径。 */
function createProfile(
  context: RecallProfileDriverContext,
  options: PiRecallDriverOptions,
  state: NativeState,
): HarnessProfile {
  let guardPath = "";
  return {
    name: "pi-recall",
    command: "pi",
    wire: context.target.channel.wire,
    baseUrlEnv: "",
    stripEnv: [],
    supportsFixture: false,
    toolName: (server, tool) => server + "_" + tool,
    sandbox: { configDirs: [PI_HOME_DIR] },
    configDirEnv: { env: "PI_CODING_AGENT_DIR", sandboxDir: PI_HOME_DIR },
    headlessArgs: (prompt) => [
      ...CLEAN_START_ARGS.filter(
        (flag) =>
          flag !== "--no-context-files" || options.contextFiles !== "project",
      ),
      ...(context.effects.tools === "none"
        ? ["--no-tools"]
        : ["--tools", READ_ONLY_TOOLS.join(",")]),
      ...(options.appendSystemPrompt === undefined
        ? []
        : ["--append-system-prompt", options.appendSystemPrompt]),
      "--extension",
      guardPath,
      "--",
      prompt,
    ],
    writeConfig: async (sandbox, config) => {
      await writePiLiveConfig(
        sandbox,
        {
          injectServer: false,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          live: config.live,
        },
        { executionParams: context.executionParams },
      );
      guardPath = join(sandbox.configDirs![PI_HOME_DIR]!, GUARD_FILE);
      await writeFile(
        guardPath,
        guardSource(sandbox.cwd, context.effects.maxSteps),
        "utf8",
      );
    },
    createParser: () => createParser(state),
  };
}

/** 只补齐 Harness 尚未从原生事件归一的完成状态、usage 与预算证据。 */
function wrapHarness(harness: HarnessDriver, state: NativeState): AgentDriver {
  let sent = false;
  return {
    redactor: harness.redactor,
    start: () => harness.start(),
    events: () => harness.events(),
    close: (reason) => harness.close(reason),
    sendPrompt: async (text) => {
      if (sent)
        throw new Error(
          "Pi Recall Driver 是一次性进程，本实例不能发送多轮 prompt",
        );
      sent = true;
      const observation = await harness.sendPrompt(text);
      if (!state.completed)
        throw new Error("Pi 原生完成信号缺失：未收到 agent_end");
      const usage = state.usage;
      return {
        ...observation,
        ...(usage.totalTokens > 0
          ? {
              usage: {
                promptTokens: usage.input + usage.cacheRead + usage.cacheWrite,
                completionTokens: usage.output,
                totalTokens: usage.totalTokens,
              },
            }
          : {}),
        ...(state.budgetAborted ? { exhausted: true } : {}),
        metadata: {
          ...observation.metadata,
          nativeCompleted: true,
          workspaceCwd: harness.sandbox.cwd,
          nativeUsage: { ...usage },
        },
      };
    },
  };
}

/**
 * 创建单轮 Pi Recall Driver；目标与权限来自已批准上下文，不自动注册任何 profile。
 * @param context Recall 的场景、backend、目标、effects 与 executionParams。
 * @param options 受信任的上下文发现、追加系统提示词与测试命令注入。
 * @returns start 创建隔离资源、close 幂等清理的一次性驱动。
 * @throws 多轮、命令执行或不支持的 executionParams 在执行前显式拒绝。
 */
export function createPiRecallDriver(
  context: RecallProfileDriverContext,
  options: PiRecallDriverOptions = {},
): AgentDriver {
  assertSupported(context, options);
  const state: NativeState = {
    text: "",
    steps: 0,
    completed: false,
    budgetAborted: false,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  };
  const harness = createHarnessDriver(
    createProfile(context, options, state),
    context.backend,
    {
      serverEntry: "",
      promptTimeoutMs: context.effects.timeoutMs,
      commandOverride: options.commandOverride,
      sandboxSetup: async (sandbox) => {
        await materializeRecallProvision(sandbox, context.spec.provision);
        // live 分支不套用 profile.stripEnv，必须在此剔除宿主凭据与会话变量。
        for (const key of Object.keys(sandbox.env)) {
          if (!SANDBOX_ENV_ALLOWLIST.has(key)) delete sandbox.env[key];
        }
      },
    },
  );
  return wrapHarness(harness, state);
}
