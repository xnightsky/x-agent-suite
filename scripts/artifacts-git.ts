/**
 * @module scripts/artifacts-git
 * 读取 Git history、规划制品版本并创建经过验证的版本 tag。
 */
import { execFileSync } from "node:child_process";

import {
  assertExpectedVersion,
  inferNextVersion,
  type CommitMessage,
} from "./artifacts-version.ts";

/** 一次制品构建对应的 Git 版本计划。 */
export interface ArtifactVersionPlan {
  /** tarball 中写入的完整版本。 */
  readonly version: string;
  /** 本轮对应的稳定版本。 */
  readonly stableVersion: string;
  /** 稳定模式使用的 tag。 */
  readonly tag: string;
  /** 完整源提交。 */
  readonly commit: string;
  /** 短提交标识。 */
  readonly shortCommit: string;
  /** 最近的历史稳定 tag。 */
  readonly previousTag: string | null;
  /** 当前提交是否已经具有目标 tag。 */
  readonly tagExistsAtHead: boolean;
  /** 是否为不打 tag 的 snapshot。 */
  readonly snapshot: boolean;
  /** 用于本轮版本推导的提交消息。 */
  readonly commits: readonly CommitMessage[];
}

interface PlanOptions {
  readonly root: string;
  readonly expectedVersion?: string;
  readonly snapshot: boolean;
  readonly now?: Date;
}

const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** 拒绝包含 tracked 或 untracked 变更的源码工作区。 */
export function assertCleanRepository(root: string): void {
  const status = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status.trim()) {
    throw new Error(`工作区不干净，拒绝形成共享制品：\n${status.trim()}`);
  }
}

/** 根据当前 HEAD 与历史稳定 tag 规划版本。 */
export function planArtifactVersion(options: PlanOptions): ArtifactVersionPlan {
  const commit = git(options.root, ["rev-parse", "HEAD"]).trim();
  const shortCommit = git(options.root, [
    "rev-parse",
    "--short=7",
    "HEAD",
  ]).trim();
  const headTag = stableTagsAtHead(options.root)[0] ?? null;
  const previousTag = options.expectedVersion
    ? nearestStableTagBeforeHead(options.root)
    : headTag
      ? nearestStableTagBeforeHead(options.root)
      : nearestStableTag(options.root);
  const commits =
    options.expectedVersion || !headTag
      ? readCommitMessages(options.root, previousTag)
      : [];
  const stableVersion = options.expectedVersion
    ? resolveStableVersion(null, previousTag, commits)
    : resolveStableVersion(headTag, previousTag, commits);
  if (options.expectedVersion) {
    assertExpectedVersion(stableVersion, options.expectedVersion);
  }
  const version = options.snapshot
    ? createSnapshotVersion(
        stableVersion,
        shortCommit,
        options.now ?? new Date(),
      )
    : stableVersion;
  return {
    version,
    stableVersion,
    tag: `v${stableVersion}`,
    commit,
    shortCommit,
    previousTag,
    tagExistsAtHead: headTag === `v${stableVersion}`,
    snapshot: options.snapshot,
    commits,
  };
}

/** 为已经成功形成制品的当前提交创建 annotated SemVer tag。 */
export function createVersionTag(
  root: string,
  plan: ArtifactVersionPlan,
): boolean {
  if (plan.snapshot || plan.tagExistsAtHead) {
    return false;
  }
  const existing = tryGit(root, [
    "rev-parse",
    "--verify",
    `refs/tags/${plan.tag}`,
  ]);
  if (existing !== null) {
    throw new Error(`tag ${plan.tag} 已存在但不指向当前 HEAD`);
  }
  git(root, ["tag", "-a", plan.tag, "-m", `release: ${plan.tag}`, "HEAD"]);
  return true;
}

function resolveStableVersion(
  headTag: string | null,
  previousTag: string | null,
  commits: readonly CommitMessage[],
): string {
  if (headTag) {
    return headTag.slice(1);
  }
  const inferred = inferNextVersion(previousTag?.slice(1) ?? null, commits);
  if (!inferred) {
    throw new Error(
      "最近版本之后没有可发布的 feat/fix/perf/refactor/breaking 变更",
    );
  }
  return inferred;
}

function createSnapshotVersion(
  stableVersion: string,
  shortCommit: string,
  now: Date,
): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `${stableVersion}-dev.${date}.${shortCommit}`;
}

function stableTagsAtHead(root: string): string[] {
  return git(root, ["tag", "--points-at", "HEAD"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => STABLE_TAG_PATTERN.test(tag))
    .sort(compareTagsDescending);
}

function nearestStableTag(root: string): string | null {
  const described = tryGit(root, [
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v[0-9]*",
  ]);
  const tag = described?.trim() ?? "";
  return STABLE_TAG_PATTERN.test(tag) ? tag : null;
}

function nearestStableTagBeforeHead(root: string): string | null {
  const parent = tryGit(root, ["rev-parse", "--verify", "HEAD^"]);
  if (parent === null) {
    return null;
  }
  const tags = git(root, ["tag", "--merged", parent.trim()])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => STABLE_TAG_PATTERN.test(tag))
    .sort(compareTagsDescending);
  return tags[0] ?? null;
}

function readCommitMessages(
  root: string,
  previousTag: string | null,
): CommitMessage[] {
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const output = git(root, ["log", "--format=%s%x1f%b%x1e", range]);
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [subject = "", ...body] = record.split("\x1f");
      return { subject: subject.trim(), body: body.join("\x1f").trim() };
    });
}

function compareTagsDescending(left: string, right: string): number {
  return right.localeCompare(left, undefined, { numeric: true });
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function tryGit(root: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}
