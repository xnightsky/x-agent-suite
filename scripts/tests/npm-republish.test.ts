/**
 * @module scripts/tests/npm-republish
 * 用真实 tarball 验证补发入口，npm 进程边界使用本地替身。
 * 不变量：不读取真实凭据，不访问 registry，不执行真实发布。
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const command = fileURLToPath(
  new URL("../publish-release-core.mjs", import.meta.url),
);
const commit = "a".repeat(40);
const unixOnly = { skip: process.platform === "win32" };
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

function fixture(root: string, options: Record<string, unknown>) {
  const source = join(root, "source");
  mkdirSync(join(source, "package"), { recursive: true });
  writeFileSync(
    join(source, "package", "package.json"),
    JSON.stringify({
      name: options.packageName ?? "x-agent-suite",
      version: "0.7.1",
    }),
  );
  const file = "x-agent-suite-0.7.1.tgz";
  execFileSync("tar", ["-czf", join(root, file), "-C", source, "package"]);
  const sha256 = hash(readFileSync(join(root, file)));
  const manifest = JSON.stringify({
    schemaVersion: 2,
    version: "0.7.1",
    commit,
    dirty: false,
    mode: "stable",
    ...options,
    artifacts: [{ kind: "core", file, sha256 }],
  });
  writeFileSync(join(root, "manifest.json"), manifest);
  writeFileSync(
    join(root, "SHA256SUMS"),
    `${sha256}  ${file}\n${hash(manifest)}  manifest.json\n`,
  );
  if (options.corrupt) writeFileSync(join(root, file), "corrupted tarball");
}

function run(
  options: Record<string, unknown> = {},
  token = "test-only-credential",
  exitCode = "0",
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xas npm republish ")));
  try {
    fixture(root, options);
    const argsFile = join(root, "npm-args");
    writeFileSync(
      join(root, "npm"),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$NPM_ARGS_FILE"\nexit "$NPM_TEST_EXIT"\n',
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [command, "0.7.1", commit, root],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: `${root}${delimiter}${process.env.PATH ?? ""}`,
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
    return { ...result, args, tarball: join(root, "x-agent-suite-0.7.1.tgz") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("补发通过双重哈希、版本与提交校验后只发布原有主 tarball", unixOnly, () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.args, [
    "publish",
    result.tarball,
    "--access",
    "public",
    "--provenance",
    "--ignore-scripts",
    "--registry",
    "https://registry.npmjs.org",
  ]);
  assert.doesNotMatch(result.stdout + result.stderr, /test-only-credential/);
});

for (const [title, options, error] of [
  ["提交不一致", { commit: "b".repeat(40) }, /提交/],
  ["版本不一致", { version: "0.7.2" }, /版本|文件名/],
  ["snapshot", { mode: "snapshot" }, /stable/],
  ["制品被篡改", { corrupt: true }, /校验和/],
  ["tarball 内包名错误", { packageName: "another-package" }, /包名/],
] as const) {
  test(`补发拒绝${title}且不调用 npm`, unixOnly, () => {
    const result = run(options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.deepEqual(result.args, []);
  });
}

test("缺少凭据时补发失败且不调用 npm", unixOnly, () => {
  const result = run({}, "");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NPM_TOKEN/);
  assert.deepEqual(result.args, []);
});

test("npm 拒绝补发时保留失败退出码", unixOnly, () => {
  const result = run({}, "test-only-credential", "23");
  assert.equal(result.status, 23);
});
