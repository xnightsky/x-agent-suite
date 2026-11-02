/**
 * @module @x-agent-suite/assertions/tests/subpaths
 * evidence 与 judge 公开子路径的 workspace 自引用契约测试。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as assertions from "@x-agent-suite/assertions";
import * as evidenceSubpath from "@x-agent-suite/assertions/evidence";
import * as judgeSubpath from "@x-agent-suite/assertions/judge";

test("assertions/evidence 原样暴露完整证据能力", () => {
  assert.deepEqual(Object.keys(evidenceSubpath).sort(), [
    "createEvidenceCriterion",
    "evidence",
    "extractToolOutputText",
    "normalizeWorkspacePath",
  ]);
  assert.equal(evidenceSubpath.evidence, assertions.evidence);
  assert.equal(
    evidenceSubpath.createEvidenceCriterion,
    assertions.createEvidenceCriterion,
  );
  assert.equal(
    evidenceSubpath.extractToolOutputText,
    assertions.extractToolOutputText,
  );
  assert.equal(
    evidenceSubpath.normalizeWorkspacePath,
    assertions.normalizeWorkspacePath,
  );
});

test("assertions/judge 原样暴露 AI 断言适配而非底层执行器", () => {
  assert.deepEqual(Object.keys(judgeSubpath).sort(), [
    "createJudgeAssertion",
    "judgeAssertionResults",
  ]);
  assert.equal(
    judgeSubpath.createJudgeAssertion,
    assertions.createJudgeAssertion,
  );
  assert.equal(
    judgeSubpath.judgeAssertionResults,
    assertions.judgeAssertionResults,
  );
  assert.equal("judge" in judgeSubpath, false);
});
