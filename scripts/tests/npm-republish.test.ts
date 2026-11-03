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

import { rawTarGz } from "./tar-fixture.ts";

const command = fileURLToPath(
  new URL("../publish-release-core.mjs", import.meta.url),
);
const commit = "a".repeat(40);
const unixOnly = { skip: process.platform === "win32" };
const DUPLICATE_PACKAGE_PATHS = [
  "package/package.json",
  "package/./package.json",
  "package//package.json",
  "package/foo/../package.json",
] as const;
// 真实 gzip tar：首条合法 package.json，随后 PAX x 含两个 path；系统解包用末条 evil 覆盖。
// 真实 gzip tar：两个 package.json 之间只有一个零块；npm tar 会继续读到第二条。
const SINGLE_ZERO_TAR_GZ = Buffer.from(
  "H4sIAAAAAAAAE+2U3QqCMBSAfZTYdc6ZP5FXvYrZsKVNcVMM8d07WQiKeJNUwvl2cbbD/g4cvjyMkjDmVv6K9KoyaSwMA3zX7SIwjsx2vH7e5W2H+Z6xYUt/ZIpS6bCA5z+9Z1zcSmiIDG+cBORYSxFftEruVm1CJ0htqlJoTrak4oUSmYRNjO7pDjInAauGDDcGhFpnobQVpQL6iLTtr4tDEGSW/B/8b0/430H/f4Pe/7wSqfnugoHzDxTGnPOfJ9H3CIIgK+MBKN/pDgAOAAA=",
  "base64",
);
// 真实 gzip tar：PAX size=0 使系统 tar 把 decoy 数据区中的第二份 package.json 当作独立 entry。
const PAX_SIZE_ZERO_TAR_GZ = Buffer.from(
  "H4sIAAAAAAAAE+2WzY6CMBDHOfsUpGfpBygbTTbZo0dfoULjdnULodWgxnd3ZI0JhCyHZWXNzo/DlKZ0ppkZ+s9lspFrxfIvSz9sZrye4UA8mVQWaFououl9XM2LiMdTz+d9B9LGzjpZgPuf7tM83JNwIkZ+KjInb6XR63dnNwdWBlAJxgV2p50iY7JXhdWZgUWcvtAQZlYa3k6kvnBOKEu1dSzZaqgjcj4PfTikk6UsF0qmkGFm9VEFR1Vkffvo6n8uRLP/Qx55ftl3IG388/6f+de0v/LR0IEgg3C791mqkuzwSz46+j+s/Quq/hexiPH+fwT5X9B/okX/RZj/R3DXf2qvt8GtCmqab0bh+U7zXb9EvYcgCPJkXACPC/MfABIAAA==",
  "base64",
);
const PAX_DUPLICATE_TAR_GZ = Buffer.from(
  "H4sIAAAAAAAAE+2VzW6DMAzHOfcpUM6DhPAxtdKkHnvcK6RtBF5pQCRUTFXffV5XoYGqcVi2qmp+HAxWgm3Fzr8Wm53IJa2/bPimK+VZhiFZkpwtMrYsitP+/eyPYpalns9sJ3KNVhvRYPjf/mdc3J1wJErsJVmQZacgL4zevdMuwE5QJtAtGEmeyEE2GiqFi1j4HHL0rAG/jmS4cEFCugVt6KYE7CNyOt26OMckr6JbSbHFE6Ziv4a8rVptO8bU/LMsHs8/TzPP72wnco0Hn3/O/VqY4uVy/9PKFLKZ8fnQ+10dZrdO2WGR/twbyEGJ8i9iTOp/NNZ/HvPE6f9/0Ou/PEAZXLphoPnzEJ+fNP9zp9N7h8PhuDM+AC8bkxUAEAAA",
  "base64",
);
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

function packageJsonFor(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const packageJson: Record<string, unknown> = {
    name: options.packageName ?? "@xnightsky/x-agent-suite",
    version: options.packageVersion ?? "0.7.1",
    bin:
      options.packageBin === null
        ? undefined
        : (options.packageBin ?? { "x-agent-suite": "./dist/cli.js" }),
  };
  if (options.packagePrivate !== undefined) {
    packageJson.private = options.packagePrivate;
  }
  return packageJson;
}

function fixture(root: string, options: Record<string, unknown>) {
  const source = join(root, "source");
  mkdirSync(join(source, "package"), { recursive: true });
  writeFileSync(
    join(source, "package", "package.json"),
    JSON.stringify(packageJsonFor(options)),
  );
  const file = "x-agent-suite-0.7.1.tgz";
  const tarArgs = [
    "-czf",
    join(root, file),
    "-C",
    source,
    "package/package.json",
  ];
  const duplicatePackage = options.duplicatePackage;
  if (duplicatePackage !== undefined && typeof duplicatePackage === "object") {
    const duplicateSource = join(root, "duplicate-source");
    mkdirSync(join(duplicateSource, "package", "foo"), { recursive: true });
    writeFileSync(
      join(duplicateSource, "package", "package.json"),
      JSON.stringify(
        packageJsonFor(duplicatePackage as Record<string, unknown>),
      ),
    );
    tarArgs.push(
      "-C",
      duplicateSource,
      typeof options.duplicatePath === "string"
        ? options.duplicatePath
        : "package/package.json",
    );
  }
  if (Buffer.isBuffer(options.tarBytes)) {
    writeFileSync(join(root, file), options.tarBytes);
  } else {
    execFileSync("tar", tarArgs);
  }
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
  ["已废弃的无 scope 包名", { packageName: "x-agent-suite" }, /包名/],
  ["tarball 内包版本错误", { packageVersion: "0.7.2" }, /版本/],
  ["tarball 内包为 private", { packagePrivate: true }, /private/],
  ["tarball 内缺 bin", { packageBin: null }, /bin/],
] as const) {
  test(`补发拒绝${title}且不调用 npm`, unixOnly, () => {
    const result = run(options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.deepEqual(result.args, []);
  });
}

test("补发拒绝重复 package.json 及其路径别名且不调用 npm", unixOnly, () => {
  const valid = JSON.stringify(packageJsonFor({}));
  const evil = JSON.stringify(
    packageJsonFor({ packageName: "another-package" }),
  );
  for (const duplicatePath of DUPLICATE_PACKAGE_PATHS) {
    const tarBytes = rawTarGz([
      { name: "package/package.json", data: Buffer.from(valid) },
      { name: duplicatePath, data: Buffer.from(evil) },
    ]);
    const result = run({ tarBytes });
    assert.notEqual(result.status, 0, duplicatePath);
    assert.match(result.stderr, /重复.*package\/package\.json/, duplicatePath);
    assert.deepEqual(result.args, [], duplicatePath);
  }
});

test("补发拒绝 PAX 重复 path tarball 且不调用 npm", unixOnly, () => {
  const result = run({ tarBytes: PAX_DUPLICATE_TAR_GZ });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PAX.*path|path.*PAX/);
  assert.deepEqual(result.args, []);
});

test("补发拒绝 PAX size=0 隐藏 package.json 且不调用 npm", unixOnly, () => {
  const result = run({ tarBytes: PAX_SIZE_ZERO_TAR_GZ });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /重复.*package\/package\.json|size/);
  assert.deepEqual(result.args, []);
});

test("补发拒绝单零块后第二份 package.json 且不调用 npm", unixOnly, () => {
  const result = run({ tarBytes: SINGLE_ZERO_TAR_GZ });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /零块|重复.*package\/package\.json/);
  assert.deepEqual(result.args, []);
});

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
