/**
 * @module @x-agent-suite/recall/tests/recall-variables
 * Recall vars 编译、静态上下文与 evidence opt-in 的零 token 闭环测试。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { createEvidenceCriterion } from "@x-agent-suite/assertions";
import { runScenarioRepeat, runScenarioSpec } from "@x-agent-suite/runner";
import type {
  ScenarioSpec,
  SessionObservation,
  TurnObservation,
} from "@x-agent-suite/contracts";
import { compileRecallFile } from "../src/compile.ts";
import { recallVariableResolver } from "../src/recall-var.ts";

const criteria = [{ name: "evidence", scope: "turn" as const }];

async function compileYaml(t: TestContext, yaml: string, nestedFile = false) {
  const root = await mkdtemp(join(tmpdir(), "xas-recall-vars-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = nestedFile ? join(root, "nested") : root;
  await mkdir(directory, { recursive: true });
  const file = join(directory, "suite.yaml");
  await writeFile(file, yaml);
  return {
    root,
    file,
    scenarios: await compileRecallFile(file, { rootDir: root, criteria }),
  };
}

function evaluateScenario(spec: ScenarioSpec, text: string) {
  const declaration = spec.turns[0]!;
  const turn: TurnObservation = {
    index: 0,
    sent: declaration.send,
    text: "",
    toolCalls: [
      {
        name: "read",
        input: { path: "docs/a.md" },
        output: { content: [{ type: "text", text }] },
        status: "completed",
      },
    ],
    commands: [],
    startedAt: 0,
    endedAt: 1,
    metadata: {},
  };
  const session: SessionObservation = {
    driver: spec.id,
    turns: [turn],
    text: "",
    toolCalls: turn.toolCalls,
    commands: [],
    exhausted: false,
    metadata: spec.metadata ?? {},
  };
  return createEvidenceCriterion({
    variables: recallVariableResolver,
  }).evaluate(turn, {
    turnIndex: 0,
    session,
    expect: declaration.expect!.evidence,
  });
}

test("文档、选中 plan、case vars 浅合并，静态命名空间可用且执行输入不展开", async (t) => {
  const { root, file, scenarios } = await compileYaml(
    t,
    `version: 1
id: variables
vars:
  document: DOC_DOCUMENT
  shared: DOC_SHARED
  planOnly: DOC_PLAN
  caseOnly: DOC_CASE
  recursive: '{{ vars.document }}'
plans:
  variant:
    vars:
      shared: PLAN_SHARED
      planOnly: PLAN_ONLY
    resources: []
context: { plan: variant }
cases:
  - id: one
    vars: { shared: CASE_SHARED }
    turns:
      - send: '{{ vars.document }}'
        expect:
          evidence:
            toolResult:
              tool: read
              contains:
                - '{{ vars.document }}'
                - '{{ vars.shared }}'
                - '{{ vars.planOnly }}'
                - '{{ vars.caseOnly }}'
                - '{{ vars.recursive }}'
                - '{{ scenario.id }}/{{ case.id }}/{{ plan.name }}'
                - '{{ scenario.file }}'
                - '{{ scenario.dir }}'
                - '{{ scenario.rootDir }}'
                - 'turn-{{ turn.index }}'
`,
    true,
  );
  const spec = scenarios[0]!;
  assert.equal(spec.turns[0]!.send, "{{ vars.document }}");
  const session: SessionObservation = {
    driver: spec.id,
    turns: [],
    text: "",
    toolCalls: [],
    commands: [],
    exhausted: false,
    metadata: spec.metadata ?? {},
  };
  const expectedPaths = [
    ["{{ scenario.file }}", resolve(file)],
    ["{{ scenario.dir }}", dirname(resolve(file))],
    ["{{ scenario.rootDir }}", root],
  ] as const;
  for (const [reference, expected] of expectedPaths) {
    const prepared = recallVariableResolver.prepareValue(reference, {
      turnIndex: 0,
      session,
      expect: undefined,
    });
    assert.equal(prepared.resolve(), expected, reference);
  }
  const output = [
    "DOC_DOCUMENT",
    "CASE_SHARED",
    "PLAN_ONLY",
    "DOC_CASE",
    "{{ vars.document }}",
    "variables/one/variant",
    resolve(file),
    join(root, "nested"),
    root,
    "turn-0",
  ].join("\n");
  const result = await evaluateScenario(spec, output);
  assert.equal(result.pass, true, result.reason);
  assert.doesNotMatch(JSON.stringify(spec.metadata), /DOC|CASE|PLAN/);
});

test("真实 Recall 解析器在 not 未命中准备阶段仍拒绝未知变量", async (t) => {
  const { scenarios } = await compileYaml(
    t,
    `version: 1
id: invalid
vars: { known: 正文 }
cases:
  - id: one
    turns:
      - send: unchanged
        expect:
          evidence:
            allOf:
              - name: content
                toolResult: { tool: read, contains: ['{{ vars.known }}'] }
              - name: invalid
                not:
                  toolResult: { tool: read, contains: ['{{ vars.missing }}'] }
`,
  );
  await assert.rejects(
    async () => evaluateScenario(scenarios[0]!, "正文"),
    /vars\.missing/,
  );
});

test("vars 保留名、变量名、声明形状和非有限 JSON 数值均在编译期拒绝", async (t) => {
  const invalid = [
    `version: 1
id: x
vars: { turn: x }
cases: [{ id: c, turns: [{ send: x }] }]
`,
    `version: 1
id: x
plans:
  p:
    vars: { scenario: x }
    resources: []
cases: [{ id: c, turns: [{ send: x }] }]
`,
    `version: 1
id: x
cases:
  - id: c
    vars: { resources: x }
    turns: [{ send: x }]
`,
    `version: 1
id: x
vars: { bad_name: x }
cases: [{ id: c, turns: [{ send: x }] }]
`,
    `version: 1
id: x
vars: { notFinite: .nan }
cases: [{ id: c, turns: [{ send: x }] }]
`,
    `version: 1
id: x
vars: []
cases: [{ id: c, turns: [{ send: x }] }]
`,
  ];
  for (const yaml of invalid) {
    await assert.rejects(compileYaml(t, yaml), /vars|变量|JSON|保留/);
  }
});

test("变量物理路径不匹配时不进入 reason、Runner error 或 artifact", async (t) => {
  const { root, scenarios } = await compileYaml(
    t,
    `version: 1
id: redaction
cases:
  - id: one
    turns:
      - send: unchanged
        expect:
          evidence:
            toolResult:
              tool: read
              path: { arg: path, resource: docs/a.md }
              contains: ['{{ scenario.rootDir }}']
`,
  );
  const result = await runScenarioSpec(scenarios[0]!, {
    createDriver: () => ({
      start: async () => {},
      sendPrompt: async () => ({
        text: "",
        toolCalls: [
          {
            name: "read",
            input: { path: "docs/a.md" },
            output: { content: [{ type: "text", text: "正文" }] },
            status: "completed",
          },
        ],
        toolCallsCount: 1,
        events: [{ type: "text", timestamp: 0 }],
      }),
      close: async () => {},
      events: async function* () {},
    }),
    criteria: [
      createEvidenceCriterion({
        variables: recallVariableResolver,
        resolveWorkspaceCwd: () => root,
      }),
    ],
  });
  assert.equal(result.hardPass, false);
  assert.ok(result.error);
  assert.equal(result.error.includes(root), false);
  assert.equal(JSON.stringify(result.artifact).includes(root), false);
});

test("未选 plan、none 与 case context 整块覆盖只使用选中的变量层", async (t) => {
  const { scenarios } = await compileYaml(
    t,
    `version: 1
id: selection
vars: { marker: DOC_ONLY }
plans:
  first:
    vars: { marker: FIRST_PLAN }
    resources: []
  second:
    vars: { marker: SECOND_PLAN }
    resources: []
context: { plan: first }
cases:
  - id: inherit
    turns:
      - send: unchanged
        expect:
          evidence:
            toolResult: { tool: read, contains: ['{{ vars.marker }}', '{{ plan.name }}'] }
  - id: clear
    context: { plan: none }
    turns:
      - send: unchanged
        expect:
          evidence:
            toolResult: { tool: read, contains: ['{{ vars.marker }}', '{{ plan.name }}'] }
  - id: override
    context: { plan: second }
    turns:
      - send: unchanged
        expect:
          evidence:
            toolResult: { tool: read, contains: ['{{ vars.marker }}', '{{ plan.name }}'] }
`,
  );
  const expected = ["FIRST_PLAN first", "DOC_ONLY none", "SECOND_PLAN second"];
  for (const [index, spec] of scenarios.entries()) {
    const result = await evaluateScenario(spec, expected[index]!);
    assert.equal(result.pass, true, spec.id + ": " + result.reason);
  }
});

test("2 case × 2 turn × repeat=2 保持变量上下文、轮次和 send 隔离", async (t) => {
  const { scenarios } = await compileYaml(
    t,
    `version: 1
id: repeat
cases:
  - id: alpha
    vars: { marker: ALPHA_ONLY }
    turns:
      - send: 'send-alpha-0-{{ vars.marker }}'
        expect:
          evidence:
            toolResult: { tool: read, contains: ['{{ vars.marker }}', '{{ case.id }}', 'turn-{{ turn.index }}'] }
      - send: 'send-alpha-1-{{ vars.marker }}'
        expect:
          evidence:
            toolResult: { tool: read, contains: ['{{ vars.marker }}', '{{ case.id }}', 'turn-{{ turn.index }}'] }
  - id: beta
    vars: { marker: BETA_ONLY }
    turns:
      - send: 'send-beta-0-{{ vars.marker }}'
        expect:
          evidence:
            toolResult: { tool: read, contains: ['{{ vars.marker }}', '{{ case.id }}', 'turn-{{ turn.index }}'] }
      - send: 'send-beta-1-{{ vars.marker }}'
        expect:
          evidence:
            toolResult: { tool: read, contains: ['{{ vars.marker }}', '{{ case.id }}', 'turn-{{ turn.index }}'] }
`,
  );
  const criterion = createEvidenceCriterion({
    variables: recallVariableResolver,
  });
  let outcomeCount = 0;
  for (const spec of scenarios) {
    const drivers: { starts: number; closes: number; sent: string[] }[] = [];
    const caseId = spec.id.split("/").at(-1)!;
    const repeated = await runScenarioRepeat(spec, {
      repeat: 2,
      criteria: [criterion],
      createDriver: () => {
        const record = { starts: 0, closes: 0, sent: [] as string[] };
        drivers.push(record);
        let turnIndex = 0;
        return {
          start: async () => {
            record.starts += 1;
          },
          sendPrompt: async (text: string) => {
            record.sent.push(text);
            const marker = `${caseId.toUpperCase()}_ONLY ${caseId} turn-${turnIndex++}`;
            return {
              text: marker,
              toolCalls: [
                {
                  name: "read",
                  input: {},
                  output: { content: [{ type: "text", text: marker }] },
                  status: "completed",
                },
              ],
              toolCallsCount: 1,
              events: [{ type: "text", timestamp: 0 }],
            };
          },
          close: async () => {
            record.closes += 1;
          },
          events: async function* () {},
        };
      },
    });
    assert.equal(drivers.length, 2);
    assert.equal(drivers.filter((driver) => driver.starts === 1).length, 2);
    assert.equal(drivers.filter((driver) => driver.closes === 1).length, 2);
    assert.deepEqual(
      drivers.flatMap((driver) => driver.sent),
      [...spec.turns, ...spec.turns].map((turn) => turn.send),
    );
    for (const result of repeated.results) {
      assert.equal(result.hardPass, true, spec.id);
      assert.deepEqual(
        result.artifact.outcomes
          .filter((outcome) => outcome.scope === "turn")
          .map((outcome) => outcome.turnIndex),
        [0, 1],
      );
      assert.ok(result.artifact.outcomes.every((outcome) => outcome.pass));
      outcomeCount += result.artifact.outcomes.length;
    }
  }
  assert.equal(outcomeCount, 8);
});
