/**
 * @module scripts/tests/validate-release-ref
 * 在临时 Git 仓库中验证稳定发布 tag 的来源、类型、提交与默认分支可达性。
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const VALIDATOR = fileURLToPath(
  new URL("../validate-release-ref.mjs", import.meta.url),
);

test("拒绝非稳定 SemVer release tag", async () => {
  await withRepository(async (root) => {
    const commit = await commitFile(root, "base.txt", "base\n", "feat: 基线");
    setRemoteDefault(root, commit);
    assert.throws(
      () => validate(root, "v0.1.0-beta.1", commit),
      /稳定 tag 格式/,
    );
  });
});

test("拒绝 lightweight release tag", async () => {
  await withRepository(async (root) => {
    const commit = await commitFile(root, "base.txt", "base\n", "feat: 基线");
    git(root, ["tag", "v0.1.0"]);
    setRemoteDefault(root, commit);
    assert.throws(() => validate(root, "v0.1.0", commit), /annotated tag/);
  });
});

test("拒绝 peeled commit 与 GITHUB_SHA 不一致的 tag", async () => {
  await withRepository(async (root) => {
    await commitFile(root, "base.txt", "base\n", "feat: 基线");
    git(root, ["tag", "-a", "v0.1.0", "-m", "release: v0.1.0"]);
    const head = await commitFile(root, "next.txt", "next\n", "fix: 后续");
    setRemoteDefault(root, head);
    assert.throws(() => validate(root, "v0.1.0", head), /GITHUB_SHA/);
  });
});

test("拒绝 release commit 不可达默认分支", async () => {
  await withRepository(async (root) => {
    const base = await commitFile(root, "base.txt", "base\n", "feat: 基线");
    const release = await commitFile(root, "next.txt", "next\n", "fix: 后续");
    git(root, ["tag", "-a", "v0.1.1", "-m", "release: v0.1.1"]);
    setRemoteDefault(root, base);
    assert.throws(() => validate(root, "v0.1.1", release), /默认分支/);
  });
});

test("正确 annotated tag 通过并输出版本", async () => {
  await withRepository(async (root) => {
    const commit = await commitFile(root, "base.txt", "base\n", "feat: 基线");
    git(root, ["tag", "-a", "v0.1.0", "-m", "release: v0.1.0"]);
    setRemoteDefault(root, commit);
    assert.equal(validate(root, "v0.1.0", commit).trim(), "0.1.0");
  });
});

async function withRepository(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "xas-release-ref-"));
  try {
    git(root, ["init", "--initial-branch=main", "--quiet"]);
    git(root, ["config", "user.name", "x-agent-suite tests"]);
    git(root, ["config", "user.email", "tests@example.invalid"]);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function commitFile(
  root: string,
  name: string,
  contents: string,
  message: string,
): Promise<string> {
  await writeFile(join(root, name), contents);
  git(root, ["add", name]);
  git(root, ["commit", "--quiet", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function setRemoteDefault(root: string, commit: string): void {
  git(root, ["update-ref", "refs/remotes/origin/main", commit]);
}

function validate(root: string, tag: string, commit: string): string {
  return execFileSync(process.execPath, [VALIDATOR], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DEFAULT_BRANCH: "main",
      GITHUB_SHA: commit,
      RELEASE_TAG: tag,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
