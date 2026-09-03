/**
 * @module @x-agent-suite/harness/tests/fixtures/profiles/gemini
 * Gemini CLI profile：wire gemini-generate，隔离支点临时 HOME + ~/.gemini/settings.json。
 * 实测要点：
 * - folder trust 是硬门槛，settings.json 必须含 security.folderTrust.enabled=false，
 *   否则 MCP 子进程根本不会被 spawn；
 * - settings.json 必须写 user 级（~/.gemini/），项目级不被识别；
 * - base URL 必须 loopback（driver 的假端点已保证），代理变量由 sandbox 剥离。
 * - win32 入口：0.56.0 起 bin 指向 bundle/gemini.js（旧版 dist/index.js 已不存在，
 *   2026-08-23 实机核实）。
 * parser 有状态：tool_use 登记、tool_result 按 tool_id 配对，status success→completed。
 */
import { join } from "node:path";
import type { HarnessProfile, ParsedEvent } from "@x-agent-suite/contracts";
import { writeJsonFile } from "../../../src/mcp-config";
import type { HarnessLiveChannel } from "../../../src/types";

/** Gemini CLI 适配档案（参考实现；matrix 主力为 kimi/pi）。 */
export const geminiProfile: HarnessProfile = {
  name: "gemini",
  command: "gemini",
  wire: "gemini-generate",
  headlessArgs: (prompt, context) => [
    "-p",
    prompt,
    ...(context.mode === "fixture" ? ["-m", "fake"] : []),
    "--yolo",
    "-o",
    "stream-json",
  ],
  baseUrlEnv: "GOOGLE_GEMINI_BASE_URL",
  apiKeyEnv: "GEMINI_API_KEY",
  stripEnv: ["GEMINI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"],
  toolName: (server, tool) => `mcp_${server}_${tool}`,
  supportsFixture: true,
  win32: { globalPackage: "@google/gemini-cli", binPath: "bundle/gemini.js" },
  writeConfig: async (sandbox, ctx) => {
    const live = ctx.live as HarnessLiveChannel | undefined;
    const serverName = ctx.serverName ?? "any_intercom";
    await writeJsonFile(join(sandbox.homeDir, ".gemini", "settings.json"), {
      security: {
        folderTrust: { enabled: false },
        // 0.56.0 起 headless 必须显式选定认证方式，否则报 "Invalid auth method selected"。
        auth: { selectedType: "gemini-api-key" },
      },
      mcpServers:
        ctx.injectServer === false
          ? {}
          : {
              [serverName]: {
                command: ctx.server.command,
                args: [...ctx.server.args],
                env: ctx.server.env,
                trust: true,
              },
            },
    });
  },
  createParser: () => {
    const pending = new Map<string, { name: string; input: unknown }>();
    return (line): ParsedEvent | null => {
      const l = line as {
        type?: string;
        role?: string;
        content?: unknown;
        tool_name?: string;
        tool_id?: string;
        parameters?: unknown;
        status?: string;
        output?: unknown;
      };
      if (l?.type === "tool_use" && l.tool_id) {
        pending.set(l.tool_id, {
          name: String(l.tool_name),
          input: l.parameters,
        });
        return null;
      }
      if (l?.type === "tool_result" && l.tool_id && pending.has(l.tool_id)) {
        const call = pending.get(l.tool_id)!;
        pending.delete(l.tool_id);
        return {
          type: "tool_call",
          payload: {
            ...call,
            output: l.output,
            status: l.status === "success" ? "completed" : "failed",
          },
        };
      }
      if (
        l?.type === "message" &&
        l.role === "assistant" &&
        typeof l.content === "string" &&
        l.content
      ) {
        return { type: "text", payload: { text: l.content } };
      }
      if (l?.type === "result") {
        return { type: "result", payload: { raw: line } };
      }
      return null;
    };
  },
};
