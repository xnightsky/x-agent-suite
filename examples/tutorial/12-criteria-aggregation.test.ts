/**
 * @module examples/tutorial/12-criteria-aggregation
 * 判据与聚合闭环：MockDriver → Observation → runCriteria → resolveAggregate → report。
 * 演示四种维度状态：hit（文本包含/红线排除）、miss（工具未调用）、absent（未评测维度）。
 */
import { MockDriver } from "@x-agent-suite/driver";
import {
  textContains,
  textNotContains,
  toolCall,
} from "@x-agent-suite/criteria";
import type {
  ScenarioResult,
  SessionObservation,
  TurnObservation,
} from "@x-agent-suite/contracts";
import {
  resolveAggregate,
  runCriteria,
  writeScenarioReports,
} from "@x-agent-suite/observation";
import { printTutorialSummary, resolveTutorialOutDir } from "./support.ts";

const scenarioId = "tutorial/criteria-aggregation";
const prompt = "你好，世界；答案是不加载";
const outDir = resolveTutorialOutDir(".tmp/tutorial/criteria-aggregation");
const driver = new MockDriver();

await driver.start();
const startedAt = Date.now();
let observation;
try {
  observation = await driver.sendPrompt(prompt);
} finally {
  await driver.close("tutorial complete");
}
const endedAt = Date.now();

// 把一次性 Observation 归一成单轮 SessionObservation（消费者胶水职责）。
const turn: TurnObservation = {
  index: 0,
  sent: prompt,
  text: observation.text,
  toolCalls: observation.toolCalls,
  commands: [],
  startedAt,
  endedAt,
  metadata: {},
};
const session: SessionObservation = {
  driver: "mock",
  turns: [turn],
  text: observation.text,
  toolCalls: observation.toolCalls,
  commands: [],
  exhausted: false,
  metadata: {},
};

// 判据调度：expect 块声明本轮要判什么（离线可复跑同一入口）。
const outcomes = await runCriteria({
  session,
  criteria: [textContains, textNotContains, toolCall],
  turnExpects: [
    {
      "text-contains": ["你好", "不加载"],
      "text-not-contains": ["默认加载"],
      "tool-call": { tool: "message" },
    },
  ],
});

// 聚合：tool-call 未调用（miss，−2）；style 未评测（absent，中立）；coverage 3/4。
const aggregate = resolveAggregate(outcomes, {
  dimensions: [
    { metric: "text-contains", weight: 2 },
    { metric: "text-not-contains", weight: 1 },
    { metric: "tool-call", weight: 2 },
    { metric: "style", weight: 1 },
  ],
  threshold: 0.5,
});

const result: ScenarioResult = {
  observation,
  artifact: { aggregate },
  dryPass: true,
  hardPass: aggregate.pass,
  fuzzyPass: true,
  latencyMs: endedAt - startedAt,
  error: aggregate.pass ? undefined : aggregate.reason,
};
const report = await writeScenarioReports(
  [{ scenario: scenarioId, carrier: "mock", promptVariant: "default", result }],
  { scenarioId, outDir, stamp: "tutorial" },
);

printTutorialSummary({
  recipe: "criteria-aggregation",
  pass: aggregate.pass,
  score: aggregate.score,
  rawScore: aggregate.rawScore,
  maxScore: aggregate.maxScore,
  coverage: aggregate.coverage,
  states: aggregate.dimensions.map((dimension) => dimension.state),
  report,
});
