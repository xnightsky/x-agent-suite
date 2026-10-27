/**
 * @module @x-agent-suite/recall/tests/effects
 * 执行 Plan effects DSL、EffectsProfile 引用与命令门禁测试；零真实副作用。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  isRecallCommandAllowed,
  loadRecallEffectsPlan,
} from "../src/effects.ts";
import type { RecallRegistry } from "../src/registry.ts";

async function planFile(t: TestContext, source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-effects-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "execution.yaml");
  await writeFile(path, source);
  return path;
}

const registry: RecallRegistry = {
  criteria: [],
  profiles: {},
  effectsProfiles: {
    "safe-read": {
      tools: "read-only",
      commands: { allow: ["read-file"], deny: ["read-file"] },
    },
  },
};

test("无 Plan 与 effects:none 均无额外副作用，inline 应用安全缺省", async (t) => {
  const absent = await loadRecallEffectsPlan(undefined);
  assert.equal(absent.kind, "none");
  assert.equal(absent.attribution, "none");
  assert.equal(absent.tools, "none");
  assert.equal(absent.maxSteps, 1);
  assert.equal(absent.timeoutMs, 30_000);
  assert.equal(absent.workspace, "isolated");
  assert.equal(absent.cleanup, "required");
  assert.deepEqual(absent.commands, { allow: [], deny: [] });

  const path = await planFile(
    t,
    `version: 1
effects:
  commands:
    allow: [read-file]
    deny: [read-file]
`,
  );
  const inline = await loadRecallEffectsPlan(path);
  assert.equal(inline.kind, "inline");
  assert.equal(inline.attribution, "inline");
  assert.equal(inline.tools, "none");
  assert.equal(inline.maxSteps, 1);
  assert.equal(inline.timeoutMs, 30_000);
  assert.equal(isRecallCommandAllowed(inline, "read-file"), false);
  assert.equal(isRecallCommandAllowed(inline, "other"), false);
});

test("effects.use 只解析独立 registry 的 EffectsProfile，use 与 inline 互斥", async (t) => {
  const path = await planFile(
    t,
    `version: 1
effects:
  use: safe-read
`,
  );
  const selected = await loadRecallEffectsPlan(path, registry);
  assert.equal(selected.kind, "use");
  assert.equal(selected.attribution, "use:safe-read");
  assert.equal(selected.tools, "read-only");
  assert.equal(isRecallCommandAllowed(selected, "read-file"), false);

  const conflict = await planFile(
    t,
    `version: 1
effects:
  use: safe-read
  tools: none
`,
  );
  await assert.rejects(loadRecallEffectsPlan(conflict, registry), /互斥|use/);
  await assert.rejects(
    loadRecallEffectsPlan(
      await planFile(t, "version: 1\neffects:\n  use: missing\n"),
      registry,
    ),
    /未注册.*missing|missing.*未注册/,
  );
});

test("执行 Plan 不含 provision/plans，非法 effects 与权限形状 fail-closed", async (t) => {
  const invalid = [
    ["version: 1\nprovision: none\neffects: none\n", /provision|未知字段/],
    ["version: 1\nplans: {}\neffects: none\n", /plans|未知字段/],
    ["version: 1\neffects:\n  tools: shell\n", /tools/],
    ["version: 1\neffects:\n  maxSteps: 0\n", /maxSteps/],
    ["version: 1\neffects:\n  timeoutMs: 0\n", /timeoutMs/],
    ["version: 1\neffects:\n  workspace: shared\n", /workspace/],
    ["version: 1\neffects:\n  cleanup: optional\n", /cleanup/],
    ['version: 1\neffects:\n  commands:\n    allow: [""]\n', /commands|allow/],
  ] as const;
  for (const [source, expected] of invalid) {
    await assert.rejects(
      loadRecallEffectsPlan(await planFile(t, source)),
      expected,
    );
  }
});

test("commands 只做精确命令匹配，allow 放行、deny 优先且默认拒绝", async (t) => {
  const path = await planFile(
    t,
    `version: 1
effects:
  commands:
    allow: [read-file, "read-*"]
    deny: [read-file]
`,
  );
  const effects = await loadRecallEffectsPlan(path);
  assert.equal(isRecallCommandAllowed(effects, "read-file"), false);
  assert.equal(isRecallCommandAllowed(effects, "read-*"), true);
  assert.equal(isRecallCommandAllowed(effects, "read-anything"), false);
  assert.equal(isRecallCommandAllowed(effects, "unknown"), false);
});
