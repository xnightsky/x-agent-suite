/**
 * @module @x-agent-suite/harness/tests/fixtures/profiles/kimi
 * Kimi CLI profile：wire openai-chat，隔离支点 KIMI_CODE_HOME（config.toml + mcp.json 分离）。
 * 实测要点：
 * - config.toml 的 model 条目必须配 max_context_size，否则 default model binding
 *   skipped、prompt 静默 end_turn（假绿形态）；
 * - 工具不存在的假绿形态是 role:"tool" 行 content 为 `Tool "<name>" not found`，
 *   parser 据此判 failed；
 * - -p 与 -y 互斥，headless 走 -p + stream-json。
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessProfile, ParsedEvent } from "@x-agent-suite/contracts";
import { tomlString, writeJsonFile } from "../../../src/mcp-config";
import {
  installKimiPlugins,
  type PluginInstallSpec,
} from "../../../src/plugin-install";
import type { HarnessLiveChannel } from "../../../src/types";

/** kimi stream-json 的 tool_calls 项最小结构。 */
interface KimiToolCallItem {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** kimi 假绿形态：工具不存在时 role:"tool" 的 content 为该形态。 */
const TOOL_NOT_FOUND = /^Tool ".*" not found/;

/** 解析 kimi tool_calls 的 arguments（JSON 字符串，解析失败保留原文）。 */
function parseArgs(raw: string | undefined): unknown {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Kimi CLI 适配档案。 */
export const kimiProfile: HarnessProfile = {
  name: "kimi",
  command: "kimi",
  wire: "openai-chat",
  headlessArgs: (prompt) => ["-p", prompt, "--output-format", "stream-json"],
  ptyArgs: (ctx) => {
    const args = ctx.addDir ? ["--add-dir", ctx.addDir] : [];
    args.push("--yolo"); // 自动批准所有工具调用（token 测试用）
    return args;
  },
  ptyCommand: process.platform === "win32" ? "kimi.cmd" : "kimi",
  ptyReadyPattern: /Welcome to Kimi Code!/,
  ptyPromptPattern: />\s*$/m,
  ptyIdlePatterns: [
    /[⠁⠂⠄⡀⢀⠠⠐⠈].*/, // braille spinner 帧
    /[\|\/\-\\]$/, // 简单 spinner
  ],
  ptySetupSequence: [
    // 首次在新项目启动时 Kimi 询问 Trust；默认选中 Don't trust，按 ↑ 移到 Trust 后回车。
    {
      match: /Trust this folder\?/,
      input: "\u001b[A\r",
      description: "选择 Trust this folder",
    },
  ],
  baseUrlEnv: "",
  stripEnv: ["KIMI_CODE_HOME", "KIMI_CODE_DATA_DIR"],
  toolName: (server, tool) => `mcp__${server}__${tool}`,
  supportsFixture: true,
  sandbox: { configDirs: ["kimiHome"] },
  configDirEnv: { env: "KIMI_CODE_HOME", sandboxDir: "kimiHome" },
  win32: { globalPackage: "@moonshot-ai/kimi-code", binPath: "dist/main.mjs" },
  installPlugins: async (sandbox, plugins) => {
    const kimiHome = sandbox.configDirs?.kimiHome;
    if (!kimiHome) {
      throw new Error("kimiProfile.installPlugins: sandbox 未创建 kimiHome");
    }
    await installKimiPlugins(kimiHome, plugins as readonly PluginInstallSpec[]);
  },
  writeConfig: async (sandbox, ctx) => {
    const kimiHome = sandbox.configDirs?.kimiHome;
    if (!kimiHome) {
      throw new Error("kimiProfile.writeConfig: sandbox 未创建 kimiHome");
    }
    const live = ctx.live as HarnessLiveChannel | undefined;
    const serverName = ctx.serverName ?? "any_intercom";
    // live：写借用的真实渠道（baseUrl 已是 CLI 期望形态，不二次拼 /v1）；fixture：假端点拼 /v1
    const providerKey = live ? "live" : "fakeprov";
    const modelId = live ? `live/${live.model}` : "fake/fake-model";
    const modelName = live ? live.model : "fake-model";
    const baseUrl = live
      ? (live.harnessBaseUrl ?? ctx.baseUrl)
      : `${ctx.baseUrl}/v1`;

    // live + credential:harness 特殊处理：Kimi provider type="kimi" + oauth 子表，不走 api_key
    const isKimiOAuth =
      live?.credential === "harness" && live?.wire === "openai-chat";
    let toml =
      `default_model = ${tomlString(modelId)}\n\n` +
      `[providers.${providerKey}]\ntype = ${tomlString(isKimiOAuth ? "kimi" : "openai")}\n` +
      `base_url = ${tomlString(baseUrl)}\n`;
    if (isKimiOAuth) {
      // OAuth 路径：写 oauth 子表，api_key 留空（CLI 自行从 credentials/kimi-code.json 读取）
      toml += `api_key = ""\n[providers.${providerKey}.oauth]\nstorage = "file"\nkey = "oauth/kimi-code"\n\n`;
    } else {
      toml += `api_key = ${tomlString(ctx.apiKey)}\n\n`;
    }
    toml +=
      `[models.${tomlString(modelId)}]\nprovider = ${tomlString(providerKey)}\nmodel = ${tomlString(modelName)}\n` +
      `max_context_size = 128000\nmax_output_size = 8000\n` +
      `capabilities = ["tool_use"]\ndisplay_name = ${tomlString(live ? "Live" : "Fake")}\n`;
    await writeFile(join(kimiHome, "config.toml"), toml, "utf8");
    await writeJsonFile(join(kimiHome, "mcp.json"), {
      mcpServers:
        ctx.injectServer === false
          ? {}
          : {
              [serverName]: {
                command: ctx.server.command,
                args: [...ctx.server.args],
                env: ctx.server.env,
                startupTimeoutMs: 30000,
              },
            },
    });
  },
  createParser: () => {
    const pending = new Map<string, { name: string; input: unknown }>();
    return (line): ParsedEvent | null => {
      const l = line as {
        role?: string;
        content?: unknown;
        tool_calls?: KimiToolCallItem[];
        tool_call_id?: string;
      };
      if (l?.role === "assistant") {
        for (const call of l.tool_calls ?? []) {
          if (call.id && call.function?.name) {
            pending.set(call.id, {
              name: call.function.name,
              input: parseArgs(call.function.arguments),
            });
          }
        }
        return typeof l.content === "string" && l.content
          ? { type: "text", payload: { text: l.content } }
          : null;
      }
      if (l?.role === "tool" && l.tool_call_id && pending.has(l.tool_call_id)) {
        const call = pending.get(l.tool_call_id)!;
        pending.delete(l.tool_call_id);
        const content = String(l.content ?? "");
        return {
          type: "tool_call",
          payload: {
            ...call,
            output: content,
            status: TOOL_NOT_FOUND.test(content) ? "failed" : "completed",
          },
        };
      }
      return null;
    };
  },
};
