/** Recall 默认流式结果、0..3 级详细输出与 verbosity 参数解析回归。 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.ts";
import { runRecall, type RecallRunEvent } from "../src/run.ts";
import { args, state, workspace } from "./fixtures/recall-workspace.ts";

async function runWithOutput(
  t: Parameters<typeof workspace>[0],
  flags: readonly string[] = [],
) {
  const ws = await workspace(t);
  const stdout: string[] = [];
  const stderr: string[] = [];
  t.mock.method(console, "log", (message: unknown) =>
    stdout.push(String(message)),
  );
  t.mock.method(console, "error", (message: unknown) =>
    stderr.push(String(message)),
  );
  const code = await main(args(ws, join(ws.cwd, "reports"), flags), {
    cwd: ws.cwd,
    homeDir: ws.cwd,
  });
  return { ws, code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

test("默认级别立即呈现 case 结果、失败原因和最终汇总，不展开生命周期", async (t) => {
  const result = await runWithOutput(t);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /RECALL cases=1 targets=1 repeat=1/);
  assert.match(
    result.stdout,
    /PASS alpha\/pass .*durationMs=\d+ rawScore=1 assertions=1\/1/,
  );
  assert.match(
    result.stdout,
    /SUMMARY total=1 passed=1 failed=0 errors=0 durationMs=\d+/,
  );
  assert.doesNotMatch(
    result.stdout,
    /RUN |REPEAT |TURN |ASSERT |PROMPT |OBSERVATION/,
  );
});

test("-v 增加 case/repeat 生命周期和双格式报告路径", async (t) => {
  const result = await runWithOutput(t, ["-v", "--repeat", "2"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /RUN 1\/1 alpha\/pass/);
  assert.match(result.stdout, /REPEAT 1\/2 START alpha\/pass/);
  assert.match(
    result.stdout,
    /REPEAT 2\/2 PASS alpha\/pass .*rawScore=1 assertions=1\/1/,
  );
  assert.match(result.stdout, /REPORT md=.*\.md json=.*\.json/);
  assert.doesNotMatch(result.stdout, /TURN |ASSERT |PROMPT |OBSERVATION/);
});

test("-vv 增加 turn 和判据，但不展开 prompt/Observation", async (t) => {
  const result = await runWithOutput(t, ["-vv"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /TURN 1\/1 START alpha\/pass/);
  assert.match(result.stdout, /TURN 1\/1 DONE alpha\/pass .*toolCalls=0/);
  assert.match(
    result.stdout,
    /ASSERT PASS text-contains .*checked|ASSERT PASS text-contains/,
  );
  assert.match(
    result.stdout,
    /ASSERT PASS text-contains .*score=1 contribution=1/,
  );
  assert.doesNotMatch(result.stdout, /PROMPT |OBSERVATION |RESULT /);
});

test("-vvv 增加完整 prompt、Observation、repeat 结果", async (t) => {
  const result = await runWithOutput(t, ["-vvv"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /PROMPT alpha\/pass .*"hello"/);
  assert.match(result.stdout, /OBSERVATION alpha\/pass/);
  assert.match(result.stdout, /"toolCalls": \[\]/);
  assert.match(result.stdout, /"events": \[/);
  assert.match(result.stdout, /RESULT alpha\/pass/);
});

test("--verbose、数值形式与混合计数映射到对应级别", async (t) => {
  const cases = [
    { flags: ["--verbose"], present: /RUN 1\/1/, absent: /TURN / },
    { flags: ["--verbose", "2"], present: /TURN 1\/1/, absent: /PROMPT / },
    { flags: ["--verbose=3"], present: /OBSERVATION/, absent: /$^/ },
    { flags: ["-v", "--verbose=2"], present: /OBSERVATION/, absent: /$^/ },
    { flags: ["--verbose", "0"], present: /PASS alpha\/pass/, absent: /RUN / },
  ];
  for (const item of cases) {
    await t.test(item.flags.join(" "), async (subtest) => {
      const result = await runWithOutput(subtest, item.flags);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, item.present);
      assert.doesNotMatch(result.stdout, item.absent);
    });
  }
});

test("verbosity 超过 3 或非整数是定义错误且不创建 Driver", async (t) => {
  const ws = await workspace(t);
  const errors: string[] = [];
  t.mock.method(console, "error", (message: unknown) =>
    errors.push(String(message)),
  );
  for (const flag of ["-vvvv", "--verbose=4", "--verbose=2.5"]) {
    const code = await main(args(ws, join(ws.cwd, "reports-" + flag), [flag]), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    });
    assert.equal(code, 2, flag);
  }
  assert.match(errors.join("\n"), /verbosity|0..3/);
  assert.equal(state().profiles.length, 0);
});

test("runRecall 程序监听器与返回值共享完整时序", async (t) => {
  const ws = await workspace(t);
  const events: RecallRunEvent[] = [];
  const result = await runRecall(
    {
      cwd: ws.cwd,
      homeDir: ws.cwd,
      target: ws.recallPath,
      selection: { carrier: "fixture-carrier" },
      liveConfigPath: ws.livePath,
      registryPath: ws.registryPath,
      outDir: join(ws.cwd, "reports-api"),
    },
    (event) => events.push(event),
  );

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "run-started",
      "case-started",
      "runner",
      "runner",
      "runner",
      "runner",
      "runner",
      "case-completed",
      "run-completed",
    ],
  );
  assert.deepEqual(
    events.flatMap((event) =>
      event.type === "runner" ? [event.event.type] : [],
    ),
    ["repeat-started", "scenario", "scenario", "scenario", "repeat-completed"],
  );
  assert.equal(result.runs.length, 1);
  assert.equal(result.failures.length, 0);
});

test("自定义断言权重同时展示归一化 score、contribution 与 rawScore", async (t) => {
  const ws = await workspace(t);
  const baseRegistry = new URL("./fixtures/recall.registry.ts", import.meta.url)
    .href;
  await writeFile(
    ws.registryPath,
    `import base from ${JSON.stringify(baseRegistry)};
const weighted = {
  name: "weighted",
  scope: "turn",
  assertionScore: (expect) => expect,
  evaluate: () => ({ pass: true, score: 1, reason: "weighted ok" }),
};
export default { ...base, criteria: [...base.criteria, weighted] };
`,
  );
  await writeFile(
    ws.recallPath,
    `version: 1
id: weighted
cases:
  - id: pass
    turns:
      - send: hello
        expect:
          weighted: { hit: 3, miss: -4 }
`,
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  t.mock.method(console, "log", (message: unknown) =>
    stdout.push(String(message)),
  );
  t.mock.method(console, "error", (message: unknown) =>
    stderr.push(String(message)),
  );
  const code = await main(args(ws, join(ws.cwd, "reports"), ["-vv"]), {
    cwd: ws.cwd,
    homeDir: ws.cwd,
  });

  assert.equal(code, 0, stderr.join("\n"));
  const output = stdout.join("\n");
  assert.match(output, /ASSERT PASS weighted .*score=1 contribution=3/);
  assert.match(output, /PASS weighted\/pass .*rawScore=3 assertions=1\/1/);
});
