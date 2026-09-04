/**
 * @module scripts/tests/artifacts-build
 * 核心与 PTY 制品暂存区完整性回归。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { smokeInstall } from "../artifacts-smoke.ts";

type IntegrityAssertion = (stage: string) => Promise<void>;

async function loadIntegrityAssertion(): Promise<IntegrityAssertion> {
  const module = await import("../artifacts-build.ts");
  const assertion = Reflect.get(module, "assertCorePackageIntegrity");
  assert.equal(
    typeof assertion,
    "function",
    "artifacts-build 必须导出 assertCorePackageIntegrity",
  );
  return assertion as IntegrityAssertion;
}

async function createStage(
  manifest: object,
  javascript: string,
  sourceMap: object,
): Promise<string> {
  const stage = await mkdtemp(join(tmpdir(), "xas-core-integrity-"));
  await mkdir(join(stage, "dist"));
  await Promise.all([
    writeFile(join(stage, "package.json"), JSON.stringify(manifest)),
    writeFile(join(stage, "dist", "llm-fixture.js"), javascript),
    writeFile(
      join(stage, "dist", "llm-fixture.js.map"),
      JSON.stringify(sourceMap),
    ),
  ]);
  return stage;
}

const oldYamlPath =
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js";
const oldTsxPath =
  "node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/esm/index.mjs";

test("拒绝缺少 YAML 依赖且内联 YAML 实现的旧式核心暂存区", async () => {
  const stage = await createStage(
    {
      name: "x-agent-suite",
      dependencies: { tsx: "^4.21.0" },
    },
    `// ${oldYamlPath}\nexport const bundled = true;`,
    { sources: [`../${oldYamlPath}`], sourcesContent: ["YAML source"] },
  );
  try {
    const assertion = await loadIntegrityAssertion();
    await assert.rejects(assertion(stage), /package\.json.*yaml/);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test("拒绝缺少 TSX 依赖且内联 TSX 实现的核心暂存区", async () => {
  const stage = await createStage(
    { name: "x-agent-suite", dependencies: { yaml: "^2.9.0" } },
    `// ${oldTsxPath}\nexport const bundled = true;`,
    { sources: [`../${oldTsxPath}`], sourcesContent: ["TSX source"] },
  );
  try {
    const assertion = await loadIntegrityAssertion();
    await assert.rejects(assertion(stage), /package\.json.*tsx/);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test("拒绝 JS 与 sourcemap 中的 YAML 实现路径", async () => {
  const assertion = await loadIntegrityAssertion();
  for (const [javascript, sourceMap] of [
    [`// ${oldYamlPath}`, { sources: ["fixture.ts"], sourcesContent: [""] }],
    ["export {};", { sources: [`../${oldYamlPath}`], sourcesContent: [""] }],
    ["export {};", { sources: ["fixture.ts"], sourcesContent: [oldYamlPath] }],
  ] as const) {
    const stage = await createStage(
      {
        name: "x-agent-suite",
        dependencies: { tsx: "^4.21.0", yaml: "^2.9.0" },
      },
      javascript,
      sourceMap,
    );
    try {
      await assert.rejects(
        assertion(stage),
        /dist[\\/]llm-fixture\.js(?:\.map)?.*yaml/,
      );
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
});

test("允许 YAML 裸导入且暂存区不携带 YAML 源码", async () => {
  const stage = await createStage(
    {
      name: "x-agent-suite",
      dependencies: { tsx: "^4.21.0", yaml: "^2.9.0" },
    },
    'import { parse } from "yaml"; export { parse };',
    {
      sources: ["fixture.ts"],
      sourcesContent: ['import { parse } from "yaml";'],
    },
  );
  try {
    const assertion = await loadIntegrityAssertion();
    await assertion(stage);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test("core consumer 独立安装，PTY consumer 刻意混装核心制品以验证跨制品协同", async () => {
  const manifests: Array<{ devDependencies: Record<string, string> }> = [];
  let coreSmoke = "";
  let ptySmoke = "";
  await smokeInstall(
    tmpdir(),
    process.cwd(),
    [
      { kind: "core", file: "core.tgz", sha256: "core" },
      { kind: "pty", file: "pty.tgz", sha256: "pty" },
    ],
    (command, args, cwd) => {
      const manifest = JSON.parse(
        readFileSync(join(cwd, "package.json"), "utf8"),
      ) as { name: string; devDependencies: Record<string, string> };
      if (command === "pnpm" && args[0] === "install") {
        manifests.push(manifest);
      }
      if (command === "node" && manifest.name.includes("core")) {
        coreSmoke = readFileSync(join(cwd, "smoke.mjs"), "utf8");
      }
      if (command === "node" && manifest.name.includes("pty")) {
        ptySmoke = readFileSync(join(cwd, "smoke.mjs"), "utf8");
      }
    },
  );
  assert.equal(manifests.length, 2);
  const [coreManifest, ptyManifest] = manifests;
  assert.ok(coreManifest);
  assert.ok(ptyManifest);
  assert.deepEqual(Object.keys(coreManifest.devDependencies).sort(), [
    "@types/node",
    "x-agent-suite",
  ]);
  assert.deepEqual(Object.keys(ptyManifest.devDependencies).sort(), [
    "@types/node",
    "@x-agent-suite/pty-driver",
    "x-agent-suite",
  ]);
  assert.match(coreSmoke, /buildMcpServerSpec/);
  assert.match(coreSmoke, /resolve\("tsx\/esm"\)/);
  assert.match(coreSmoke, /fileURLToPath/);
  // PTY 冒烟必须按行为断言跨制品 live 判定（liveEnv 被调用、渠道透传）。
  assert.match(ptySmoke, /new LiveBackend/);
  assert.match(ptySmoke, /startHarnessBackend/);
  assert.match(ptySmoke, /liveEnv/);
});

test("PTY 制品完整性：拒绝内联 LiveBackend 类实现的暂存区", async () => {
  const module = await import("../artifacts-build.ts");
  const assertion = Reflect.get(module, "assertPtyPackageIntegrity") as (
    stage: string,
  ) => Promise<void>;
  assert.equal(typeof assertion, "function");

  const dirty = await mkdtemp(join(tmpdir(), "xas-pty-integrity-dirty-"));
  await mkdir(join(dirty, "dist"));
  await writeFile(
    join(dirty, "dist", "index.js"),
    "class LiveBackend {}\nexport {};",
  );
  try {
    await assert.rejects(assertion(dirty), /内联了 LiveBackend/);
  } finally {
    await rm(dirty, { recursive: true, force: true });
  }

  const clean = await mkdtemp(join(tmpdir(), "xas-pty-integrity-clean-"));
  await mkdir(join(clean, "dist"));
  await writeFile(join(clean, "dist", "index.js"), "export {};\n");
  try {
    await assertion(clean);
  } finally {
    await rm(clean, { recursive: true, force: true });
  }
});
