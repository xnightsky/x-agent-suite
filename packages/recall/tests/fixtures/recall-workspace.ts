/** Recall CLI 合成工作区；不变量：全部配置隔离，零真实网络。 */
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
import type { TestContext } from "node:test";
import { stringify } from "yaml";
import "./recall.registry.ts";
import type { RecallRegistryTestState } from "./recall.registry.ts";

const REGISTRY_FIXTURE_URL = new URL("./recall.registry.ts", import.meta.url)
  .href;
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
  readonly cliCarrier?: boolean;
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

/** 读取当前测试的调用记录。 */
export function state(): RecallRegistryTestState {
  const value = (globalThis as TestGlobal).__xasRecallRegistryTest;
  assert.ok(value);
  return value;
}

/** 清空多次运行间的合成记录。 */
export function resetState(): void {
  state().transports = [];
  state().profiles = [];
}

/** 创建隔离 Recall 配置，按测试目标注册 CLI 或临时 Client。 */
export async function workspace(
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
          ...(options.cliCarrier || options.provision
            ? { kind: "cli" }
            : { kind: "ephemeral-client", clientRef: "fixture-direct" }),
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

/** 构造带显式 target 的测试命令。 */
export function args(
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

/** 读取当前输出目录中的 JSON 报告。 */
export async function readReports(directory: string) {
  return Promise.all(
    (await reportFiles(directory)).map(async (path) =>
      JSON.parse(await readFile(path, "utf8")),
    ),
  );
}
