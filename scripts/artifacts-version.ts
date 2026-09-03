/**
 * @module scripts/artifacts-version
 * 从 Git history 的 Conventional Commit 推导下一个制品版本。
 *
 * 不变量：显式版本只校验推导结果；本模块不修改 package.json、不创建 tag。
 */

/** 用于版本判断的最小提交消息。 */
export interface CommitMessage {
  /** Conventional Commit 标题。 */
  readonly subject: string;
  /** 提交正文。 */
  readonly body: string;
}

interface VersionParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

type ReleaseLevel = "major" | "minor" | "patch";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BREAKING_HEADER_PATTERN = /^[a-z][a-z0-9-]*(?:\([^\r\n)]*\))?!:/i;
const BREAKING_BODY_PATTERN = /(?:^|\n)BREAKING(?: |-)?CHANGE:\s*\S/i;

/** 根据最近稳定版本和后续提交推导下一版本；无可发布变更时返回 null。 */
export function inferNextVersion(
  latestVersion: string | null,
  commits: readonly CommitMessage[],
): string | null {
  if (commits.length === 0) {
    return null;
  }
  if (latestVersion === null) {
    return "0.1.0";
  }
  const current = parseVersion(latestVersion);
  const level = highestReleaseLevel(commits);
  return level ? bumpVersion(current, level) : null;
}

/** 校验调用方给出的期望版本与 Git history 推导值一致。 */
export function assertExpectedVersion(
  inferredVersion: string,
  expectedVersion: string,
): void {
  parseVersion(expectedVersion);
  if (inferredVersion !== expectedVersion) {
    throw new Error(
      `期望版本 ${expectedVersion} 与 Git history 推导版本 ${inferredVersion} 不一致`,
    );
  }
}

function highestReleaseLevel(
  commits: readonly CommitMessage[],
): ReleaseLevel | null {
  let level: ReleaseLevel | null = null;
  for (const message of commits) {
    const next = classifyCommit(message);
    if (next === "major") {
      return "major";
    }
    if (next === "minor") {
      level = "minor";
    } else if (next === "patch" && level === null) {
      level = "patch";
    }
  }
  return level;
}

function classifyCommit(message: CommitMessage): ReleaseLevel | null {
  const breaking =
    BREAKING_HEADER_PATTERN.test(message.subject) ||
    BREAKING_BODY_PATTERN.test(message.body);
  if (breaking) {
    return "major";
  }
  if (/^feat(?:\([^\r\n)]*\))?:/i.test(message.subject)) {
    return "minor";
  }
  if (/^(?:fix|perf|refactor)(?:\([^\r\n)]*\))?:/i.test(message.subject)) {
    return "patch";
  }
  return null;
}

function bumpVersion(current: VersionParts, level: ReleaseLevel): string {
  if (current.major === 0 && (level === "major" || level === "minor")) {
    return `0.${current.minor + 1}.0`;
  }
  if (level === "major") {
    return `${current.major + 1}.0.0`;
  }
  if (level === "minor") {
    return `${current.major}.${current.minor + 1}.0`;
  }
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

function parseVersion(version: string): VersionParts {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(`无效稳定 SemVer：${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}
