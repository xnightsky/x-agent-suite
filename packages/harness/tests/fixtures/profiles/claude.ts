/**
 * @module @x-agent-suite/harness/tests/fixtures/profiles/claude
 * Claude Code profile：wire anthropic-messages，隔离支点 --mcp-config + --strict-mcp-config。
 * 实测要点：无需改写 HOME；不要用 --dangerously-skip-permissions（root 下被拒）；-p 的 prompt 必须紧跟 -p。
 * parser 有状态：assistant 的 tool_use 先登记，user 的 tool_result 到达时按
 * tool_use_id 配对产出 ToolCall（status 由 is_error 映射）。
 */
import { writeJsonFile } from "../../../src/mcp-config";
import type { HarnessProfile, ParsedEvent } from "@x-agent-suite/contracts";
import type { HarnessLiveChannel } from "../../../src/types";

/** Claude 消息 content 块的最小结构。 */
interface ClaudeBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/** Claude Code 适配档案。 */
export const claudeProfile: HarnessProfile = {
  name: "claude",
  command: "claude",
  wire: "anthropic-messages",
  headlessArgs: (prompt, ctx) => {
    if (!ctx.configFilePath) {
      throw new Error("claudeProfile.headlessArgs: 缺少 configFilePath");
    }
    return [
      "--mcp-config",
      ctx.configFilePath,
      "--strict-mcp-config",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowedTools",
      ctx.allowedTools.join(","),
      "--permission-mode",
      "acceptEdits",
    ];
  },
  baseUrlEnv: "ANTHROPIC_BASE_URL",
  apiKeyEnv: "ANTHROPIC_AUTH_TOKEN",
  extraEnv: { ANTHROPIC_MODEL: "claude-sonnet-4-5" },
  stripEnv: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_HOME"],
  sandbox: { configFile: true },
  // live：沙箱 HOME 隔离使 CLI 读不到真实 ~/.claude/settings.json，
  // 借用的渠道须显式注入；baseUrl 用 harness 形态（CLI 自行拼 /v1/messages）。
  liveEnv: ({ channel, apiKey }) => {
    const live = channel as HarnessLiveChannel;
    return {
      ANTHROPIC_BASE_URL: live.harnessBaseUrl ?? live.baseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: live.model,
    };
  },
  toolName: (server, tool) => `mcp__${server}__${tool}`,
  supportsFixture: true,
  win32: {
    globalPackage: "@anthropic-ai/claude-code",
    binPath: "bin/claude.exe",
  },
  writeConfig: async (sandbox, ctx) => {
    if (!sandbox.configFilePath) {
      throw new Error(
        "claudeProfile.writeConfig: sandbox 未提供 configFilePath",
      );
    }
    const serverName = ctx.serverName ?? "any_intercom";
    await writeJsonFile(sandbox.configFilePath, {
      mcpServers:
        ctx.injectServer === false
          ? {}
          : {
              [serverName]: {
                command: ctx.server.command,
                args: [...ctx.server.args],
                env: ctx.server.env,
              },
            },
    });
  },
  createParser: () => {
    const pending = new Map<string, { name: string; input: unknown }>();
    return (line): ParsedEvent | readonly ParsedEvent[] | null => {
      const l = line as {
        type?: string;
        message?: { content?: ClaudeBlock[] };
        is_error?: boolean;
        result?: unknown;
        num_turns?: number;
      };
      if (l?.type === "assistant" && Array.isArray(l.message?.content)) {
        let textEvent: ParsedEvent | null = null;
        for (const block of l.message.content) {
          if (block.type === "tool_use" && block.id) {
            pending.set(block.id, {
              name: String(block.name),
              input: block.input,
            });
          } else if (block.type === "text" && block.text) {
            textEvent ??= { type: "text", payload: { text: block.text } };
          }
        }
        return textEvent;
      }
      if (l?.type === "user" && Array.isArray(l.message?.content)) {
        const events: ParsedEvent[] = [];
        for (const block of l.message.content) {
          if (
            block.type === "tool_result" &&
            block.tool_use_id &&
            pending.has(block.tool_use_id)
          ) {
            const call = pending.get(block.tool_use_id)!;
            pending.delete(block.tool_use_id);
            events.push({
              type: "tool_call",
              payload: {
                ...call,
                output: block.content,
                status: block.is_error ? "failed" : "completed",
              },
            });
          }
        }
        return events.length > 1 ? events : (events[0] ?? null);
      }
      if (l?.type === "result") {
        return {
          type: "result",
          payload: {
            isError: l.is_error === true,
            text: String(l.result ?? ""),
            steps: l.num_turns,
          },
        };
      }
      return null;
    };
  },
};
