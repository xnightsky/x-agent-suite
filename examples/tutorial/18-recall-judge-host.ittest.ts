/**
 * @module examples/tutorial/18-recall-judge-host
 * 真实 Pi headless JSONL + loopback fake provider；默认 skip，零 token。
 * 两个主 prompt 均为真实单轮进程，不声称验证 PTY 共享对话历史。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  args,
  readReports,
  workspace,
} from "../../packages/recall/tests/fixtures/recall-workspace.ts";
import { runOfficialCli } from "../../packages/recall/tests/fixtures/official-cli.ts";

const HARNESS_URL = new URL(
  "../../packages/harness/src/index.ts",
  import.meta.url,
).href;
const LLM_FIXTURE_URL = new URL(
  "../../packages/llm-fixture/src/index.ts",
  import.meta.url,
).href;
const PI_PROFILE_URL = new URL(
  "../../packages/harness/tests/fixtures/profiles/pi.ts",
  import.meta.url,
).href;

interface HostRequest {
  readonly body: {
    messages: {
      role: string;
      content: string | { type: string; text?: string }[];
    }[];
  };
}

interface HostProbe {
  readonly event: "sandbox" | "close" | "judge-text";
  readonly specId: string;
  readonly effects?: string;
  readonly tools?: string;
  readonly executionParams?: Record<string, unknown>;
  readonly cwd?: string;
  readonly homeDir?: string;
  readonly text?: string;
  readonly requests?: HostRequest[];
}

function textContent(
  content: string | { type: string; text?: string }[],
): string {
  return typeof content === "string"
    ? content
    : content.map((block) => block.text ?? "").join("");
}

function registrySource(): string {
  return [
    'import { appendFileSync } from "node:fs";',
    'import { mkdir, writeFile } from "node:fs/promises";',
    'import { join } from "node:path";',
    "import { createHarnessDriver } from " + JSON.stringify(HARNESS_URL) + ";",
    "import { FakeProviderBackend } from " +
      JSON.stringify(LLM_FIXTURE_URL) +
      ";",
    "import { piProfile } from " + JSON.stringify(PI_PROFILE_URL) + ";",
    "const mechanical = (name, pass) => ({",
    "  name, scope: 'session',",
    "  evaluate: () => ({ pass, score: pass ? 1 : 0, reason: pass ? name + ' 通过' : name + ' 未通过' }),",
    "});",
    "const profileFor = (effects) => ({",
    "  ...piProfile,",
    "  headlessArgs: (prompt) => [",
    "    '--mode', 'json', '--print', '--no-session', '--no-context-files',",
    "    '--no-skills', '--no-extensions', '--no-mcp', '--no-prompt-templates',",
    "    '--approve', '--offline',",
    "    ...(effects.tools === 'none' ? ['--no-tools'] : []),",
    "    '--', prompt,",
    "  ],",
    "  writeConfig: (sandbox, context) =>",
    "    piProfile.writeConfig(sandbox, { ...context, injectServer: false }),",
    "});",
    "export default {",
    "  criteria: [mechanical('mechanical-a', true), mechanical('mechanical-b', false)],",
    "  effectsProfiles: {},",
    "  profiles: {",
    "    'fixture-cli-0': {",
    "      carrier: 'fixture-carrier',",
    "      createDriver: (context) => {",
    "        const judge = context.spec.id === 'recall/judge';",
    "        const backend = new FakeProviderBackend({",
    "          wire: 'openai-chat',",
    "          script: judge",
    "            ? [{ text: JSON.stringify({ 'ai-a': { pass: true, reason: 'AI A 通过' }, 'ai-b': { pass: false, reason: 'AI B 未通过' } }) }]",
    "            : [{ whenText: '准备回答', text: '中间答案' }, { whenText: '给出结论', text: '最终答案' }],",
    "        });",
    "        const sandboxSetup = async (sandbox) => {",
    "          appendFileSync(process.env.XAS_RECALL_HOST_PROBE, JSON.stringify({",
    "            event: 'sandbox', specId: context.spec.id, effects: context.effects.attribution,",
    "            tools: context.effects.tools, executionParams: context.executionParams,",
    "            cwd: sandbox.cwd, homeDir: sandbox.homeDir,",
    "          }) + '\\n');",
    "          const projectConfigDir = join(sandbox.cwd, '.pi');",
    "          await mkdir(projectConfigDir, { recursive: true });",
    "          await writeFile(join(projectConfigDir, 'settings.json'), '{\"quietStartup\":false}\\n');",
    "        };",
    "        const driver = createHarnessDriver(profileFor(context.effects), backend, {",
    "          serverEntry: '', promptTimeoutMs: 30_000, sandboxSetup,",
    "        });",
    "        return {",
    "          redactor: driver.redactor,",
    "          start: () => driver.start(),",
    "          sendPrompt: async (text) => {",
    "            const observation = await driver.sendPrompt(text);",
    "            if (judge) {",
    "              appendFileSync(process.env.XAS_RECALL_HOST_PROBE, JSON.stringify({",
    "                event: 'judge-text', specId: context.spec.id, text: observation.text,",
    "              }) + '\\n');",
    "            }",
    "            return observation;",
    "          },",
    "          events: () => driver.events(),",
    "          close: async (reason) => {",
    "            const requests = backend.requests().map((request) => ({ body: request }));",
    "            await driver.close(reason);",
    "            appendFileSync(process.env.XAS_RECALL_HOST_PROBE, JSON.stringify({",
    "              event: 'close', specId: context.spec.id, requests,",
    "            }) + '\\n');",
    "          },",
    "        };",
    "      },",
    "    },",
    "  },",
    "};",
    "",
  ].join("\n");
}

test(
  "真实 Pi headless：两轮四细项、独立 Judge、权限隔离与现场清理",
  { skip: process.env.E2E_PI_RECALL !== "1", timeout: 90_000 },
  async (t) => {
    const ws = await workspace(t, { cliCarrier: true });
    await writeFile(ws.registryPath, registrySource());
    await writeFile(
      ws.recallPath,
      [
        "version: 1",
        "id: assertion-scoring",
        "cases:",
        "  - id: four-items",
        "    turns:",
        "      - send: 准备回答",
        "      - send: 给出结论",
        "    expect:",
        "      mechanical-a: {}",
        "      mechanical-b: {}",
        "      judge:",
        "        ai-a:",
        "          rubric: 判断是否满足甲标准",
        "          score: { hit: 3 }",
        "        ai-b:",
        "          rubric: 判断是否满足乙标准",
        "          score: { miss: 0 }",
        "",
      ].join("\n"),
    );
    const planPath = join(ws.cwd, "execution.yaml");
    await writeFile(planPath, "version: 1\neffects:\n  tools: read-only\n");
    const probePath = join(ws.cwd, "host-probe.jsonl");
    await writeFile(probePath, "");
    const outDir = join(ws.cwd, "reports");
    const executed = await runOfficialCli(
      args(ws, outDir, [
        "--plan",
        planPath,
        "--execution-params",
        JSON.stringify({ thinkingLevel: "off" }),
      ]),
      {
        homeDir: ws.cwd,
        env: { XAS_RECALL_HOST_PROBE: probePath },
      },
    );
    const probes = (await readFile(probePath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HostProbe);
    if (executed.code !== 0)
      t.diagnostic("host probes: " + JSON.stringify(probes));
    assert.equal(executed.code, 0, executed.stdout + executed.stderr);
    assert.match(executed.stdout, /FAIL assertion-scoring\/four-items/);

    const closes = probes.filter((item) => item.event === "close");
    assert.equal(closes.length, 2, "主执行与 Judge 均实际关闭");
    const mainClose = closes.find(
      (item) => item.specId === "assertion-scoring/four-items",
    )!;
    const judgeClose = closes.find((item) => item.specId === "recall/judge")!;
    assert.equal(mainClose.requests!.length, 2, "主会话两次单轮请求");
    assert.equal(judgeClose.requests!.length, 1, "Judge 一次批量请求");
    const judgeUsers = judgeClose.requests![0]!.body.messages.filter(
      (item) => item.role === "user",
    );
    assert.equal(judgeUsers.length, 1, "Judge 为独立单轮用户输入");
    const judgePrompt = textContent(judgeUsers[0]!.content);
    assert.match(judgePrompt, /最终答案/);
    assert.doesNotMatch(judgePrompt, /中间答案/);
    assert.doesNotMatch(judgePrompt, /hit:\s*3|miss:\s*0|score:\s*\{/);

    const [report] = await readReports(outDir);
    const result = report.rows[0].result;
    assert.equal(
      result.observation.text,
      "最终答案",
      "主输出取干净 JSONL 文本",
    );
    assert.equal(result.hardPass, false);
    assert.equal(result.artifact.rawScore, 3);
    assert.deepEqual(
      result.artifact.outcomes.map((item: { score: number }) => item.score),
      [1, 0, 1, 0],
    );
    assert.deepEqual(
      result.artifact.assertions.map((item: Record<string, unknown>) => ({
        name: item.name,
        source: item.source,
        pass: item.pass,
        score: item.score,
      })),
      [
        { name: "mechanical-a", source: "mechanical", pass: true, score: 1 },
        { name: "mechanical-b", source: "mechanical", pass: false, score: -1 },
        { name: "ai-a", source: "ai", pass: true, score: 3 },
        { name: "ai-b", source: "ai", pass: false, score: 0 },
      ],
    );

    const sandboxes = probes.filter((item) => item.event === "sandbox");
    assert.equal(sandboxes.length, 2, "主执行与 Judge 不共享 Driver/现场");
    const main = sandboxes.find(
      (item) => item.specId === "assertion-scoring/four-items",
    )!;
    const judge = sandboxes.find((item) => item.specId === "recall/judge")!;
    assert.equal(main.effects, "inline");
    assert.equal(main.tools, "read-only");
    assert.deepEqual(main.executionParams, { thinkingLevel: "off" });
    assert.equal(judge.effects, "none");
    assert.equal(judge.tools, "none");
    assert.deepEqual(judge.executionParams, {});
    for (const item of sandboxes) {
      assert.equal(existsSync(item.cwd!), false, "cwd 应在 close 后删除");
      assert.equal(existsSync(item.homeDir!), false, "HOME 应在 close 后删除");
    }
  },
);
