/**
 * @module @x-agent-suite/harness/tests/fixtures/profiles/codex
 * Codex CLI profile：wire openai-responses，隔离支点 CODEX_HOME + config.toml。
 * 实测要点：
 * wire_api 只支持 "responses"；默认审批会静默取消 MCP 调用，必须
 * --dangerously-bypass-approvals-and-sandbox；工具失败仍 exit 0，断言只认
 * item.completed 里 mcp_tool_call 的 status 字段。
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessProfile, ParsedEvent } from "@x-agent-suite/contracts";
import { tomlString } from "../../../src/mcp-config";
import type { HarnessLiveChannel } from "../../../src/types";

/** Codex profile 的 MCP server 配置段（TOML）。 */
function codexMcpToml(
  serverName: string,
  ctx: {
    command: string;
    args: readonly string[];
    env?: Record<string, string>;
  },
): string {
  const args = `[${ctx.args.map(tomlString).join(", ")}]`;
  const envLines = Object.entries(ctx.env ?? {})
    .map(([k, v]) => `${k} = ${tomlString(v)}`)
    .join("\n");
  return (
    `\n[mcp_servers.${serverName}]\ncommand = ${tomlString(ctx.command)}\nargs = ${args}\n` +
    // tsx 拉起 ts 入口在全量测试负载下可能超过 codex 默认 MCP 启动超时（实机抖动），放宽到 30s。
    `startup_timeout_sec = 30\n` +
    // required = true：codex exec 必须等该 server initialize + tools/list 完成才发首轮
    // 模型请求；否则首轮请求与 MCP 注册并发，fake provider 脚本下发的 tool_call 会被
    // codex 以 "unsupported call" 拒收且 exit 0 假绿。
    `required = true\n` +
    (envLines ? `\n[mcp_servers.${serverName}.env]\n${envLines}\n` : "")
  );
}

/** Codex CLI 适配档案。 */
export const codexProfile: HarnessProfile = {
  name: "codex",
  command: "codex",
  wire: "openai-responses",
  headlessArgs: (prompt) => [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    prompt,
  ],
  baseUrlEnv: "",
  apiKeyEnv: "FAKE_API_KEY",
  stripEnv: ["CODEX_HOME", "OPENAI_BASE_URL", "OPENAI_API_KEY"],
  toolName: (_server, tool) => tool,
  toolNamespace: (server) => `mcp__${server}`,
  supportsFixture: true,
  sandbox: { configDirs: ["codexHome"] },
  configDirEnv: { env: "CODEX_HOME", sandboxDir: "codexHome" },
  writeConfig: async (sandbox, ctx) => {
    const codexHome = sandbox.configDirs?.codexHome;
    if (!codexHome) {
      throw new Error("codexProfile.writeConfig: sandbox 未创建 codexHome");
    }
    const live = ctx.live as HarnessLiveChannel | undefined;
    const serverName = ctx.serverName ?? "any_intercom";
    // live：写借用的真实渠道（baseUrl 为借用原值，不二次拼 /v1）；fixture：假端点拼 /v1
    const providerKey = live ? "liveprov" : "fakeprov";
    const model = live ? live.model : "fake";
    const baseUrl = live
      ? (live.harnessBaseUrl ?? ctx.baseUrl)
      : `${ctx.baseUrl}/v1`;
    const wireApi = live
      ? live.wire === "openai-responses"
        ? "responses"
        : "chat"
      : "responses";
    const toml =
      `model = ${tomlString(model)}\nmodel_provider = ${tomlString(providerKey)}\n\n` +
      `[model_providers.${providerKey}]\nname = ${tomlString(live ? "live" : "fake")}\n` +
      `base_url = ${tomlString(baseUrl)}\n` +
      `env_key = "FAKE_API_KEY"\nwire_api = ${tomlString(wireApi)}\n` +
      (ctx.injectServer === false ? "" : codexMcpToml(serverName, ctx.server));
    await writeFile(join(codexHome, "config.toml"), toml, "utf8");
  },
  createParser:
    () =>
    (line): ParsedEvent | null => {
      const l = line as { type?: string; item?: Record<string, unknown> };
      if (l?.type === "item.completed" && l.item) {
        const item = l.item;
        if (item.type === "mcp_tool_call") {
          return {
            type: "tool_call",
            payload: {
              name: item.tool,
              input: item.arguments,
              output: item.result,
              status: item.status === "completed" ? "completed" : "failed",
            },
          };
        }
        if (item.type === "agent_message") {
          return { type: "text", payload: { text: String(item.text ?? "") } };
        }
      }
      if (l?.type === "turn.completed") {
        return { type: "result", payload: { raw: line } };
      }
      return null;
    },
};
