/**
 * @module scripts/tests/artifacts-git
 * 在临时 Git 仓库中验证自动版本规划、tag 创建与干净工作区门槛。
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCleanRepository,
  createVersionTag,
  planArtifactVersion,
} from "../artifacts-git.ts";

test("首次版本创建 annotated tag，后续 fix 自动递增 PATCH", async () => {
  const root = await createRepository();
  try {
    await commitFile(root, "feature.txt", "one\n", "feat: 初始能力");
    const initial = planArtifactVersion({ root, snapshot: false });
    assert.equal(initial.version, "0.1.0");
    assert.equal(createVersionTag(root, initial), true);
    assert.match(git(root, ["cat-file", "-t", "v0.1.0"]), /tag/);

    const tagged = planArtifactVersion({ root, snapshot: false });
    assert.equal(tagged.version, "0.1.0");
    assert.equal(tagged.tagExistsAtHead, true);

    await commitFile(root, "fix.txt", "two\n", "fix: 修复制品");
    const patch = planArtifactVersion({ root, snapshot: false });
    assert.equal(patch.version, "0.1.1");
    assert.equal(patch.previousTag, "v0.1.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release expectedVersion 必须由 tag 前历史重新推导", async () => {
  const root = await createRepository();
  try {
    await commitFile(root, "base.txt", "base\n", "feat: 基线");
    git(root, ["tag", "-a", "v0.1.0", "-m", "release: v0.1.0"]);
    await commitFile(root, "feature.txt", "feature\n", "feat: 新能力");
    git(root, ["tag", "-a", "v0.1.1", "-m", "release: v0.1.1"]);

    assert.throws(
      () =>
        planArtifactVersion({
          root,
          snapshot: false,
          expectedVersion: "0.1.1",
        }),
      /期望版本 0\.1\.1.*推导版本 0\.2\.0/,
    );

    git(root, ["tag", "-d", "v0.1.1"]);
    git(root, ["tag", "-a", "v0.2.0", "-m", "release: v0.2.0"]);
    const plan = planArtifactVersion({
      root,
      snapshot: false,
      expectedVersion: "0.2.0",
    });
    assert.equal(plan.stableVersion, "0.2.0");
    assert.equal(plan.previousTag, "v0.1.0");
    assert.equal(plan.tagExistsAtHead, true);
    assert.deepEqual(
      plan.commits.map((commit) => commit.subject),
      ["feat: 新能力"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dirty working tree 被稳定制品门槛拒绝", async () => {
  const root = await createRepository();
  try {
    await commitFile(root, "base.txt", "base\n", "feat: 基线");
    await writeFile(join(root, "dirty.txt"), "dirty\n");
    assert.throws(() => assertCleanRepository(root), /工作区不干净/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xas-git-test-"));
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "x-agent-suite tests"]);
  git(root, ["config", "user.email", "tests@example.invalid"]);
  return root;
}

async function commitFile(
  root: string,
  name: string,
  contents: string,
  message: string,
): Promise<void> {
  await writeFile(join(root, name), contents);
  git(root, ["add", name]);
  git(root, ["commit", "--quiet", "-m", message]);
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
