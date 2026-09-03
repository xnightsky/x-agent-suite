/**
 * @module scripts/validate-release-ref
 * 在安装依赖前验证稳定发布 tag 的类型、目标提交与默认分支可达性。
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

/**
 * 验证稳定发布引用并返回不带 v 前缀的版本。
 * @param {{ root: string, tag: string, githubSha: string, defaultBranch: string }} options 发布上下文。
 * @returns {string} 已验证的稳定版本。
 */
export function validateReleaseRef(options) {
  const match = STABLE_TAG_PATTERN.exec(options.tag);
  if (!match) {
    throw new Error(
      `release ref 必须符合稳定 tag 格式 vMAJOR.MINOR.PATCH：${options.tag}`,
    );
  }
  if (!COMMIT_PATTERN.test(options.githubSha)) {
    throw new Error("GITHUB_SHA 必须是完整的 40 位 commit SHA");
  }
  assertValidDefaultBranch(options.root, options.defaultBranch);

  const tagRef = `refs/tags/${options.tag}`;
  const tagType = tryGit(options.root, ["cat-file", "-t", tagRef]);
  if (tagType?.trim() !== "tag") {
    throw new Error(`release ref 必须是 annotated tag：${options.tag}`);
  }
  const tagCommit = git(options.root, [
    "rev-parse",
    "--verify",
    `${tagRef}^{commit}`,
  ]).trim();
  if (tagCommit !== options.githubSha.toLowerCase()) {
    throw new Error(
      `release tag peeled commit ${tagCommit} 与 GITHUB_SHA ${options.githubSha} 不一致`,
    );
  }

  const defaultRef = `refs/remotes/origin/${options.defaultBranch}`;
  if (tryGit(options.root, ["rev-parse", "--verify", defaultRef]) === null) {
    throw new Error(`无法解析默认分支远端引用：${defaultRef}`);
  }
  if (!isAncestor(options.root, tagCommit, defaultRef)) {
    throw new Error(`release commit 不可达默认分支：${defaultRef}`);
  }
  return options.tag.slice(1);
}

function assertValidDefaultBranch(root, branch) {
  if (!branch) throw new Error("DEFAULT_BRANCH 不能为空");
  try {
    git(root, ["check-ref-format", `refs/heads/${branch}`]);
  } catch {
    throw new Error(`DEFAULT_BRANCH 不是合法分支名：${branch}`);
  }
}

function isAncestor(root, commit, branchRef) {
  try {
    git(root, ["merge-base", "--is-ancestor", commit, branchRef]);
    return true;
  } catch {
    return false;
  }
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryGit(root, args) {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少发布环境变量 ${name}`);
  return value;
}

function runCli() {
  const version = validateReleaseRef({
    root: process.cwd(),
    tag: requiredEnvironment("RELEASE_TAG"),
    githubSha: requiredEnvironment("GITHUB_SHA"),
    defaultBranch: requiredEnvironment("DEFAULT_BRANCH"),
  });
  process.stdout.write(`${version}\n`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release ref 校验失败：${message}\n`);
    process.exitCode = 1;
  }
}
