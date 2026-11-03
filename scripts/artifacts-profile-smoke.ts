/**
 * @module scripts/artifacts-profile-smoke
 * 已安装消费者配置投影冒烟；不变量：只使用合成原生配置，不启动宿主、不请求 provider。
 */

/** 生成安装后 Pi 投影断言，验证公开入口、默认继承与单次覆盖。 */
export function createProfileRuntimeSmoke(): string {
  return `const { writePiLiveConfig } = await import("@xnightsky/x-agent-suite/profiles/pi-config");
const { createSandbox, cleanupSandbox } = await import("@xnightsky/x-agent-suite/sandbox");
const profileSandbox = await createSandbox({ configDirs: ["piHome", "host"] });
try {
  const host = profileSandbox.configDirs.host;
  const output = profileSandbox.configDirs.piHome;
  const settings = { defaultThinkingLevel: "high", thinkingBudgets: { high: 12345 } };
  const model = { id: "native", api: "openai-responses", reasoning: true,
    contextWindow: 256000, maxTokens: 32000, compat: { supportsStore: false },
    thinkingLevelMap: { high: "deep" }, samplingParams: { temperature: 0.6 },
    samplingParamsByThinkingLevel: { high: { top_p: 0.9 } } };
  await writeFile(join(host, "settings.json"), JSON.stringify(settings));
  await writeFile(join(host, "models.json"), JSON.stringify({ providers: { native: { models: [model] } } }));
  const context = { injectServer: false, baseUrl: "https://offline.invalid/v1", apiKey: "synthetic",
    live: { provider: "native", model: "native", wire: "openai-responses" } };
  await writePiLiveConfig(profileSandbox, context, { agentDir: host });
  const isolated = JSON.parse(await readFile(join(output, "settings.json"), "utf8"));
  assert.equal(isolated.defaultThinkingLevel, "high");
  assert.equal(isolated.defaultProvider, "native");
  const projected = JSON.parse(await readFile(join(output, "models.json"), "utf8"));
  assert.deepEqual(projected.providers.native.models[0], model);
  await writePiLiveConfig(profileSandbox, context, { agentDir: host, executionParams: { thinkingLevel: "low" } });
  assert.equal(JSON.parse(await readFile(join(output, "settings.json"), "utf8")).defaultThinkingLevel, "low");
  assert.deepEqual(JSON.parse(await readFile(join(host, "settings.json"), "utf8")), settings);
  ${createPiRecallRuntimeSmoke()}
  console.log("Pi projection smoke: inherited high; explicit low; native model preserved; host unchanged");
} finally {
  await cleanupSandbox(profileSandbox);
}`;
}

/** 生成安装后多轮驱动冒烟，用 fake 宿主验证原生 session 恢复、逐轮证据与隔离配置。 */
function createPiRecallRuntimeSmoke(): string {
  return `const { createPiRecallDriver } = await import("@xnightsky/x-agent-suite/profiles/pi-recall");
  const { LiveBackend } = await import("@xnightsky/x-agent-suite/llm-fixture");
  const hostScript = join(profileSandbox.cwd, "fake-host.mjs");
  await writeFile(hostScript, [
    'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const argv = process.argv.slice(2); const prompt = argv.at(-1);',
    'const id = argv[argv.indexOf("--session-id") + 1];',
    'const dir = argv[argv.indexOf("--session-dir") + 1];',
    'const file = id && dir ? join(dir, id + ".jsonl") : null;',
    'const history = file && existsSync(file) ? readFileSync(file, "utf8").split("\\\\n").filter(Boolean).map(line => JSON.parse(line)) : [];',
    'const settings = JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), "utf8"));',
    'if (file) { mkdirSync(dir, { recursive: true }); writeFileSync(file, [...history, prompt].map(item => JSON.stringify(item)).join("\\\\n") + "\\\\n"); }',
    'const text = JSON.stringify({ settings, history });',
    'console.log(JSON.stringify({type:"message_end", message:{role:"assistant", stopReason:"stop", usage:{input:1,output:1,totalTokens:2}, content:[{type:"text",text}]}}));',
    'console.log(JSON.stringify({type:"agent_end"}));',
  ].join("\\n"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = host;
  const target = { carrier: "pi", channel: { ...context.live, baseUrl: context.baseUrl, apiKey: "synthetic" } };
  const firstPrompt = "offline smoke";
  const driver = createPiRecallDriver({
    spec: { id: "artifact-profile", turns: [{ send: firstPrompt }, { send: "resume smoke" }] },
    target, backend: new LiveBackend(target), cliRef: "pi", executionParams: {},
    effects: { kind: "none", attribution: "none", tools: "none", commands: { allow: [], deny: [] },
      maxSteps: 1, timeoutMs: 10000, workspace: "isolated", cleanup: "required" },
  }, { commandOverride: { command: process.execPath, argsPrefix: [hostScript] } });
  let workspace;
  try {
    await driver.start();
    const first = await driver.sendPrompt(firstPrompt);
    const second = await driver.sendPrompt("resume smoke");
    assert.deepEqual(JSON.parse(first.text).history, []);
    const resumed = JSON.parse(second.text);
    assert.deepEqual(resumed.history, [firstPrompt]);
    assert.equal(resumed.settings.defaultThinkingLevel, "high");
    assert.equal(first.metadata.nativeCompleted, true);
    assert.equal(second.metadata.nativeCompleted, true);
    assert.ok(first.usage.totalTokens > 0 && second.usage.totalTokens > 0);
    assert.equal(second.events.length, first.events.length);
    workspace = second.metadata.workspaceCwd;
  } finally {
    try { await driver.close(); } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  }
  await assert.rejects(access(workspace), { code: "ENOENT" });`;
}
