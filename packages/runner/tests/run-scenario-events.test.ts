/** Runner 结构化进度事件顺序与 repeat 归因回归。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Criterion } from "@x-agent-suite/contracts";
import { MockDriver } from "@x-agent-suite/driver";
import {
  runScenarioRepeat,
  runScenarioSpec,
  type ScenarioRepeatEvent,
  type ScenarioRunEvent,
} from "../src/index.ts";

const contains: Criterion = {
  name: "contains",
  scope: "turn",
  evaluate: (turn, context) => ({
    pass: turn.text.includes(String(context.expect)),
    score: 1,
    reason: "checked",
  }),
};

test("runScenarioSpec 按 turn 开始、Observation、判据完成顺序发事件", async () => {
  const events: ScenarioRunEvent[] = [];
  await runScenarioSpec(
    {
      id: "events/two-turns",
      turns: [
        { send: "first", expect: { contains: "first" } },
        { send: "second", expect: { contains: "missing" } },
      ],
    },
    {
      createDriver: () => new MockDriver(),
      criteria: [contains],
      onEvent: (event) => events.push(event),
    },
  );

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "turn-started",
      "turn-completed",
      "criteria-completed",
      "turn-started",
      "turn-completed",
      "criteria-completed",
    ],
  );
  const firstStart = events[0];
  assert.ok(firstStart?.type === "turn-started");
  assert.equal(firstStart.prompt, "first");
  assert.equal(firstStart.turnIndex, 0);
  assert.equal(firstStart.turnCount, 2);
  const firstComplete = events[1];
  assert.ok(firstComplete?.type === "turn-completed");
  assert.equal(firstComplete.observation.text, "first");
  assert.equal(firstComplete.observation.events.length, 2);
  const secondCriteria = events[5];
  assert.ok(secondCriteria?.type === "criteria-completed");
  assert.equal(secondCriteria.outcomes[0]?.pass, false);
});

test("runScenarioRepeat 为嵌套事件附加 repeat 序号并返回单次结果", async () => {
  const events: ScenarioRepeatEvent[] = [];
  await runScenarioRepeat(
    { id: "events/repeat", turns: [{ send: "hello" }] },
    {
      createDriver: () => new MockDriver(),
      criteria: [],
      repeat: 2,
      onEvent: (event) => events.push(event),
    },
  );

  assert.deepEqual(
    events.map((event) =>
      event.type === "scenario"
        ? `${event.repeatIndex}:${event.event.type}`
        : `${event.repeatIndex}:${event.type}`,
    ),
    [
      "0:repeat-started",
      "0:turn-started",
      "0:turn-completed",
      "0:repeat-completed",
      "1:repeat-started",
      "1:turn-started",
      "1:turn-completed",
      "1:repeat-completed",
    ],
  );
  const completed = events[3];
  assert.ok(completed?.type === "repeat-completed");
  assert.equal(completed.result.hardPass, true);
  assert.equal(completed.repeatCount, 2);
});
