/**
 * @module @x-agent-suite/harness/tests/fixtures/profiles/pi
 * Pi CLI profile：wire openai-chat，隔离支点 PI_CODING_AGENT_DIR。
 * PTY 使用真实交互入口；models.json 把模型固定到 harness backend，避免读取真实登录态。
 */
import { join } from "node:path";
import type { HarnessProfile, ParsedEvent } from "@x-agent-suite/contracts";
import { writeJsonFile } from "../../../src/mcp-config";
import type { HarnessLiveChannel } from "../../../src/types";

const PROVIDER_ID = "xas";
const FIXTURE_MODEL_ID = "fake";
const DISPLAY_NAME = "XAS Harness";
const MCP_ADAPTER_PACKAGE = "npm:pi-mcp-adapter@2.29.0";

/** Pi models.json 支持的 API 名。 */
type PiModelApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

/** 把 harness wire 名映射为 Pi models.json API 名。 */
function piModelApi(wire: string): PiModelApi {
  switch (wire) {
    case "openai-chat":
      return "openai-completions";
    case "openai-responses":
      return "openai-responses";
    case "anthropic-messages":
      return "anthropic-messages";
    case "gemini-generate":
      return "google-generative-ai";
    default:
      throw new Error(
        `piProfile.writeConfig: 不支持 wire ${JSON.stringify(wire)}`,
      );
  }
}

/** 从 Pi assistant message 的内容块提取最终文本事件。 */
function parseAssistantText(
  message: unknown,
): ParsedEvent | readonly ParsedEvent[] | null {
  const value = message as {
    role?: string;
    content?: { type?: string; text?: string }[];
  };
  if (value?.role !== "assistant" || !Array.isArray(value.content)) {
    return null;
  }
  const events = value.content
    .filter(
      (block) =>
        block.type === "text" && typeof block.text === "string" && block.text,
    )
    .map((block) => ({ type: "text", payload: { text: block.text! } }));
  if (events.length === 0) return null;
  return events.length === 1 ? events[0]! : events;
}

/** Pi CLI 消费者侧适配档案。 */
export const piProfile: HarnessProfile = {
  name: "pi",
  command: "pi",
  wire: "openai-chat",
  headlessArgs: (prompt) => [
    "--mode",
    "json",
    "--no-session",
    "--no-context-files",
    "--no-skills",
    prompt,
  ],
  ptyArgs: () => ["--no-session", "--no-context-files", "--no-skills"],
  ptyReadyPattern: /\(xas\)/,
  ptyIdlePatterns: [/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].*/g],
  ptySetupSequence: [
    {
      match: /Trust project folder\?/,
      input: "\r",
      description: "选择 Trust 当前项目目录",
    },
  ],
  baseUrlEnv: "",
  extraEnv: { PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" },
  stripEnv: [
    "PI_CODING_AGENT_DIR",
    "PI_CODING_AGENT_SESSION_DIR",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_OAUTH_TOKEN",
    "OPENAI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "DEEPSEEK_API_KEY",
    "MOONSHOT_API_KEY",
    "KIMI_API_KEY",
    "OPENROUTER_API_KEY",
  ],
  toolName: (server, tool) => `${server}_${tool}`,
  supportsFixture: true,
  sandbox: { configDirs: ["piHome"] },
  configDirEnv: { env: "PI_CODING_AGENT_DIR", sandboxDir: "piHome" },
  win32: {
    globalPackage: "@earendil-works/pi-coding-agent",
    binPath: "dist/bundle/cli.js",
  },
  writeConfig: async (sandbox, ctx) => {
    const piHome = sandbox.configDirs?.piHome;
    if (!piHome) {
      throw new Error("piProfile.writeConfig: sandbox 未创建 piHome");
    }
    const live = ctx.live as HarnessLiveChannel | undefined;
    const modelId = live?.model ?? FIXTURE_MODEL_ID;
    const api = piModelApi(live?.wire ?? "openai-chat");
    const baseUrl = live
      ? (live.harnessBaseUrl ?? ctx.baseUrl)
      : `${ctx.baseUrl}/v1`;

    await writeJsonFile(join(piHome, "models.json"), {
      providers: {
        [PROVIDER_ID]: {
          baseUrl,
          api,
          apiKey: ctx.apiKey,
          models: [
            {
              id: modelId,
              name: DISPLAY_NAME,
              reasoning: false,
              input: ["text"],
              contextWindow: 128000,
              maxTokens: 8000,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    });
    await writeJsonFile(join(piHome, "settings.json"), {
      defaultProvider: PROVIDER_ID,
      defaultModel: modelId,
      defaultThinkingLevel: "off",
      enableInstallTelemetry: false,
      enableAnalytics: false,
      ...(ctx.injectServer === false
        ? {}
        : { packages: [MCP_ADAPTER_PACKAGE] }),
    });
    await writeJsonFile(join(piHome, "mcp.json"), {
      mcpServers:
        ctx.injectServer === false
          ? {}
          : {
              [ctx.serverName ?? "any_intercom"]: {
                command: ctx.server.command,
                args: [...ctx.server.args],
                env: ctx.server.env,
                lifecycle: "eager",
                directTools: true,
              },
            },
    });
  },
  createParser: () => {
    const pending = new Map<string, { name: string; input: unknown }>();
    return (line): ParsedEvent | readonly ParsedEvent[] | null => {
      const event = line as {
        type?: string;
        message?: unknown;
        toolCallId?: string;
        toolName?: string;
        args?: unknown;
        result?: unknown;
        isError?: boolean;
      };
      if (event?.type === "message_end") {
        return parseAssistantText(event.message);
      }
      if (event?.type === "tool_execution_start" && event.toolCallId) {
        pending.set(event.toolCallId, {
          name: String(event.toolName ?? ""),
          input: event.args ?? {},
        });
        return null;
      }
      if (event?.type === "tool_execution_end" && event.toolCallId) {
        const call = pending.get(event.toolCallId) ?? {
          name: String(event.toolName ?? ""),
          input: {},
        };
        pending.delete(event.toolCallId);
        return {
          type: "tool_call",
          payload: {
            ...call,
            output: event.result,
            status: event.isError ? "failed" : "completed",
          },
        };
      }
      if (event?.type === "agent_end") {
        return { type: "result", payload: { raw: line } };
      }
      return null;
    };
  },
};
