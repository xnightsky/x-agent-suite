/**
 * @module @x-agent-suite/harness/tests/harness-profiles
 * 五个消费者侧 HarnessProfile 测试夹具的 writeConfig 产物与 createParser 事件归一。
 * 不变量：解析只依赖宿主官方结构化输出形态，
 * 断言落在 ToolCall.status 上，不看退出码与末条文本。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createSandbox } from "@x-agent-suite/sandbox";
import { cleanupSandbox } from "@x-agent-suite/sandbox";
import type { ParsedEvent } from "@x-agent-suite/contracts";
import { buildMcpServerSpec } from "../src/mcp-config.ts";
import { claudeProfile } from "./fixtures/profiles/claude.ts";
import { codexProfile } from "./fixtures/profiles/codex.ts";
import { geminiProfile } from "./fixtures/profiles/gemini.ts";
import { kimiProfile } from "./fixtures/profiles/kimi.ts";
import { piProfile } from "./fixtures/profiles/pi.ts";

const SERVER = buildMcpServerSpec("/abs/mcp-stdio-entry.ts", {
  E2E_SESSION_MODE: "memory",
});
const BACKEND = { baseUrl: "http://127.0.0.1:4321", apiKey: "fake-api-key" };

function singleEvent(
  value: ParsedEvent | readonly ParsedEvent[] | null,
): ParsedEvent {
  assert.ok(value && !Array.isArray(value), "期望 parser 产出单个事件");
  return value as ParsedEvent;
}

test("codex writeConfig：config.toml 含 provider/mcp server/门槛项", async () => {
  const sandbox = await createSandbox({ configDirs: ["codexHome"] });
  try {
    await codexProfile.writeConfig(sandbox, {
      server: SERVER,
      serverName: "any_intercom",
      ...BACKEND,
    });
    const toml = await readFile(
      join(sandbox.configDirs!.codexHome!, "config.toml"),
      "utf8",
    );
    assert.match(toml, /model_provider = "fakeprov"/);
    assert.match(toml, /base_url = "http:\/\/127\.0\.0\.1:4321\/v1"/);
    assert.match(toml, /wire_api = "responses"/);
    assert.match(toml, /\[mcp_servers\.any_intercom\]/);
    assert.match(toml, /startup_timeout_sec = 30/);
    assert.match(toml, /required = true/);
    assert.match(toml, /mcp-stdio-entry\.ts/);
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("kimi writeConfig：config.toml 含 max_context_size（假绿防线）+ mcp.json", async () => {
  const sandbox = await createSandbox({ configDirs: ["kimiHome"] });
  try {
    await kimiProfile.writeConfig(sandbox, {
      server: SERVER,
      serverName: "any_intercom",
      ...BACKEND,
    });
    const toml = await readFile(
      join(sandbox.configDirs!.kimiHome!, "config.toml"),
      "utf8",
    );
    assert.match(toml, /max_context_size = \d+/);
    assert.match(toml, /base_url = "http:\/\/127\.0\.0\.1:4321\/v1"/);
    const mcp = JSON.parse(
      await readFile(join(sandbox.configDirs!.kimiHome!, "mcp.json"), "utf8"),
    );
    assert.equal(mcp.mcpServers.any_intercom.command, process.execPath);
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("pi writeConfig：models/settings 固定 fake provider 且隔离真实配置", async () => {
  const sandbox = await createSandbox({ configDirs: ["piHome"] });
  try {
    await piProfile.writeConfig(sandbox, {
      server: SERVER,
      serverName: "any_intercom",
      ...BACKEND,
    });
    const piHome = sandbox.configDirs!.piHome!;
    const models = JSON.parse(
      await readFile(join(piHome, "models.json"), "utf8"),
    );
    const settings = JSON.parse(
      await readFile(join(piHome, "settings.json"), "utf8"),
    );

    assert.equal(models.providers.xas.baseUrl, `${BACKEND.baseUrl}/v1`);
    assert.equal(models.providers.xas.api, "openai-completions");
    assert.equal(models.providers.xas.apiKey, BACKEND.apiKey);
    assert.equal(models.providers.xas.models[0].id, "fake");
    assert.equal(models.providers.xas.models[0].name, "XAS Harness");
    assert.equal(settings.defaultProvider, "xas");
    assert.equal(settings.defaultModel, "fake");
    assert.equal(settings.enableInstallTelemetry, false);
    assert.equal(settings.enableAnalytics, false);
    assert.deepEqual(settings.packages, ["npm:pi-mcp-adapter@2.29.0"]);
    const mcp = JSON.parse(await readFile(join(piHome, "mcp.json"), "utf8"));
    assert.equal(mcp.mcpServers.any_intercom.command, process.execPath);
    assert.equal(mcp.mcpServers.any_intercom.lifecycle, "eager");
    assert.equal(mcp.mcpServers.any_intercom.directTools, true);
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("pi PTY：声明真实入口、就绪标记与 trust 对话框处理", () => {
  assert.deepEqual(piProfile.ptyArgs?.({ cwd: "C:/sandbox" }), [
    "--no-session",
    "--no-context-files",
    "--no-skills",
  ]);
  assert.deepEqual(piProfile.win32, {
    globalPackage: "@earendil-works/pi-coding-agent",
    binPath: "dist/bundle/cli.js",
  });
  assert.match("0.0%/128k (auto) (xas) fake", piProfile.ptyReadyPattern!);
  assert.equal(piProfile.ptySetupSequence?.length, 1);
  assert.match("Trust project folder?", piProfile.ptySetupSequence![0]!.match);
  assert.equal(piProfile.ptySetupSequence![0]!.input, "\r");
});

test("pi parser：message_end 文本、tool_execution 配对与 agent_end 归一", () => {
  const parse = piProfile.createParser();
  assert.deepEqual(
    parse({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "DONE" }],
      },
    }),
    { type: "text", payload: { text: "DONE" } },
  );
  assert.equal(
    parse({
      type: "tool_execution_start",
      toolCallId: "p1",
      toolName: "reference_probe",
      args: { value: 1 },
    }),
    null,
  );
  assert.deepEqual(
    parse({
      type: "tool_execution_end",
      toolCallId: "p1",
      toolName: "reference_probe",
      result: { content: [{ type: "text", text: "pong" }] },
      isError: false,
    }),
    {
      type: "tool_call",
      payload: {
        name: "reference_probe",
        input: { value: 1 },
        output: { content: [{ type: "text", text: "pong" }] },
        status: "completed",
      },
    },
  );
  assert.deepEqual(parse({ type: "agent_end", messages: [] }), {
    type: "result",
    payload: { raw: { type: "agent_end", messages: [] } },
  });
});

test("claude writeConfig：独立 mcp-config.json（--mcp-config 路径）", async () => {
  const sandbox = await createSandbox({ configFile: true });
  try {
    await claudeProfile.writeConfig(sandbox, {
      server: SERVER,
      serverName: "any_intercom",
      ...BACKEND,
    });
    const mcp = JSON.parse(await readFile(sandbox.configFilePath!, "utf8"));
    assert.equal(mcp.mcpServers.any_intercom.command, process.execPath);
    assert.deepEqual(mcp.mcpServers.any_intercom.env, {
      E2E_SESSION_MODE: "memory",
    });
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("gemini writeConfig：user 级 settings.json 且 folderTrust 关闭", async () => {
  const sandbox = await createSandbox();
  try {
    await geminiProfile.writeConfig(sandbox, {
      server: SERVER,
      serverName: "any_intercom",
      ...BACKEND,
    });
    const settings = JSON.parse(
      await readFile(join(sandbox.homeDir, ".gemini", "settings.json"), "utf8"),
    );
    assert.equal(settings.security.folderTrust.enabled, false);
    assert.equal(settings.security.auth.selectedType, "gemini-api-key");
    assert.equal(settings.mcpServers.any_intercom.trust, true);
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("writeConfig：injectServer=false 保留模型配置但不注册 reference MCP", async () => {
  const codex = await createSandbox({ configDirs: ["codexHome"] });
  const kimi = await createSandbox({ configDirs: ["kimiHome"] });
  const claude = await createSandbox({ configFile: true });
  const gemini = await createSandbox();
  const pi = await createSandbox({ configDirs: ["piHome"] });
  try {
    const context = { ...BACKEND, injectServer: false } as const;
    await codexProfile.writeConfig(codex, context);
    await kimiProfile.writeConfig(kimi, context);
    await claudeProfile.writeConfig(claude, context);
    await geminiProfile.writeConfig(gemini, context);
    await piProfile.writeConfig(pi, context);

    const codexToml = await readFile(
      join(codex.configDirs!.codexHome!, "config.toml"),
      "utf8",
    );
    assert.match(codexToml, /model_provider = "fakeprov"/);
    assert.doesNotMatch(codexToml, /\[mcp_servers\./);
    assert.deepEqual(
      JSON.parse(
        await readFile(join(kimi.configDirs!.kimiHome!, "mcp.json"), "utf8"),
      ),
      { mcpServers: {} },
    );
    assert.deepEqual(
      JSON.parse(await readFile(claude.configFilePath!, "utf8")),
      { mcpServers: {} },
    );
    const geminiSettings = JSON.parse(
      await readFile(join(gemini.homeDir, ".gemini", "settings.json"), "utf8"),
    );
    assert.deepEqual(geminiSettings.mcpServers, {});
    const piHome = pi.configDirs!.piHome!;
    assert.deepEqual(
      JSON.parse(await readFile(join(piHome, "mcp.json"), "utf8")),
      { mcpServers: {} },
    );
    const piSettings = JSON.parse(
      await readFile(join(piHome, "settings.json"), "utf8"),
    );
    assert.equal(piSettings.packages, undefined);
  } finally {
    await Promise.all(
      [codex, kimi, claude, gemini, pi].map((sandbox) =>
        cleanupSandbox(sandbox),
      ),
    );
  }
});

test("codex parser：mcp_tool_call → tool_call，agent_message → text，turn.completed → result", () => {
  const parse = codexProfile.createParser();
  const tool = parse({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      server: "any_intercom",
      tool: "intercom",
      arguments: { handle: "A", action: "list" },
      result: { content: [{ type: "text", text: "[]" }] },
      status: "completed",
    },
  });
  assert.deepEqual(tool, {
    type: "tool_call",
    payload: {
      name: "intercom",
      input: { handle: "A", action: "list" },
      output: { content: [{ type: "text", text: "[]" }] },
      status: "completed",
    },
  });
  const failed = parse({
    type: "item.completed",
    item: { type: "mcp_tool_call", tool: "x", arguments: {}, status: "failed" },
  });
  assert.equal(singleEvent(failed).type, "tool_call");
  assert.equal(
    (singleEvent(failed).payload as { status: string }).status,
    "failed",
  );
  assert.deepEqual(
    parse({
      type: "item.completed",
      item: { type: "agent_message", text: "DONE" },
    }),
    {
      type: "text",
      payload: { text: "DONE" },
    },
  );
  assert.equal(
    singleEvent(parse({ type: "turn.completed", usage: {} })).type,
    "result",
  );
  assert.equal(parse({ type: "turn.started" }), null);
});

test("claude parser：tool_use 与 tool_result 按 id 配对，result 携带 is_error/num_turns", () => {
  const parse = claudeProfile.createParser();
  assert.deepEqual(
    parse({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "mcp__any_intercom__intercom",
            input: { handle: "A", action: "list" },
          },
        ],
      },
    }),
    null,
  );
  const call = parse({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "[]",
          is_error: false,
        },
      ],
    },
  });
  assert.deepEqual(call, {
    type: "tool_call",
    payload: {
      name: "mcp__any_intercom__intercom",
      input: { handle: "A", action: "list" },
      output: "[]",
      status: "completed",
    },
  });
  const result = parse({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "DONE",
    num_turns: 2,
  });
  assert.deepEqual(result, {
    type: "result",
    payload: { isError: false, text: "DONE", steps: 2 },
  });
});

test("claude parser：tool_result is_error → failed", () => {
  const parse = claudeProfile.createParser();
  parse({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "t1", name: "x", input: {} }],
    },
  });
  const call = parse({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "boom",
          is_error: true,
        },
      ],
    },
  });
  assert.equal(
    (singleEvent(call).payload as { status: string }).status,
    "failed",
  );
});

test("kimi parser：role tool 回喂配对；`Tool not found` 判 failed（假绿防线）", () => {
  const parse = kimiProfile.createParser();
  parse({
    role: "assistant",
    tool_calls: [
      {
        id: "c1",
        type: "function",
        function: {
          name: "mcp__any_intercom__intercom",
          arguments: '{"action":"send","to":"B"}',
        },
      },
    ],
  });
  const ok = parse({ role: "tool", tool_call_id: "c1", content: "pong" });
  assert.deepEqual(ok, {
    type: "tool_call",
    payload: {
      name: "mcp__any_intercom__intercom",
      input: { action: "send", to: "B" },
      output: "pong",
      status: "completed",
    },
  });

  parse({
    role: "assistant",
    tool_calls: [
      {
        id: "c2",
        type: "function",
        function: { name: "mcp__x__nope", arguments: "{}" },
      },
    ],
  });
  const bad = parse({
    role: "tool",
    tool_call_id: "c2",
    content: 'Tool "mcp__x__nope" not found',
  });
  assert.equal(
    (singleEvent(bad).payload as { status: string }).status,
    "failed",
  );
});

test("gemini parser：tool_use/tool_result 配对，status success → completed", () => {
  const parse = geminiProfile.createParser();
  parse({
    type: "tool_use",
    tool_name: "mcp_any_intercom_intercom",
    tool_id: "g1",
    parameters: { action: "list" },
  });
  const call = parse({
    type: "tool_result",
    tool_id: "g1",
    status: "success",
    output: "[]",
  });
  assert.deepEqual(call, {
    type: "tool_call",
    payload: {
      name: "mcp_any_intercom_intercom",
      input: { action: "list" },
      output: "[]",
      status: "completed",
    },
  });
  parse({ type: "tool_use", tool_name: "x", tool_id: "g2", parameters: {} });
  const failed = parse({
    type: "tool_result",
    tool_id: "g2",
    status: "error",
    output: "boom",
  });
  assert.equal(
    (singleEvent(failed).payload as { status: string }).status,
    "failed",
  );
});

test("gemini headlessArgs：fixture 强制 fake，live 不覆盖真实模型", () => {
  const fixtureArgs = geminiProfile.headlessArgs("hello", {
    allowedTools: [],
    mode: "fixture",
  });
  const liveArgs = geminiProfile.headlessArgs("hello", {
    allowedTools: [],
    mode: "live",
  });
  assert.deepEqual(fixtureArgs.slice(0, 4), ["-p", "hello", "-m", "fake"]);
  assert.equal(liveArgs.includes("fake"), false);
});

test("claude parser：同一 user 事件中的多个 tool_result 全部产出", () => {
  const parse = claudeProfile.createParser();
  parse({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "t1", name: "one", input: { value: 1 } },
        { type: "tool_use", id: "t2", name: "two", input: { value: 2 } },
      ],
    },
  });
  const events = parse({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "first",
          is_error: false,
        },
        {
          type: "tool_result",
          tool_use_id: "t2",
          content: "second",
          is_error: true,
        },
      ],
    },
  });
  assert.deepEqual(events, [
    {
      type: "tool_call",
      payload: {
        name: "one",
        input: { value: 1 },
        output: "first",
        status: "completed",
      },
    },
    {
      type: "tool_call",
      payload: {
        name: "two",
        input: { value: 2 },
        output: "second",
        status: "failed",
      },
    },
  ]);
});
