/**
 * @module harness/tests/fixtures/pi-recall-fake
 * Pi Recall Driver 测试共享件：合成子进程、合成 live backend、隔离宿主环境与 driver 拉起。
 * 不变量：零真实网络、零 token、不读写真实宿主 HOME；每次 withDriver 独立沙箱与 env 快照。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentDriver,
  Observation,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import type { LiveBackend } from "@x-agent-suite/llm-fixture";
import type {
  RecallEffects,
  RecallProfileDriverContext,
} from "@x-agent-suite/recall";
import { createPiRecallDriver } from "../../../../profiles/pi-recall.ts";

/** 合成 Pi CLI：回传隔离证据，并按原生参数落盘/恢复用户消息；行为由 prompt 标记选择。 */
function fakeCli(root: string): string {
  return [
    "import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "",
    "const argv = process.argv.slice(2);",
    "const prompt = argv[argv.length - 1] ?? '';",
    "const guardIndex = argv.indexOf('--extension');",
    "const guard = guardIndex >= 0 ? readFileSync(argv[guardIndex + 1], 'utf8') : null;",
    "const agentDir = process.env.PI_CODING_AGENT_DIR ?? '';",
    "const probeFile = " + JSON.stringify(join(root, "probes.jsonl")) + ";",
    "const sessionIdIndex = argv.indexOf('--session-id');",
    "const sessionDirIndex = argv.indexOf('--session-dir');",
    "const sessionId = sessionIdIndex >= 0 ? argv[sessionIdIndex + 1] : null;",
    "const sessionDir = sessionDirIndex >= 0 ? argv[sessionDirIndex + 1] : null;",
    "const sessionFile = sessionId && sessionDir ? join(sessionDir, sessionId + '.jsonl') : null;",
    "const history = [];",
    "if (sessionFile && existsSync(sessionFile)) {",
    "  for (const line of readFileSync(sessionFile, 'utf8').split('\\n')) {",
    "    if (!line) continue;",
    "    const entry = JSON.parse(line);",
    "    if (entry.type === 'message' && entry.message?.role === 'user') history.push(entry.message.content[0].text);",
    "  }",
    "}",
    "function readJson(name) {",
    "  try { return JSON.parse(readFileSync(join(agentDir, name), 'utf8')); } catch { return null; }",
    "}",
    "let files = [];",
    "try { files = readdirSync(agentDir).sort(); } catch {}",
    "const probe = {",
    "  argv, cwd: process.cwd(), home: process.env.HOME ?? null, pid: process.pid,",
    "  secret: process.env.XAS_FAKE_SECRET ?? null,",
    "  hostMarker: process.env.PI_CODING_AGENT_SESSION_DIR ?? null,",
    "  guard, settings: readJson('settings.json'), models: readJson('models.json'), agentDirFiles: files,",
    "  sessionId, sessionDir, history,",
    "};",
    "appendFileSync(probeFile, JSON.stringify(probe) + '\\n');",
    "if (sessionFile) {",
    "  mkdirSync(sessionDir, { recursive: true });",
    "  const entries = history.map(text => ({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }] } }));",
    "  entries.push({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });",
    "  writeFileSync(sessionFile, entries.map(entry => JSON.stringify(entry)).join('\\n') + '\\n');",
    "}",
    "if (prompt.includes('__EVIDENCE__')) writeFileSync(join(process.cwd(), 'evidence.txt'), 'proof');",
    "function emit(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }",
    "const toolCallId = 'call-' + (history.length + 1);",
    "emit({ type: 'tool_execution_start', toolCallId, toolName: 'read', args: { path: 'CONTEXT.md' } });",
    "if (prompt.indexOf('__TOOL_START_ONLY__') >= 0) {",
    "  emit({ type: 'agent_end' });",
    "} else {",
    "  emit({ type: 'tool_execution_end', toolCallId, toolName: 'read', isError: prompt.includes('__TOOL_FAILED__'), result: { content: [{ type: 'text', text: 'context' }] } });",
    "  const stopReason = prompt.includes('__PROVIDER_ERROR__') ? 'error' : prompt.includes('__TRUNCATED__') ? 'length' : 'end';",
    "  const message = { role: 'assistant', stopReason, content: [{ type: 'thinking', thinking: 'plan' }, { type: 'text', text: JSON.stringify(probe) }] };",
    "  if (stopReason === 'error') message.errorMessage = 'synthetic provider failure';",
    "  if (!prompt.includes('__NO_USAGE__')) message.usage = { input: 11 + history.length, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 19 + history.length };",
    "  emit({ type: 'message_end', message });",
    "  if (!prompt.includes('__NO_AGENT_END__')) emit({ type: 'agent_end' });",
    "  if (prompt.includes('__BUDGET_ABORT__')) emit({ type: 'agent_settled', aborted: true });",
    "}",
    "if (prompt.includes('__HANG__')) setTimeout(() => {}, 60_000);",
  ].join("\n");
}

const NATIVE_MODEL = {
  id: "native-model",
  name: "Native Model",
  reasoning: true,
  contextWindow: 200_000,
  maxTokens: 8_000,
  input: ["text"],
};

/** 合成宿主 settings：含默认思考、思考预算与一条不应被投影的 packages。 */
export const HOST_SETTINGS = {
  defaultThinkingLevel: "high",
  thinkingBudgets: { high: 4096 },
  packages: ["npm:host-untrusted@0.0.0"],
  secret: "host-secret-value",
};

const HOST_MODELS = {
  providers: { native: { api: "openai-responses", models: [NATIVE_MODEL] } },
};

/** 合成子进程回传的探测结果。 */
export interface Probe {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly home: string | null;
  readonly secret: string | null;
  readonly hostMarker: string | null;
  readonly guard: string | null;
  readonly settings: Record<string, unknown> | null;
  readonly models: Record<string, unknown> | null;
  readonly agentDirFiles: readonly string[];
  readonly sessionId: string | null;
  readonly sessionDir: string | null;
  readonly history: readonly string[];
  readonly pid: number;
}

/** withDriver 的用例选项。 */
export interface Options {
  readonly tools?: RecallEffects["tools"];
  readonly commands?: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
  };
  readonly maxSteps?: number;
  readonly executionParams?: Readonly<Record<string, unknown>>;
  readonly hostSettings?: Record<string, unknown> | null;
  readonly appendSystemPrompt?: string;
  readonly turns?: readonly string[];
  readonly evidence?: Readonly<Record<string, string>>;
}

/** withDriver 交给用例的合成宿主信息。 */
export interface Setup {
  readonly hostDir: string;
  readonly probeFile: string;
}

/** 构造与 Recall 归一化结果等价的 effects；默认只读、单步。 */
function effects(options: Options = {}): RecallEffects {
  return {
    kind: "inline",
    attribution: "inline",
    tools: options.tools ?? "read-only",
    commands: options.commands ?? { allow: [], deny: [] },
    maxSteps: options.maxSteps ?? 1,
    timeoutMs: 20_000,
    workspace: "isolated",
    cleanup: "required",
  };
}

/** 合成 live backend：只提供 harness 消费的品牌字段，不发任何请求。 */
function fakeBackend(): LiveBackend {
  return {
    mode: "live",
    liveChannel: {
      wire: "openai-chat",
      model: "native-model",
      provider: "native",
      baseUrl: "https://offline.invalid/v1",
    },
    start: async () => ({
      baseUrl: "https://offline.invalid/v1",
      apiKey: "synthetic-key",
    }),
    stop: async () => {},
  } as unknown as LiveBackend;
}

/** 构造 Recall createDriver 上下文。 */
export function driverContext(
  options: Options = {},
): RecallProfileDriverContext {
  const spec: ScenarioSpec = {
    id: "pi-recall/fake",
    turns: (options.turns ?? ["hello"]).map((send) => ({ send })),
  };
  return {
    spec,
    backend: fakeBackend(),
    target: {
      carrier: "pi",
      channel: {
        wire: "openai-chat",
        baseUrl: "https://offline.invalid/v1",
        model: "native-model",
        provider: "native",
        apiKey: "synthetic-key",
      },
    },
    cliRef: "pi",
    effects: effects(options),
    executionParams: options.executionParams ?? {},
  };
}

/** 起合成宿主环境、拉起 driver，并在收尾时恢复宿主 env 与临时目录。 */
export async function withDriver<T>(
  options: Options,
  run: (driver: AgentDriver, setup: Setup) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "xas-pi-recall-"));
  const hostDir = join(root, "host");
  await mkdir(hostDir, { recursive: true });
  const hostSettings =
    options.hostSettings === undefined ? HOST_SETTINGS : options.hostSettings;
  if (hostSettings !== null) {
    await writeFile(
      join(hostDir, "settings.json"),
      JSON.stringify(hostSettings),
    );
  }
  await writeFile(join(hostDir, "models.json"), JSON.stringify(HOST_MODELS));
  const script = join(root, "fake-pi.mjs");
  await writeFile(script, fakeCli(root));

  const previous = {
    agentDir: process.env.PI_CODING_AGENT_DIR,
    sessionDir: process.env.PI_CODING_AGENT_SESSION_DIR,
    secret: process.env.XAS_FAKE_SECRET,
  };
  process.env.PI_CODING_AGENT_DIR = hostDir;
  process.env.PI_CODING_AGENT_SESSION_DIR = "/host/session-must-not-leak";
  process.env.XAS_FAKE_SECRET = "synthetic-secret-value";

  const driver = createPiRecallDriver(driverContext(options), {
    commandOverride: { command: process.execPath, argsPrefix: [script] },
    ...(options.appendSystemPrompt === undefined
      ? {}
      : { appendSystemPrompt: options.appendSystemPrompt }),
    ...(options.evidence ? { evidence: options.evidence } : {}),
  });
  try {
    await driver.start();
    return await run(driver, {
      hostDir,
      probeFile: join(root, "probes.jsonl"),
    });
  } finally {
    try {
      await driver.close("测试收尾");
    } finally {
      // 收尾错误必须冒泡让用例失败；现场（宿主 env 与临时目录）无论如何都要恢复。
      if (previous.agentDir === undefined)
        delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous.agentDir;
      if (previous.sessionDir === undefined)
        delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = previous.sessionDir;
      if (previous.secret === undefined) delete process.env.XAS_FAKE_SECRET;
      else process.env.XAS_FAKE_SECRET = previous.secret;
      await rm(root, { recursive: true, force: true });
    }
  }
}

/** 读取 fake CLI 每次进程启动写入的 sidecar probe，包括无法返回 Observation 的失败轮。 */
export async function readProbes(path: string): Promise<Probe[]> {
  const content = await readFile(path, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Probe);
}

/** 等待指定轮次的 sidecar probe 落盘，用于 close 取消活动进程的回归。 */
export async function waitForProbes(
  path: string,
  count: number,
): Promise<Probe[]> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const probes = await readProbes(path);
      if (probes.length >= count) return probes;
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("等待 fake Pi probe 超时");
}

/** 合成 CLI 把探测结果放进唯一 assistant 文本块，直接解析 Observation.text。 */
export function probeOf(observation: Observation): Probe {
  return JSON.parse(observation.text) as Probe;
}
