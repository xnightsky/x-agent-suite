/**
 * @module scripts/tests/itrepos-resources
 * 读取真实场景考卷，验证安装开关、项目安装位置与脚本资源现场。
 * 不变量：安装产物在临时目录准备，默认回归不安装宿主、不调用模型、不产生 token。
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import type { ScenarioSpec } from "@x-agent-suite/contracts";
import { cleanupSandbox, createSandbox } from "@x-agent-suite/sandbox";
import { compileRecallFile } from "../../packages/recall/src/compile.ts";
import { materializeRecallProvision } from "@x-agent-suite/recall";
import registry from "../../integrations/pi.registry.ts";

const CEDAR = resolve(import.meta.dirname, "../../integrations/itrepos/cedar");
const run = promisify(execFile);

async function compile(t: TestContext, skill: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "xas-itrepos-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(CEDAR, "AGENTS.md"), join(root, "AGENTS.md"));
  await cp(join(CEDAR, "fixtures"), join(root, "fixtures"), {
    recursive: true,
  });
  const installed = join(root, ".pi/skills", skill);
  await mkdir(installed, { recursive: true });
  await cp(join(CEDAR, "skills-def", skill), installed, { recursive: true });
  // 模拟安装器同时复制考卷的真实布局，沙箱中必须排除它。
  assert.equal((await stat(join(installed, ".recall.yaml"))).isFile(), true);
  return compileRecallFile(join(CEDAR, "skills-def", skill, ".recall.yaml"), {
    rootDir: root,
    criteria: registry.criteria,
  });
}

function scenario(scenarios: readonly ScenarioSpec[], id: string) {
  const found = scenarios.find((item) => item.id.endsWith("/" + id));
  assert.ok(found, "考卷缺少场景：" + id);
  return found;
}

async function materialize(t: TestContext, spec: ScenarioSpec) {
  const sandbox = await createSandbox();
  t.after(() => cleanupSandbox(sandbox));
  await materializeRecallProvision(sandbox, spec.provision);
  return sandbox;
}

test("Cedar 发布说明考卷用同一任务验证安装、禁用和替代项目位置", async (t) => {
  const scenarios = await compile(t, "change-summary");
  const enabled = scenario(scenarios, "matching-task");
  const disabled = scenario(scenarios, "not-installed");
  const alternate = scenario(scenarios, "matching-task-alternate-location");
  assert.equal(enabled.turns[0]!.send, disabled.turns[0]!.send);
  assert.equal(enabled.turns[0]!.send, alternate.turns[0]!.send);
  for (const [spec, location] of [
    [enabled, ".pi"],
    [disabled, undefined],
    [alternate, ".agents"],
  ] as const) {
    const sandbox = await materialize(t, spec);
    assert.match(
      await readFile(join(sandbox.cwd, "AGENTS.md"), "utf8"),
      /CEDAR_READY/,
    );
    for (const root of [".pi", ".agents"]) {
      const directory = join(sandbox.cwd, root, "skills/change-summary");
      if (root === location) {
        assert.match(
          await readFile(join(directory, "SKILL.md"), "utf8"),
          /CHANGE_SUMMARY_OK/,
        );
        assert.deepEqual(await readdir(directory), ["SKILL.md"]);
      } else await assert.rejects(stat(directory), { code: "ENOENT" });
    }
    assert.deepEqual(await readdir(sandbox.homeDir), []);
  }
});

test("Cedar 报告考卷禁用时保留输入，但不复制 Skill 或脚本", async (t) => {
  const scenarios = await compile(t, "change-report");
  const enabled = scenario(scenarios, "generate-report");
  const disabled = scenario(scenarios, "not-installed");
  assert.equal(enabled.turns[0]!.send, disabled.turns[0]!.send);
  const sandbox = await materialize(t, disabled);
  assert.equal(
    JSON.parse(
      await readFile(join(sandbox.cwd, "fixtures/changes.json"), "utf8"),
    ).changes.length,
    3,
  );
  await assert.rejects(stat(join(sandbox.cwd, ".pi/skills/change-report")), {
    code: "ENOENT",
  });
  await assert.rejects(stat(join(sandbox.cwd, "out/change-report.json")), {
    code: "ENOENT",
  });
});

test("Cedar 报告考卷的已安装脚本实际生成 JSON，非法输入不留产物", async (t) => {
  const scenarios = await compile(t, "change-report");
  const valid = scenario(scenarios, "generate-report");
  const invalid = scenario(scenarios, "invalid-input");
  for (const [spec, success] of [
    [valid, true],
    [invalid, false],
  ] as const) {
    const sandbox = await materialize(t, spec);
    const directory = join(sandbox.cwd, ".pi/skills/change-report");
    assert.deepEqual((await readdir(directory)).sort(), [
      "SKILL.md",
      "scripts",
    ]);
    const execute = () =>
      run(
        process.execPath,
        [
          ".pi/skills/change-report/scripts/build-report.mjs",
          "--input",
          "fixtures/changes.json",
          "--output",
          "out/change-report.json",
        ],
        { cwd: sandbox.cwd, env: { ...process.env, ...sandbox.env } },
      );
    const artifact = join(sandbox.cwd, "out/change-report.json");
    if (success) {
      await execute();
      assert.deepEqual(JSON.parse(await readFile(artifact, "utf8")), {
        total: 3,
        added: 2,
        fixed: 1,
      });
    } else {
      await assert.rejects(execute, (error: Error & { stderr?: string }) => {
        assert.match(error.stderr ?? "", /CHANGE_INPUT_INVALID/);
        return true;
      });
      await assert.rejects(stat(artifact), { code: "ENOENT" });
    }
  }
});
