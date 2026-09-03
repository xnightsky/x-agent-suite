/**
 * @module scripts/tests/artifacts-manifest
 * 验证制品清单保留自动版本推导依据，便于跨仓审计版本来源。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createArtifactManifest } from "../artifacts-manifest.ts";
import type { ArtifactVersionPlan } from "../artifacts-git.ts";

test("manifest 记录上一 tag 与参与自动划版的提交", () => {
  const plan: ArtifactVersionPlan = {
    version: "0.2.0",
    stableVersion: "0.2.0",
    tag: "v0.2.0",
    commit: "0123456789abcdef",
    shortCommit: "0123456",
    previousTag: "v0.1.0",
    tagExistsAtHead: false,
    snapshot: false,
    commits: [
      { subject: "feat: 记录版本推导依据", body: "" },
      { subject: "docs: 同步制品规范", body: "" },
    ],
  };
  const manifest = createArtifactManifest(
    plan,
    [
      {
        file: "x-agent-suite-0.2.0.tgz",
        sha256: "abc123",
        kind: "core",
      },
    ],
    {
      builtAt: "2026-08-28T00:00:00.000Z",
      node: "v24.0.0",
      pnpm: "10.33.0",
    },
  );

  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.versioning, {
    strategy: "conventional-commits",
    previousTag: "v0.1.0",
    commits: ["feat: 记录版本推导依据", "docs: 同步制品规范"],
  });
});
