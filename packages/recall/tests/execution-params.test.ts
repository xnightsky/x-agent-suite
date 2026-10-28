/**
 * @module recall/tests/execution-params
 * 每次命令的执行参数与 API borrowed 门禁；全部合成配置，零 provider 请求。
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main } from "../src/cli.ts";

async function workspace(t: import("node:test").TestContext, kind = "cli") {
  const cwd = await mkdtemp(join(tmpdir(), "recall-params-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "package.json"), '{"type":"module"}');
  await writeFile(
    join(cwd, "recall.yaml"),
    JSON.stringify({
      version: 1,
      id: "params",
      cases: [{ id: "one", turns: [{ send: "hello" }] }],
    }),
  );
  await writeFile(
    join(cwd, "registry.mjs"),
    `
export default { profiles: { adapter: { carrier: "carrier", createDriver(context) {
  globalThis.__recallParams = context.executionParams;
  return { async start() {}, async sendPrompt() { return { text: "ok", toolCalls: [], toolCallsCount: 0, steps: 1, events: [] }; },
    async *events() {}, async close() {} };
} } } };`,
  );
  const live = {
    carriers: {
      carrier: {
        kind,
        ...(kind === "ephemeral-client" ? { clientRef: "adapter" } : {}),
        providers: {
          provider: {
            wire: "openai-chat",
            baseUrl: "https://never.invalid/v1",
            apiKey: "fake",
            models: ["model"],
          },
        },
        default: { provider: "provider", model: "model" },
      },
    },
    targetTags: {
      version: 1,
      providers: [
        {
          id: "provider",
          tags: ["provider.usage.api-credit", "provider.usage.live.allowed"],
        },
      ],
      models: [{ id: "model", tags: ["model.inference.chat"] }],
      providerModels: [
        {
          id: "pm",
          providerRef: "provider",
          model: "model",
          modelRef: "model",
          wire: "openai-chat",
          tags: ["provider-model.api.complete"],
        },
      ],
      cli: [
        {
          id: "adapter",
          carrier: "carrier",
          wires: ["openai-chat"],
          tags: [
            "cli.execution.one-shot",
            "cli.execution.unattended",
            "cli.session.ephemeral",
            "cli.context.context-files.off",
            "cli.context.extensions.off",
            "cli.context.skills.off",
            "cli.tools.none",
            "cli.io.jsonl",
          ],
        },
      ],
    },
  };
  const save = () => writeFile(join(cwd, "live.yaml"), JSON.stringify(live));
  await save();
  const argv = [
    "--carrier",
    "carrier",
    "--live-config",
    "live.yaml",
    "--registry",
    "registry.mjs",
    "--out-dir",
    "reports",
    "--execution-params",
    '{"thinkingLevel":"high"}',
    "recall.yaml",
  ];
  return { cwd, live, save, argv };
}

for (const kind of ["cli", "ephemeral-client"]) {
  test(kind + " 每次命令透传执行参数，不跨实现 fallback", async (t) => {
    const ws = await workspace(t, kind);
    assert.equal(await main(ws.argv, { cwd: ws.cwd, homeDir: ws.cwd }), 0);
    assert.deepEqual(Reflect.get(globalThis, "__recallParams"), {
      thinkingLevel: "high",
    });
  });
}

test("borrowed 接受 API 三种实际用量；unknown usage/live 与未审批仍拒绝", async (t) => {
  const ws = await workspace(t);
  for (const usage of ["api-payg", "api-credit", "api-free", "unknown"]) {
    ws.live.targetTags.providers[0]!.tags = [
      ...(usage === "unknown" ? [] : ["provider.usage." + usage]),
      "provider.usage.live.allowed",
    ];
    await ws.save();
    assert.equal(
      await main(ws.argv, { cwd: ws.cwd, homeDir: ws.cwd }),
      usage === "unknown" ? 2 : 0,
    );
  }
  for (const policy of ["unknown", "review-required"]) {
    ws.live.targetTags.providers[0]!.tags = [
      "provider.usage.api-credit",
      ...(policy === "unknown" ? [] : ["provider.usage.live." + policy]),
    ];
    await ws.save();
    assert.equal(await main(ws.argv, { cwd: ws.cwd, homeDir: ws.cwd }), 2);
    assert.equal(
      await main(["--approve-live", ...ws.argv], {
        cwd: ws.cwd,
        homeDir: ws.cwd,
      }),
      policy === "unknown" ? 2 : 0,
    );
    assert.equal(await main(ws.argv, { cwd: ws.cwd, homeDir: ws.cwd }), 2);
  }
});

test("执行参数必须是 JSON 对象；缺 Adapter 不得回退 direct", async (t) => {
  const ws = await workspace(t);
  for (const raw of ["[]", "null", "{bad", '"DO_NOT_ECHO"']) {
    const argv = [...ws.argv];
    argv[argv.indexOf("--execution-params") + 1] = raw;
    assert.equal(await main(argv, { cwd: ws.cwd, homeDir: ws.cwd }), 2);
  }
  await writeFile(join(ws.cwd, "registry.mjs"), "export default {};");
  assert.equal(await main(ws.argv, { cwd: ws.cwd, homeDir: ws.cwd }), 2);
});

test("cli 即使没有 effects/provision/参数也必须经过真实 CLI profile", async (t) => {
  const ws = await workspace(t);
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("NETWORK_FORBIDDEN");
  });
  const argv = ws.argv.filter(
    (value) =>
      value !== "--execution-params" && value !== '{"thinkingLevel":"high"}',
  );
  assert.equal(await main(argv, { cwd: ws.cwd, homeDir: ws.cwd }), 0);
  assert.deepEqual(Reflect.get(globalThis, "__recallParams"), {});
});

test("每次 repeat 使用独立参数副本，解析错误不回显原始输入", async (t) => {
  const ws = await workspace(t);
  const errors: string[] = [];
  t.mock.method(console, "error", (message: string) => errors.push(message));
  const invalid = [...ws.argv];
  invalid[invalid.indexOf("--execution-params") + 1] = "{DO_NOT_ECHO";
  assert.equal(await main(invalid, { cwd: ws.cwd, homeDir: ws.cwd }), 2);
  assert.doesNotMatch(errors.join("\n"), /DO_NOT_ECHO/);
  await writeFile(
    join(ws.cwd, "registry.mjs"),
    `
globalThis.__recallParamSnapshots = [];
export default { profiles: { adapter: { carrier: "carrier", createDriver({ executionParams }) {
  globalThis.__recallParamSnapshots.push(structuredClone(executionParams));
  executionParams.thinkingLevel = "changed";
  return { async start() {}, async sendPrompt() { return { text: "ok", toolCalls: [], toolCallsCount: 0, steps: 1, events: [] }; },
    async *events() {}, async close() {} };
} } } };`,
  );
  assert.equal(
    await main(["--repeat", "2", ...ws.argv], { cwd: ws.cwd, homeDir: ws.cwd }),
    0,
  );
  assert.deepEqual(Reflect.get(globalThis, "__recallParamSnapshots"), [
    { thinkingLevel: "high" },
    { thinkingLevel: "high" },
  ]);
});
