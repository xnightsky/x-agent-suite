/**
 * @module @x-agent-suite/recall/tests/recall
 * 原生 .recall 端到端：全量前置校验、case/repeat 隔离、退出码和报告。
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
import test from "node:test";
import { loadRecall } from "../src/load.ts";
import { main } from "../src/cli.ts";
import { main as unifiedMain } from "../../../packaging/cli.ts";
import type { RecallTestState } from "./fixtures/recall.config.ts";

const CONFIG_FIXTURE_URL = new URL(
  "./fixtures/recall.config.ts",
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

interface TestGlobal {
  __xasRecallTest?: RecallTestState;
}

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "xas-recall-run-"));
  await writeFile(join(cwd, "package.json"), '{"type":"module"}\n');
  await mkdir(join(cwd, ".recall"));
  await writeFile(
    join(cwd, ".recall", "x-agent-suite.config.ts"),
    "export { default } from " + JSON.stringify(CONFIG_FIXTURE_URL) + ";\n",
  );
  (globalThis as TestGlobal).__xasRecallTest = {
    created: [],
    closed: [],
    drivers: [],
  };
  return cwd;
}

function state(): RecallTestState {
  const value = (globalThis as TestGlobal).__xasRecallTest;
  assert.ok(value);
  return value;
}

async function withOutDir<T>(run: () => Promise<T>): Promise<T> {
  const outDir = await mkdtemp(join(tmpdir(), "xas-recall-reports-"));
  const previous = process.env.XAS_RECALL_TEST_OUT_DIR;
  process.env.XAS_RECALL_TEST_OUT_DIR = outDir;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.XAS_RECALL_TEST_OUT_DIR;
    else process.env.XAS_RECALL_TEST_OUT_DIR = previous;
    await rm(outDir, { recursive: true, force: true });
  }
}

test("自动发现多份考卷；多 case × repeat 每次独立创建并关闭 driver", async () => {
  const cwd = await workspace();
  await writeFile(join(cwd, ".recall", "a.yaml"), PASS_FILE);
  await writeFile(
    join(cwd, ".recall", "b.yaml"),
    PASS_FILE.replace("alpha", "beta").replace("pass", "second"),
  );
  try {
    await withOutDir(async () => {
      assert.equal(await main([], { cwd }), 0);
      assert.deepEqual(state().created, [
        "alpha/pass",
        "alpha/pass",
        "beta/second",
        "beta/second",
      ]);
      assert.equal(new Set(state().drivers).size, 4);
      assert.equal(state().closed.length, 4);
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("CLI 显式 config + 单 YAML，生成含来源、case、carrier 与 model 的 md/json 报告", async () => {
  const cwd = await workspace();
  const configPath = join(cwd, ".recall", "x-agent-suite.config.ts");
  const recallPath = join(cwd, ".recall", "one.yaml");
  await writeFile(recallPath, PASS_FILE);
  const outDir = await mkdtemp(join(tmpdir(), "xas-recall-explicit-reports-"));
  const previous = process.env.XAS_RECALL_TEST_OUT_DIR;
  process.env.XAS_RECALL_TEST_OUT_DIR = outDir;
  try {
    assert.equal(
      await unifiedMain(["recall", "--config", configPath, recallPath], {
        cwd,
      }),
      0,
    );
    const files = await readdir(outDir);
    assert.equal(files.filter((file) => file.endsWith("-report.md")).length, 1);
    const jsonName = files.find((file) => file.endsWith("-report.json"));
    assert.ok(jsonName);
    const report = JSON.parse(await readFile(join(outDir, jsonName), "utf8"));
    assert.equal(report.scenario, "alpha/pass");
    assert.equal(report.rows[0].carrier, "fixture-carrier");
    assert.equal(
      report.rows[0].result.observation.metadata.model,
      "fixture-model",
    );
    assert.equal(
      report.rows[0].result.observation.metadata.provider,
      "fixture-provider",
    );
    assert.equal(
      report.rows[0].result.observation.metadata.recall.file,
      recallPath,
    );
    assert.match(
      report.rows[0].result.artifact.outcomes[0].name,
      /text-contains/,
    );
    const mdName = files.find((file) => file.endsWith("-report.md"));
    const markdown = await readFile(join(outDir, mdName!), "utf8");
    assert.match(markdown, /alpha\/pass/);
    assert.match(markdown, /fixture-carrier/);
    const loaded = await loadRecall({ cwd, configPath, target: recallPath });
    const source = loaded.scenarios[0]!.metadata!.recall as { file: string };
    assert.equal(source.file, recallPath);
  } finally {
    if (previous === undefined) delete process.env.XAS_RECALL_TEST_OUT_DIR;
    else process.env.XAS_RECALL_TEST_OUT_DIR = previous;
    await rm(outDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("任何考卷存在未注册 metric 时返回定义错误且 createDriver 从未调用", async () => {
  const cwd = await workspace();
  await writeFile(join(cwd, ".recall", "a.yaml"), PASS_FILE);
  await writeFile(
    join(cwd, ".recall", "b.yaml"),
    PASS_FILE.replace("text-contains", "not-registered"),
  );
  try {
    assert.equal(await main([], { cwd }), 2);
    assert.equal(state().created.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("重复注册判据在执行前返回定义错误且 createDriver 从未调用", async () => {
  const cwd = await workspace();
  await writeFile(
    join(cwd, ".recall", "x-agent-suite.config.ts"),
    "import config from " +
      JSON.stringify(CONFIG_FIXTURE_URL) +
      "; export default { ...config, criteria: [...config.criteria, config.criteria[0]] };\n",
  );
  await writeFile(join(cwd, ".recall", "a.yaml"), PASS_FILE);
  try {
    assert.equal(await main([], { cwd }), 2);
    assert.equal(state().created.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("同一运行中重复 Scenario ID 在执行前失败", async () => {
  const cwd = await workspace();
  await writeFile(join(cwd, ".recall", "a.yaml"), PASS_FILE);
  await writeFile(join(cwd, ".recall", "b.yaml"), PASS_FILE);
  try {
    await assert.rejects(
      loadRecall({ cwd }),
      /重复.*alpha\/pass|alpha\/pass.*重复/,
    );
    assert.equal(state().created.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("非法 repeat、未知配置字段与配置导入错误均返回定义错误", async (t) => {
  const configs = [
    [
      "repeat: 0",
      "export default { createDriver() {}, criteria: [], repeat: 0 };",
    ],
    [
      "unknown",
      "export default { createDriver() {}, criteria: [], unknown: true };",
    ],
    ["import", "import './missing.ts'; export default {};"],
  ] as const;
  for (const [name, source] of configs) {
    await t.test(name, async () => {
      const cwd = await workspace();
      const configPath = join(cwd, ".recall", "x-agent-suite.config.ts");
      await writeFile(configPath, source);
      await writeFile(join(cwd, ".recall", "a.yaml"), PASS_FILE);
      try {
        assert.equal(await main([], { cwd }), 2);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  }
});

test("行为判据失败退出 0；driver 基础设施失败退出 1；用法错误退出 2", async () => {
  const behavior = await workspace();
  await writeFile(
    join(behavior, ".recall", "a.yaml"),
    PASS_FILE.replace("text-contains: [hello]", "text-contains: [absent]"),
  );
  try {
    await withOutDir(async () =>
      assert.equal(await main([], { cwd: behavior }), 0),
    );
  } finally {
    await rm(behavior, { recursive: true, force: true });
  }

  const infrastructure = await workspace();
  const infraConfig =
    "import { textContains } from " +
    JSON.stringify(
      new URL("../../criteria/src/index.ts", import.meta.url).href,
    ) +
    ";\n" +
    "export default {\n" +
    '  createDriver() { throw new Error("driver unavailable"); },\n' +
    "  criteria: [textContains],\n" +
    "  outDir: " +
    JSON.stringify(join(infrastructure, "reports")) +
    ",\n" +
    "};\n";
  await writeFile(
    join(infrastructure, ".recall", "x-agent-suite.config.ts"),
    infraConfig,
  );
  await writeFile(join(infrastructure, ".recall", "a.yaml"), PASS_FILE);
  try {
    assert.equal(await main([], { cwd: infrastructure }), 1);
  } finally {
    await rm(infrastructure, { recursive: true, force: true });
  }
  assert.equal(await main(["--config"], { cwd: process.cwd() }), 2);
  assert.equal(await main(["--unknown"], { cwd: process.cwd() }), 2);
});
