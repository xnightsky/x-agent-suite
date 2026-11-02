/** Cedar 内置 Judge 考卷的零 token 编译验证：只读配置，不启动宿主或模型。 */
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { compileRecallFile } from "../../packages/recall/src/compile.ts";
import registry from "../../integrations/pi.registry.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");

test("Cedar Judge smoke 在同一 case 编译机械与 AI 断言及项目 provision", async () => {
  const rootDir = join(ROOT, "integrations", "itrepos", "cedar");
  const [scenario] = await compileRecallFile(
    join(rootDir, "judge", ".recall.yaml"),
    { rootDir, criteria: registry.criteria },
  );
  assert.ok(scenario);
  assert.equal(scenario.turns.length, 1);
  const mechanical = scenario.expect?.["answer-contract"] as {
    requiredPrefix: string;
    score: { hit: number; miss: number };
  };
  assert.deepEqual(mechanical, {
    requiredPrefix: "CEDAR_READY",
    score: { hit: 1, miss: -1 },
  });
  const recall = scenario.metadata!.recall as {
    judge: {
      timeoutMs: number;
      maxRetries: number;
      instructions: string;
      rubrics: Record<
        string,
        { rubric: string; score?: Record<string, number> }
      >;
    };
  };
  assert.equal(recall.judge.timeoutMs, 60_000);
  assert.equal(recall.judge.maxRetries, 0);
  assert.match(recall.judge.instructions, /最终回答/);
  const ready = recall.judge.rubrics.ready;
  const forbidden = recall.judge.rubrics.forbidden;
  assert.ok(ready);
  assert.ok(forbidden);
  assert.deepEqual(ready.score, { hit: 3 });
  assert.deepEqual(forbidden.score, { miss: 0 });
  assert.match(ready.rubric, /CEDAR_READY/);
  assert.match(forbidden.rubric, /FORBIDDEN_MARKER/);
  const provision = scenario.provision as {
    plan: string;
    resources: { source: string; destination: string; readOnly: boolean }[];
  };
  assert.equal(provision.plan, "project");
  assert.equal(provision.resources.length, 1);
  assert.equal(provision.resources[0]!.destination, "AGENTS.md");
  assert.equal(provision.resources[0]!.readOnly, true);
});
