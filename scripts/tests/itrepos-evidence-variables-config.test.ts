/**
 * @module scripts/tests/itrepos-evidence-variables-config
 * 独立变量场景仓的零 token 编译、真实工厂与独立 fake 观察检查。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import type { EvidenceExpect } from "@x-agent-suite/assertions/evidence";
import type {
  ScenarioSpec,
  SessionObservation,
  ToolCall,
  TurnCriterion,
  TurnObservation,
} from "@x-agent-suite/contracts";
import { compileRecallFile } from "../../packages/recall/src/compile.ts";
import { recallVariableResolver } from "../../packages/recall/src/recall-var.ts";
import type { RecallCriterionFactoryContext } from "../../packages/recall/src/registry.ts";
import registry from "../../integrations/pi.registry.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");

async function compileScenarios() {
  const rootDir = join(ROOT, "integrations", "itrepos", "evidence");
  const scenarios = await compileRecallFile(
    join(rootDir, "variables", ".recall.yaml"),
    { rootDir, criteria: registry.criteria },
  );
  return { rootDir, scenarios };
}

async function consumerEvidence(): Promise<TurnCriterion> {
  const registration = registry.criteria.find(
    (item) => item.name === "evidence" && item.scope === "turn",
  );
  assert.ok(registration && "create" in registration);
  const criterion = await registration.create({
    variables: recallVariableResolver,
  } as RecallCriterionFactoryContext);
  assert.ok(criterion.scope === "turn");
  return criterion;
}

function toolCall(name: string, path: string, text: string): ToolCall {
  return {
    name,
    input: name === "grep" ? { path: "docs", pattern: "研究流程" } : { path },
    output: { content: [{ type: "text", text }] },
    status: "completed",
  };
}

function evaluateFixture(
  spec: ScenarioSpec,
  criterion: TurnCriterion,
  turnIndex: number,
  toolCalls: readonly ToolCall[],
) {
  const turn: TurnObservation = {
    index: turnIndex,
    sent: spec.turns[turnIndex]!.send,
    text: "",
    toolCalls: [...toolCalls],
    commands: [],
    startedAt: 0,
    endedAt: 1,
    metadata: { workspaceCwd: "/sandbox/root" },
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
  return criterion.evaluate(turn, {
    turnIndex,
    session,
    expect: spec.turns[turnIndex]!.expect!.evidence,
  });
}

test("变量场景独立覆盖三层、整值数组、嵌入、转义、单次展开与单轮索引", async () => {
  const { scenarios } = await compileScenarios();
  assert.deepEqual(
    scenarios.map((scenario) => scenario.id),
    [
      "observed-evidence-variables/layered-contains",
      "observed-evidence-variables/embedded-escaped-and-turn-index",
    ],
  );

  const layered = scenarios[0]!.turns[0]!.expect!.evidence as EvidenceExpect;
  assert.ok("allOf" in layered);
  const nodes = layered.allOf.map((child) => {
    assert.ok("toolResult" in child);
    return child.toolResult;
  });
  assert.deepEqual(nodes[0]!.contains, ["{{ vars.searchResultMarker }}"]);
  assert.equal(nodes[1]!.contains, "{{ vars.entryFragments }}");
  assert.deepEqual(nodes[2]!.contains, ["{{ vars.attachmentFragment }}"]);

  const forms = scenarios[1]!;
  assert.equal(forms.turns.length, 1);
  const first = forms.turns[0]!.expect!.evidence as EvidenceExpect;
  assert.ok("allOf" in first);
  const firstNodes = first.allOf.map((child) => {
    assert.ok("toolResult" in child);
    return child.toolResult;
  });
  assert.deepEqual(firstNodes[0]!.contains, [
    "{{ vars.resourceStem }}.{{ vars.resourceExtension }}",
  ]);
  assert.deepEqual(firstNodes[1]!.contains, [
    String.raw`\{{ 研究流程 }}`,
    "{{ vars.literalTemplate }}",
    "turn-{{ turn.index }}",
    String.raw`n={{ vars.amount }};flag={{ vars.enabled }};literal\keep`,
    "suite={{ scenario.id }};case={{ case.id }};plan={{ plan.name }}",
  ]);

  const provision = forms.provision as {
    resources: readonly { destination: string }[];
  };
  assert.deepEqual(
    provision.resources.map((resource) => resource.destination),
    ["docs/research.md", "docs/attachment.md", "docs/variables.md"],
  );
});

test("真实消费者工厂用独立 fake 观察判别优先级、类型、身份和当前轮", async () => {
  const { rootDir, scenarios } = await compileScenarios();
  const criterion = await consumerEvidence();
  const read = async (name: string) =>
    readFile(join(rootDir, "docs", name), "utf8");
  const layered = await evaluateFixture(scenarios[0]!, criterion, 0, [
    toolCall("grep", "docs", "research.md:1:# 研究流程"),
    toolCall("read", "docs/research.md", await read("research.md")),
    toolCall("read", "docs/attachment.md", await read("attachment.md")),
  ]);
  assert.equal(layered.pass, true, layered.reason);

  const first = await evaluateFixture(scenarios[1]!, criterion, 0, [
    toolCall("grep", "docs", "research.md:1:# 研究流程"),
    toolCall("read", "docs/variables.md", await read("variables.md")),
  ]);
  assert.equal(first.pass, true, first.reason);
});
