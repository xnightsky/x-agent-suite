/**
 * @module scripts/artifacts-profile-smoke
 * 已安装消费者配置投影冒烟；不变量：只使用合成原生配置，不启动宿主、不请求 provider。
 */

/** 生成安装后 Pi 投影断言，验证公开入口、默认继承与单次覆盖。 */
export function createProfileRuntimeSmoke(): string {
  return `const { writePiLiveConfig } = await import("x-agent-suite/profiles/pi-config");
const { createSandbox, cleanupSandbox } = await import("x-agent-suite/sandbox");
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
  console.log("Pi projection smoke: inherited high; explicit low; native model preserved; host unchanged");
} finally {
  await cleanupSandbox(profileSandbox);
}`;
}
