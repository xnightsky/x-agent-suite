/**
 * @module scripts/tests/itrepos-evidence-config
 * Evidence 场景仓的零 token 编译验证：只读配置，不启动宿主或模型。
 */
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import type { EvidenceExpect } from "@x-agent-suite/assertions/evidence";
import { compileRecallFile } from "../../packages/recall/src/compile.ts";
import registry from "../../integrations/pi.registry.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");

test("Evidence 场景仓编译检索、实读、引用、否定与只读权限声明", async () => {
  const rootDir = join(ROOT, "integrations", "itrepos", "evidence");
  const scenarios = await compileRecallFile(join(rootDir, ".recall.yaml"), {
    rootDir,
    criteria: registry.criteria,
  });
  assert.deepEqual(
    scenarios.map((scenario) => scenario.id),
    ["observed-evidence/read-and-cite", "observed-evidence/no-target-access"],
  );
  const positive = scenarios[0]!.turns[0]!.expect!.evidence as EvidenceExpect;
  assert.ok("allOf" in positive);
  assert.deepEqual(
    positive.allOf.map((child) => child.name),
    ["search", "entry", "attachment", "cite"],
  );
  const provision = scenarios[0]!.provision as {
    resources: readonly { destination: string; readOnly: boolean }[];
  };
  assert.deepEqual(
    provision.resources.map((resource) => resource.destination),
    ["docs/research.md", "docs/attachment.md"],
  );
  assert.ok(provision.resources.every((resource) => resource.readOnly));

  const negative = scenarios[1]!.turns[0]!.expect!.evidence as EvidenceExpect;
  assert.ok("not" in negative);
  assert.ok("toolResult" in negative.not);
  assert.equal(negative.not.toolResult.path?.resource, "docs/research.md");
  assert.equal(
    registry.effectsProfiles["evidence-readonly"]?.tools,
    "allowlist",
  );
  assert.equal(registry.effectsProfiles["evidence-readonly"]?.maxSteps, 8);
});
