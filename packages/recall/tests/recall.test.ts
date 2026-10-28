/**
 * @module @x-agent-suite/recall/tests/recall
 * 新 Recall CLI/Runner：显式 target、独立 registry、effects Plan 与报告归因。
 */
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { parse, stringify } from "yaml";
import { main } from "../src/cli.ts";
import "./fixtures/recall.registry.ts";
import type { RecallRegistryTestState } from "./fixtures/recall.registry.ts";

const REGISTRY_FIXTURE_URL = new URL(
  "./fixtures/recall.registry.ts",
  import.meta.url,
).href;
const PASS_FILE = `version: 1
id: alpha
cases:
  - id: pass
    turns:
      - send: hello
        expect:
          text-contains: [hello]
`;
const PROVISION_FILE = `version: 1
id: alpha
plans:
  shared:
    resources:
      - source: input.txt
        destination: nested/input.txt
context:
  plan: shared
cases:
  - id: pass
    turns:
      - send: hello
        expect:
          text-contains: [hello]
`;

interface WorkspaceOptions {
  readonly targetCount?: number;
  readonly livePolicy?: "allowed" | "review-required";
  readonly provision?: boolean;
  readonly ephemeralClient?: boolean;
}

interface Workspace {
  readonly cwd: string;
  readonly livePath: string;
  readonly registryPath: string;
  readonly recallPath: string;
}

interface TestGlobal {
  __xasRecallRegistryTest?: RecallRegistryTestState;
}

function state(): RecallRegistryTestState {
  const value = (globalThis as TestGlobal).__xasRecallRegistryTest;
  assert.ok(value);
  return value;
}

function resetState(): void {
  state().transports = [];
  state().profiles = [];
}

async function workspace(
  t: TestContext,
  options: WorkspaceOptions = {},
): Promise<Workspace> {
  const cwd = await mkdtemp(join(tmpdir(), "xas-recall-cli-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".recall"));
  await writeFile(join(cwd, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(cwd, ".recall", "x-agent-suite.config.ts"),
    'throw new Error("obsolete config must not be imported");\n',
  );
  const registryPath = join(cwd, "registry.ts");
  await writeFile(
    registryPath,
    "export { default } from " + JSON.stringify(REGISTRY_FIXTURE_URL) + ";\n",
  );
  const recallPath = join(cwd, ".recall", "suite.yaml");
  await writeFile(recallPath, options.provision ? PROVISION_FILE : PASS_FILE);
  if (options.provision) await writeFile(join(cwd, "input.txt"), "read only");

  const targetCount = options.targetCount ?? 1;
  const providers =
    targetCount === 1
      ? { "fixture-provider": ["fixture-model-0"] }
      : {
          "fixture-provider": ["fixture-model-0"],
          "other-provider": ["fixture-model-1"],
        };
  const carrierProviders = Object.fromEntries(
    Object.entries(providers).map(([provider, models]) => [
      provider,
      {
        models,
        wire: "openai-chat",
        baseUrl: "https://fixture.invalid/v1",
        apiKey: "fixture-key",
      },
    ]),
  );
  const defaults = Object.entries(providers).flatMap(([provider, models]) =>
    models.map((model: string) => `${provider}/${model}`),
  );
  const livePath = join(cwd, "private-live.yaml");
  await writeFile(
    livePath,
    stringify({
      carriers: {
        "fixture-carrier": {
          providers: carrierProviders,
          default: defaults,
        },
        ...(options.ephemeralClient
          ? {
              "fixture-ephemeral": {
                kind: "ephemeral-client",
                clientRef: "fixture-client-0",
                channelsFrom: "fixture-carrier",
                default: "fixture-provider/fixture-model-0",
              },
            }
          : {}),
      },
      targetTags: {
        version: 1,
        cli: [
          {
            id: "fixture-cli-0",
            carrier: "fixture-carrier",
            wires: ["openai-chat"],
            tags: [
              "cli.execution.one-shot",
              "cli.execution.unattended",
              "cli.session.ephemeral",
              "cli.context.context-files.off",
              "cli.context.extensions.off",
              "cli.context.skills.off",
              "cli.tools.none",
              "cli.tools.allowlist",
              "cli.tools.read-only",
              "cli.io.text",
              "cli.io.jsonl",
            ],
          },
        ],
        providers: Object.keys(providers).map((id) => ({
          id,
          tags: [
            "provider.usage.api-payg",
            "provider.usage.cli-subscription",
            `provider.usage.live.${options.livePolicy ?? "allowed"}`,
          ],
        })),
        providerModels: Object.entries(providers).flatMap(
          ([provider, models]) =>
            models.map((model: string) => ({
              id: `${provider}/${model}`,
              providerRef: provider,
              model,
              modelRef: model,
              wire: "openai-chat",
              tags: ["provider-model.api.complete"],
            })),
        ),
        models: Object.values(providers)
          .flat()
          .map((model) => ({ id: model, tags: ["model.inference.chat"] })),
      },
    }),
  );
  resetState();
  return { cwd, livePath, registryPath, recallPath };
}

function args(
  ws: Workspace,
  outDir: string,
  extra: readonly string[] = [],
  includeCarrier = true,
): string[] {
  return [
    ...(includeCarrier ? ["--carrier", "fixture-carrier"] : []),
    "--live-config",
    ws.livePath,
    "--registry",
    ws.registryPath,
    "--out-dir",
    outDir,
    ...extra,
    ws.recallPath,
  ];
}

async function reportFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return reportFiles(path);
      return entry.name.endsWith("-report.json") ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

async function readReports(directory: string) {
  return Promise.all(
    (await reportFiles(directory)).map(async (path) =>
      JSON.parse(await readFile(path, "utf8")),
    ),
  );
}

test("无 target 参数与旧 --config 均在 Driver 前返回定义错误", async (t) => {
  const ws = await workspace(t);
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports"), [], false), { cwd: ws.cwd, homeDir: ws.cwd }),
    2,
  );
  assert.equal(
    await main(
      args(ws, join(ws.cwd, "reports"), [
        "--config",
        join(ws.cwd, ".recall", "x-agent-suite.config.ts"),
      ]),
      { cwd: ws.cwd, homeDir: ws.cwd },
    ),
    2,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles.length, 0);
});

test("direct 默认无 effects，复用单 Runner 并保留多轮与执行归因", async (t) => {
  const ws = await workspace(t);
  const outDir = join(ws.cwd, "reports");
  assert.equal(
    await main(args(ws, outDir, ["--repeat", "2"]), { cwd: ws.cwd, homeDir: ws.cwd }),
    0,
  );
  assert.equal(state().transports.length, 2);
  assert.equal(state().profiles.length, 0);
  const reports = await readReports(outDir);
  assert.equal(reports.length, 1);
  const metadata = reports[0].rows[0].result.observation.metadata;
  assert.deepEqual(metadata.recallExecution, {
    target: {
      carrier: "fixture-carrier",
      provider: "fixture-provider",
      model: "fixture-model-0",
    },
    mode: "direct",
    provision: "none",
    effects: "none",
  });
});

test("carrier 展开多个 default 并逐 target 出报告，provider 过滤不追加其他 default", async (t) => {
  const ws = await workspace(t, { targetCount: 2 });
  const allDir = join(ws.cwd, "reports-all");
  assert.equal(await main(args(ws, allDir), { cwd: ws.cwd, homeDir: ws.cwd }), 0);
  assert.equal(state().transports.length, 2);
  const allReports = await readReports(allDir);
  assert.equal(allReports.length, 2);
  assert.deepEqual(
    new Set(
      allReports.map(
        (report) =>
          report.rows[0].result.observation.metadata.recallExecution.target
            .model,
      ),
    ),
    new Set(["fixture-model-0", "fixture-model-1"]),
  );

  resetState();
  const filteredDir = join(ws.cwd, "reports-filtered");
  assert.equal(
    await main(args(ws, filteredDir, ["--provider", "other-provider"]), {
      cwd: ws.cwd,
    }),
    0,
  );
  assert.equal(state().transports.length, 1);
  assert.equal(state().transports[0]!.model, "fixture-model-1");
  assert.equal((await readReports(filteredDir)).length, 1);
});

test("场景 provision 无 Plan 拒绝，显式 effects:none 才经唯一 borrowed profile", async (t) => {
  const ws = await workspace(t, { provision: true });
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-denied")), { cwd: ws.cwd, homeDir: ws.cwd }),
    2,
  );
  assert.equal(state().profiles.length, 0);
  assert.equal(state().transports.length, 0);

  const planPath = join(ws.cwd, "execution.yaml");
  await writeFile(planPath, "version: 1\neffects: none\n");
  const outDir = join(ws.cwd, "reports-borrowed");
  assert.equal(
    await main(args(ws, outDir, ["--plan", planPath]), { cwd: ws.cwd, homeDir: ws.cwd }),
    0,
  );
  assert.equal(state().profiles.length, 1);
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles[0]!.effects, "none");
  const [report] = await readReports(outDir);
  const execution = report.rows[0].result.observation.metadata.recallExecution;
  assert.equal(execution.mode, "borrowed");
  assert.equal(execution.cliRef, "fixture-cli-0");
  assert.equal(execution.provision, "plan:shared");
  assert.equal(execution.effects, "none");
});

test("非 none inline effects 显式选择 borrowed，EffectsProfile 不归并不猜 mode", async (t) => {
  const ws = await workspace(t);
  const planPath = join(ws.cwd, "execution.yaml");
  await writeFile(
    planPath,
    `version: 1
effects:
  tools: read-only
  commands:
    allow: [read-file]
    deny: [read-file]
`,
  );
  const outDir = join(ws.cwd, "reports");
  assert.equal(
    await main(args(ws, outDir, ["--plan", planPath]), { cwd: ws.cwd, homeDir: ws.cwd }),
    0,
  );
  assert.equal(state().profiles.length, 1);
  assert.equal(state().profiles[0]!.effects, "inline");
  assert.equal(state().transports.length, 0);
  const [report] = await readReports(outDir);
  assert.equal(
    report.rows[0].result.observation.metadata.recallExecution.effects,
    "inline",
  );
});

test("live review-required 未审批拒绝，--approve-live 仅放行当前调用", async (t) => {
  const ws = await workspace(t, { livePolicy: "review-required" });
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-denied")), { cwd: ws.cwd, homeDir: ws.cwd }),
    2,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-approved"), ["--approve-live"]), {
      cwd: ws.cwd,
    }),
    0,
  );
  assert.equal(state().transports.length, 1);
});

test("borrowed 多 profile 未唯一时在 Driver 前拒绝且不 fallback", async (t) => {
  const ws = await workspace(t, { provision: true });
  const planPath = join(ws.cwd, "execution.yaml");
  await writeFile(planPath, "version: 1\neffects: none\n");
  const live = parse(await readFile(ws.livePath, "utf8"));
  live.targetTags.cli.push({
    ...live.targetTags.cli[0],
    id: "fixture-cli-1",
  });
  await writeFile(ws.livePath, stringify(live));
  await writeFile(
    ws.registryPath,
    `import base from ${JSON.stringify(REGISTRY_FIXTURE_URL)};
export default {
  ...base,
  profiles: {
    ...base.profiles,
    "fixture-cli-1": base.profiles["fixture-cli-0"],
  },
};
`,
  );
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports"), ["--plan", planPath]), {
      cwd: ws.cwd,
    }),
    2,
  );
  assert.equal(state().profiles.length, 0);
  assert.equal(state().transports.length, 0);
});

test("ephemeral-client 经 clientRef 使用自定义 direct Adapter 并保留渠道归因", async (t) => {
  const ws = await workspace(t, { ephemeralClient: true });
  const outDir = join(ws.cwd, "reports-ephemeral");
  assert.equal(
    await main(args(ws, outDir, ["--carrier", "fixture-ephemeral"], false), {
      cwd: ws.cwd,
    }),
    0,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles.length, 1);
  assert.equal(state().profiles[0]?.clientRef, "fixture-client-0");
  assert.equal(state().profiles[0]?.backendCarrier, "fixture-carrier");
  assert.equal(state().profiles[0]?.cliRef, undefined);

  const [report] = await readReports(outDir);
  const execution = report.rows[0].result.observation.metadata.recallExecution;
  assert.deepEqual(execution, {
    target: {
      carrier: "fixture-ephemeral",
      provider: "fixture-provider",
      model: "fixture-model-0",
    },
    kind: "ephemeral-client",
    mode: "direct",
    clientRef: "fixture-client-0",
    channelCarrier: "fixture-carrier",
    provision: "none",
    effects: "none",
  });
});

test("ephemeral-client 缺注册 Adapter 时在 Driver 前拒绝且不回退 direct", async (t) => {
  const ws = await workspace(t, { ephemeralClient: true });
  await writeFile(
    ws.registryPath,
    `import base from ${JSON.stringify(REGISTRY_FIXTURE_URL)};
export default {
  ...base,
  profiles: {
    "fixture-cli-0": base.profiles["fixture-cli-0"],
  },
};
`,
  );
  assert.equal(
    await main(
      args(ws, join(ws.cwd, "reports-denied"), ["--carrier", "fixture-ephemeral"], false),
      { cwd: ws.cwd, homeDir: ws.cwd },
    ),
    2,
  );
  assert.equal(state().profiles.length, 0);
  assert.equal(state().transports.length, 0);
});

test("ephemeral-client Adapter 接收场景 provision 与显式 effects Plan", async (t) => {
  const ws = await workspace(t, { ephemeralClient: true, provision: true });
  const planPath = join(ws.cwd, "execution.yaml");
  await writeFile(planPath, "version: 1\neffects: none\n");
  const outDir = join(ws.cwd, "reports-ephemeral-provision");
  assert.equal(
    await main(
      args(ws, outDir, ["--carrier", "fixture-ephemeral", "--plan", planPath], false),
      { cwd: ws.cwd, homeDir: ws.cwd },
    ),
    0,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles.length, 1);
  assert.notEqual(state().profiles[0]?.provision, undefined);
  const [report] = await readReports(outDir);
  const execution = report.rows[0].result.observation.metadata.recallExecution;
  assert.equal(execution.mode, "direct");
  assert.equal(execution.clientRef, "fixture-client-0");
  assert.equal(execution.provision, "plan:shared");
  assert.equal(execution.effects, "none");
});
