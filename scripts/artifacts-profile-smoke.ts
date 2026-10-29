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

/** 生成安装后一次性驱动冒烟，用假子进程验证 live 分支、原生完成信号及隔离配置。 */
function createPiRecallRuntimeSmoke(): string {
  return `const { createPiRecallDriver } = await import("@xnightsky/x-agent-suite/profiles/pi-recall");
  const { LiveBackend } = await import("@xnightsky/x-agent-suite/llm-fixture");
  const hostScript = join(profileSandbox.cwd, "fake-host.mjs");
  await writeFile(hostScript, [
    'import { readFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'const text = readFileSync(join(process.env.PI_CODING_AGENT_DIR, "settings.json"), "utf8");',
    'console.log(JSON.stringify({type:"message_end", message:{role:"assistant", stopReason:"stop", content:[{type:"text",text}]}}));',
    'console.log(JSON.stringify({type:"agent_end"}));',
  ].join("\\n"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = host;
  const target = { carrier: "pi", channel: { ...context.live, baseUrl: context.baseUrl, apiKey: "synthetic" } };
  const driver = createPiRecallDriver({
    spec: { id: "artifact-profile", turns: [{ send: "offline smoke" }] },
    target, backend: new LiveBackend(target), cliRef: "pi", executionParams: {},
    effects: { kind: "none", attribution: "none", tools: "none", commands: { allow: [], deny: [] },
      maxSteps: 1, timeoutMs: 10000, workspace: "isolated", cleanup: "required" },
  }, { commandOverride: { command: process.execPath, argsPrefix: [hostScript] } });
  let workspace;
  try {
    await driver.start();
    const observation = await driver.sendPrompt("offline smoke");
    assert.equal(JSON.parse(observation.text).defaultThinkingLevel, "high");
    assert.equal(observation.metadata.nativeCompleted, true);
    workspace = observation.metadata.workspaceCwd;
  } finally {
    try { await driver.close(); } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
  }
  await assert.rejects(access(workspace), { code: "ENOENT" });`;
}
