/** Recall plan/null/重复目标/YAML 错误隐私的 schema 级回归。 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { compileRecallFile } from "../src/compile.ts";
import { loadRecallEffectsPlan } from "../src/effects.ts";
import { loadRecallRegistry } from "../src/registry.ts";
import { parseRecallYaml } from "../src/schema.ts";

async function root(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "recall-schema-hardening-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function compileYaml(
  t: TestContext,
  yaml: string,
  setup?: (dir: string) => Promise<void>,
) {
  const dir = await root(t);
  await writeFile(join(dir, "suite.yaml"), yaml);
  await setup?.(dir);
  return compileRecallFile(join(dir, "suite.yaml"), {
    rootDir: dir,
    criteria: [],
  });
}

test("plan 使用无原型映射与 own lookup：原型链名称不注册，__proto__ 自有 plan 可用", async (t) => {
  const parsed = parseRecallYaml(
    `version: 1
id: parse-only
plans:
  "__proto__": { resources: [] }
cases: [{ id: c, turns: [{ send: x }] }]
`,
    "parse-only.yaml",
  );
  assert.equal(Object.getPrototypeOf(parsed.plans), null);

  const scenarios = await compileYaml(
    t,
    `version: 1
id: proto-plan
plans:
  "__proto__": { resources: [] }
context: { plan: "__proto__" }
cases: [{ id: c, turns: [{ send: x }] }]
`,
  );
  assert.equal((scenarios[0]!.provision as { plan: string }).plan, "__proto__");
  assert.deepEqual(
    (scenarios[0]!.provision as { resources: unknown[] }).resources,
    [],
  );

  for (const plan of ["constructor", "toString", "hasOwnProperty"]) {
    await assert.rejects(
      compileYaml(
        t,
        `version: 1
id: inherited-${plan}
plans:
  other: { resources: [] }
context: { plan: ${plan} }
cases: [{ id: c, turns: [{ send: x }] }]
`,
      ),
      /未注册|plan/i,
    );
  }
});

test("schema 显式 null 不落入缺省值", async (t) => {
  await assert.rejects(
    compileYaml(
      t,
      `version: 1
id: null-kind
plans:
  p:
    resources:
      - { source: input.txt, destination: out.txt, kind: null }
context: { plan: p }
cases: [{ id: c, turns: [{ send: x }] }]
`,
      async (dir) => writeFile(join(dir, "input.txt"), "x"),
    ),
    /kind|file|directory/,
  );

  const dir = await root(t);
  const planPath = join(dir, "effects.yaml");
  await writeFile(
    planPath,
    `version: 1
effects:
  tools: null
  maxSteps: null
  timeoutMs: null
  workspace: null
  cleanup: null
`,
  );
  await assert.rejects(
    loadRecallEffectsPlan(planPath),
    /tools|maxSteps|timeoutMs|workspace|cleanup/,
  );

  for (const field of ["criteria", "profiles", "effectsProfiles"]) {
    const registryPath = join(dir, `registry-${field}.ts`);
    await writeFile(
      registryPath,
      `export default { criteria: [], profiles: {}, effectsProfiles: {}, ${field}: null };\n`,
    );
    await assert.rejects(loadRecallRegistry(registryPath), new RegExp(field));
  }
});

test("context/resource 目标重复在编译期拒绝", async (t) => {
  await assert.rejects(
    compileYaml(
      t,
      `version: 1
id: duplicate-context
context: { files: [a.txt, ./a.txt] }
cases: [{ id: c, turns: [{ send: x }] }]
`,
      async (dir) => writeFile(join(dir, "a.txt"), "A"),
    ),
    /重复|冲突/,
  );

  await assert.rejects(
    compileYaml(
      t,
      `version: 1
id: duplicate-destinations
plans:
  p:
    resources:
      - { source: input.txt, destination: A.txt }
      - { source: input.txt, destination: a.txt }
context: { plan: p }
cases: [{ id: c, turns: [{ send: x }] }]
`,
      async (dir) => writeFile(join(dir, "input.txt"), "x"),
    ),
    /重复|冲突/,
  );
});

test("Recall YAML 解析错误只含固定类别、file/line/column，不回显源行", () => {
  const source = "version: [DO_NOT_ECHO_SOURCE\n";
  assert.throws(
    () => parseRecallYaml(source, "suite.yaml"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /YAML 解析失败/);
      assert.match(error.message, /suite\.yaml/);
      assert.match(error.message, /line\s+\d+/i);
      assert.match(error.message, /column\s+\d+/i);
      assert.doesNotMatch(error.message, /DO_NOT_ECHO_SOURCE/);
      return true;
    },
  );
});

test("Recall Plan YAML 解析错误同样不回显源行", async (t) => {
  const dir = await root(t);
  const planPath = join(dir, "plan.yaml");
  await writeFile(planPath, "version: 1\neffects: [DO_NOT_ECHO_PLAN_SOURCE\n");
  await assert.rejects(loadRecallEffectsPlan(planPath), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /YAML 解析失败/);
    assert.match(error.message, /plan\.yaml/);
    assert.match(error.message, /line\s+\d+/i);
    assert.match(error.message, /column\s+\d+/i);
    assert.doesNotMatch(error.message, /DO_NOT_ECHO_PLAN_SOURCE/);
    return true;
  });
});
