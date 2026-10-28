/**
 * @module scripts/tests/npm-release
 * 执行 Release 工作流中的发布命令，验证主制品选择与失败传播。
 * 不变量：仅替换 npm 进程边界，不读取真实凭据、不访问 registry、不执行发布。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

const unixOnly = { skip: process.platform === "win32" };
const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

function publishCommand(): string {
  const step = workflow
    .split(/\n(?=      - )/)
    .find((entry) => /\bnpm publish\b/.test(entry));
  assert.ok(step, "Release 工作流必须发布已构建的 npm 主制品");
  const block = step.match(/        run: \|\n((?:          .*\n?)+)/);
  assert.ok(block, "发布步骤必须提供可执行的 shell 命令块");
  return block[1]!.replace(/^          /gm, "");
}

function runPublish(token: string, exitCode = "0") {
  const command = publishCommand();
  const root = mkdtempSync(join(tmpdir(), "xas-npm-release-"));
  const argsFile = join(root, "npm-args.txt");
  try {
    writeFileSync(
      join(root, "npm"),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$NPM_ARGS_FILE"\nexit "$NPM_TEST_EXIT"\n',
      { mode: 0o755 },
    );
    const result = spawnSync(
      "bash",
      ["--noprofile", "--norc", "-e", "-c", command],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: `${root}${delimiter}${process.env.PATH ?? ""}`,
          VERSION: "0.8.1",
          NODE_AUTH_TOKEN: token,
          NPM_ARGS_FILE: argsFile,
          NPM_TEST_EXIT: exitCode,
        },
      },
    );
    assert.ifError(result.error);
    const args = existsSync(argsFile)
      ? readFileSync(argsFile, "utf8").trim().split("\n")
      : [];
    return { ...result, args };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  "npm 发布仅上传同版本核心 tarball，公开访问并携带来源证明",
  unixOnly,
  () => {
    const result = runPublish("test-only-credential");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.args, [
      "publish",
      "artifacts/0.8.1/x-agent-suite-0.8.1.tgz",
      "--access",
      "public",
      "--provenance",
      "--registry",
      "https://registry.npmjs.org",
    ]);
    assert.doesNotMatch(result.stdout + result.stderr, /test-only-credential/);
  },
);

test("缺失 NPM_TOKEN 时显式失败且不调用 npm", unixOnly, () => {
  const result = runPublish("");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NPM_TOKEN/);
  assert.deepEqual(result.args, []);
});

test("npm 拒绝发布时工作流命令保留失败退出码", unixOnly, () => {
  const result = runPublish("test-only-credential", "23");
  assert.equal(result.status, 23);
});
