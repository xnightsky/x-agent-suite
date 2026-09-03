/**
 * @module scripts/tests/artifacts-package
 * 制品 package.json 与类型路径重写回归。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CORE_EXPORT_NAMES,
  createCorePackageManifest,
  createPtyPackageManifest,
  rewriteDeclarationSpecifiers,
} from "../artifacts-package.ts";

test("核心聚合包导出七个稳定子路径并外置 YAML/TSX 依赖", async () => {
  const manifest = createCorePackageManifest("0.1.0");
  const rootManifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { devDependencies: Record<string, string> };
  const fixtureManifest = JSON.parse(
    await readFile(
      new URL("../../packages/llm-fixture/package.json", import.meta.url),
      "utf8",
    ),
  ) as { dependencies: Record<string, string> };
  assert.equal(manifest.name, "x-agent-suite");
  assert.equal(manifest.version, "0.1.0");
  assert.deepEqual(
    Object.keys(manifest.exports),
    CORE_EXPORT_NAMES.map((name) => `./${name}`),
  );
  assert.deepEqual(manifest.dependencies, {
    tsx: "^4.21.0",
    yaml: "^2.9.0",
  });
  assert.equal(manifest.dependencies?.tsx, rootManifest.devDependencies.tsx);
  assert.equal(manifest.dependencies?.yaml, fixtureManifest.dependencies.yaml);
});

test("PTY 包独立声明原生依赖并与核心包 lockstep", () => {
  const manifest = createPtyPackageManifest("0.2.0");
  assert.equal(manifest.name, "@x-agent-suite/pty-driver");
  assert.equal(manifest.version, "0.2.0");
  assert.deepEqual(manifest.dependencies, {
    "@lydell/node-pty": "^1.1.0",
    "@xterm/headless": "^5.5.0",
  });
});

test("核心声明把 workspace 别名与 .ts 后缀改成制品内部声明路径", () => {
  const source = [
    'import type { AgentDriver } from "@x-agent-suite/contracts";',
    'export { JsonlProcess } from "./proc.ts";',
    'export type { HarnessLiveChannel } from "./types";',
  ].join("\n");
  const rewritten = rewriteDeclarationSpecifiers(
    source,
    "types/packages/driver/src/index.d.ts",
    "core",
  );
  assert.match(
    rewritten,
    /from "\.\.\/\.\.\/\.\.\/packaging\/entries\/contracts\.js"/,
  );
  assert.match(rewritten, /from "\.\/proc\.js"/);
  assert.match(rewritten, /from "\.\/types\.js"/);
  assert.doesNotMatch(rewritten, /@x-agent-suite\//);
  assert.doesNotMatch(rewritten, /\.ts"/);
});

test("PTY 声明保留完整 driver 类型入口但不保留 workspace 别名", () => {
  const source = 'import type { PtyProcess } from "@x-agent-suite/driver";';
  const rewritten = rewriteDeclarationSpecifiers(
    source,
    "types/packages/harness/src/pty-watcher.d.ts",
    "pty",
  );
  assert.match(rewritten, /from "\.\.\/\.\.\/driver\/src\/index\.js"/);
  assert.doesNotMatch(rewritten, /@x-agent-suite\//);
});
