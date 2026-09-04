/**
 * @module scripts/artifacts-smoke
 * 在仓库外分别验证核心包与 PTY 包的独立安装、运行时导入和类型声明。
 *
 * 不变量：
 * - 核心 consumer 只声明核心制品，验证核心包可独立安装；
 * - PTY consumer 刻意同时声明核心制品：跨制品类身份协同（消费者侧 LiveBackend
 *   传入 PTY 制品的驱动路径）正是它要验证的场景——PTY 制品曾内联 LiveBackend
 *   导致 instanceof 恒 false、live 分支静默失效，此处按行为断言防回归。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CORE_EXPORT_NAMES } from "./artifacts-package.ts";
import type { ArtifactDescriptor } from "./artifacts-manifest.ts";

type CommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => void;

/** 分别运行核心包与 PTY 包的仓库外安装冒烟。 */
export async function smokeInstall(
  candidateDir: string,
  root: string,
  artifacts: readonly ArtifactDescriptor[],
  run: CommandRunner,
): Promise<void> {
  const core = artifacts.find((item) => item.kind === "core");
  const pty = artifacts.find((item) => item.kind === "pty");
  if (!core || !pty) {
    throw new Error("制品集缺少 core 或 PTY tarball");
  }
  await smokeConsumer(root, "xas-core-consumer-", run, (directory) =>
    writeCoreSmokeProject(directory, join(candidateDir, core.file)),
  );
  await smokeConsumer(root, "xas-pty-consumer-", run, (directory) =>
    writePtySmokeProject(
      directory,
      join(candidateDir, pty.file),
      join(candidateDir, core.file),
    ),
  );
}

async function smokeConsumer(
  root: string,
  prefix: string,
  run: CommandRunner,
  writeProject: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    await writeProject(directory);
    run("pnpm", ["install", "--ignore-scripts", "--prefer-offline"], directory);
    run("node", ["smoke.mjs"], directory);
    run("pnpm", ["exec", "tsc", "-p", join(directory, "tsconfig.json")], root);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeCoreSmokeProject(
  directory: string,
  coreTarball: string,
): Promise<void> {
  const dependencies = {
    "x-agent-suite": `file:${coreTarball}`,
    "@types/node": "^25.6.0",
  };
  const runtimeImports = CORE_EXPORT_NAMES.map(
    (name) => `import("x-agent-suite/${name}")`,
  );
  const typeImports = CORE_EXPORT_NAMES.map(
    (name, index) =>
      `type Core${index} = typeof import("x-agent-suite/${name}");`,
  );
  const tuple = CORE_EXPORT_NAMES.map((_, index) => `Core${index}`).join(", ");
  await writeSmokeFiles(
    directory,
    "x-agent-suite-core-artifact-smoke",
    dependencies,
    `${createCoreRuntimeSmoke(runtimeImports)}\n`,
    `${typeImports.join("\n")}\nexport type CoreSmoke = [${tuple}];\n`,
  );
}

async function writePtySmokeProject(
  directory: string,
  ptyTarball: string,
  coreTarball: string,
): Promise<void> {
  await writeSmokeFiles(
    directory,
    "x-agent-suite-pty-artifact-smoke",
    {
      "@x-agent-suite/pty-driver": `file:${ptyTarball}`,
      "x-agent-suite": `file:${coreTarball}`,
      "@types/node": "^25.6.0",
    },
    `${createPtyRuntimeSmoke()}\n`,
    'type PtySmoke = typeof import("@x-agent-suite/pty-driver");\nexport type { PtySmoke };\n',
  );
}

async function writeSmokeFiles(
  directory: string,
  name: string,
  devDependencies: Readonly<Record<string, string>>,
  runtimeSource: string,
  typeSource: string,
): Promise<void> {
  const packageJson = { name, private: true, type: "module", devDependencies };
  const tsconfig = createSmokeTsconfig();
  await Promise.all([
    writeFile(
      join(directory, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    ),
    writeFile(join(directory, "smoke.mjs"), runtimeSource),
    writeFile(join(directory, "smoke.ts"), typeSource),
    writeFile(
      join(directory, "tsconfig.json"),
      `${JSON.stringify(tsconfig, null, 2)}\n`,
    ),
  ]);
}

function createSmokeTsconfig(): object {
  return {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      types: ["node"],
    },
    include: ["smoke.ts"],
  };
}

function createCoreRuntimeSmoke(runtimeImports: readonly string[]): string {
  return `import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

await Promise.all([${runtimeImports.join(",")}]);
const harnessUrl = import.meta.resolve("x-agent-suite/harness");
const require = createRequire(harnessUrl);
const { buildMcpServerSpec } = await import(harnessUrl);
const serverEntry = fileURLToPath(new URL("./server.ts", import.meta.url));
const spec = buildMcpServerSpec(serverEntry);
assert.equal(spec.args[0], "--import");
assert.match(spec.args[1], /^file:/);
assert.equal(fileURLToPath(spec.args[1]), require.resolve("tsx/esm"));
assert.equal(spec.args[2], serverEntry);
const yamlEntry = require.resolve("yaml");
const yamlPackage = await findYamlPackage(dirname(yamlEntry));
assert.equal(yamlPackage.manifest.name, "yaml");
assert.match(yamlPackage.manifest.version, /^\\d+\\./);
await access(join(yamlPackage.directory, "LICENSE"));

async function findYamlPackage(start) {
  let directory = start;
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (manifest.name === "yaml") return { directory, manifest };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("无法定位 yaml package.json");
    directory = parent;
  }
}`;
}

/**
 * PTY 制品的运行时冒烟：导入之外，按行为断言跨制品 live 判定——
 * 消费者从核心制品 new LiveBackend，经 PTY 制品的 startHarnessBackend 后
 * live 分支必须真的生效（liveEnv 被调用、渠道透传）。
 */
function createPtyRuntimeSmoke(): string {
  return `import assert from "node:assert/strict";

const pty = await import("@x-agent-suite/pty-driver");
const { LiveBackend } = await import("x-agent-suite/llm-fixture");

// 跨制品身份场景：LiveBackend 实例来自核心制品，live 判定发生在 PTY 制品的 bundle 内。
const channel = {
  wire: "smoke-wire",
  baseUrl: "https://smoke.invalid/v1",
  model: "smoke-model",
  apiKey: "smoke-key",
};
const backend = new LiveBackend({ carrier: "smoke", channel });
assert.equal(backend.mode, "live");
assert.equal(backend.liveChannel, undefined);

const liveEnvCalls = [];
const started = await pty.startHarnessBackend(backend, {
  name: "smoke",
  liveEnv: (context) => {
    liveEnvCalls.push(context);
    return { SMOKE_LIVE: "1" };
  },
});
assert.equal(liveEnvCalls.length, 1, "PTY 制品内的 live 分支必须调用 profile.liveEnv");
assert.equal(liveEnvCalls[0].channel.baseUrl, channel.baseUrl);
assert.equal(liveEnvCalls[0].apiKey, "smoke-key");
assert.equal(started.env.SMOKE_LIVE, "1");
assert.equal(started.liveChannel?.baseUrl, channel.baseUrl);
await backend.stop();`;
}
