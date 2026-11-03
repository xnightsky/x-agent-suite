/**
 * @module scripts/tests/install-global
 * 指定制品集的全局安装回归；包管理器用 fake 注入，默认测试不修改真实全局目录。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSION = "0.7.0-dev.20261028.480de68";
const CORE = `x-agent-suite-${VERSION}.tgz`;
const PACKAGE_JSON_ALIASES = [
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
const digest = (content: string | Buffer) =>
  createHash("sha256").update(content).digest("hex");

interface FixturePackageOptions {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly bin?: Record<string, string> | null;
  readonly duplicate?: FixturePackageOptions;
  readonly duplicatePath?: string;
  readonly tarBytes?: Buffer;
}

function packageJsonFor(
  packageOptions: FixturePackageOptions,
): Record<string, unknown> {
  const packageJson: Record<string, unknown> = {
    name: packageOptions.name ?? "@xnightsky/x-agent-suite",
    version: packageOptions.version ?? VERSION,
    bin:
      packageOptions.bin === null
        ? undefined
        : (packageOptions.bin ?? { "x-agent-suite": "./dist/cli.js" }),
  };
  if (packageOptions.private !== undefined) {
    packageJson.private = packageOptions.private;
  }
  return packageJson;
}

async function fixture(packageOptions: FixturePackageOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "xas global-install-"));
  const source = join(directory, "source");
  await mkdir(join(source, "package"), { recursive: true });
  await writeFile(
    join(source, "package", "package.json"),
    JSON.stringify(packageJsonFor(packageOptions)),
  );
  if (packageOptions.tarBytes) {
    await writeFile(join(directory, CORE), packageOptions.tarBytes);
  }
  const tarArgs = [
    "-czf",
    join(directory, CORE),
    "-C",
    source,
    "package/package.json",
  ];
  if (packageOptions.duplicate) {
    const duplicateSource = join(directory, "duplicate-source");
    await mkdir(join(duplicateSource, "package", "foo"), { recursive: true });
    await writeFile(
      join(duplicateSource, "package", "package.json"),
      JSON.stringify(packageJsonFor(packageOptions.duplicate)),
    );
    tarArgs.push(
      "-C",
      duplicateSource,
      packageOptions.duplicatePath ?? "package/package.json",
    );
  }
  if (!packageOptions.tarBytes) execFileSync("tar", tarArgs);
  const coreSha = digest(await readFile(join(directory, CORE)));
  const manifest = {
    schemaVersion: 2,
    version: VERSION,
    commit: "4".repeat(40),
    dirty: false,
    mode: "snapshot",
    artifacts: [{ kind: "core", file: CORE, sha256: coreSha }],
  };
  await saveManifest(directory, manifest, coreSha);
  return { directory, manifest };
}

async function saveManifest(
  directory: string,
  manifest: object,
  coreSha?: string,
) {
  const actualCoreSha =
    coreSha ?? digest(await readFile(join(directory, CORE)));
  const content = JSON.stringify(manifest);
  await writeFile(join(directory, "manifest.json"), content);
  await writeFile(
    join(directory, "SHA256SUMS"),
    `${digest(content)}  manifest.json\n${actualCoreSha}  ${CORE}\n`,
  );
}

test("package.json 提供显式制品集的 install:global 脚本", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["install:global"], "tsx scripts/install-global.ts");
});

test("校验清单与核心校验和后只安装 core，路径可含空格且无须 PTY", async (t) => {
  const { installGlobal } = await import("../install-global.ts");
  const { directory } = await fixture();
  const calls: string[] = [];
  const logs: string[] = [];
  t.mock.method(console, "log", (message: string) => logs.push(message));
  try {
    await installGlobal(["--", directory], (file) => {
      calls.push(file);
    });
    assert.deepEqual(calls, [await realpath(join(directory, CORE))]);
    assert.ok(
      logs.some((message) =>
        message.includes(`@xnightsky/x-agent-suite@${VERSION}`),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tarball 内包名、版本、private 或 bin 不符合身份时拒绝安装", async () => {
  const { installGlobal } = await import("../install-global.ts");
  for (const [packageOptions, error] of [
    [{ name: "another-package" }, /包名/],
    [{ version: "9.9.9" }, /版本/],
    [{ private: true }, /private/],
    [{ bin: null }, /bin/],
  ] as const) {
    const { directory } = await fixture(packageOptions);
    try {
      await assert.rejects(
        installGlobal([directory], () => assert.fail("不得安装")),
        error,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("重复 package/package.json 路径别名即使首条合法也拒绝安装", async () => {
  const { installGlobal } = await import("../install-global.ts");
  for (const duplicatePath of PACKAGE_JSON_ALIASES) {
    const { directory } = await fixture({
      duplicate: { name: "evil-package", version: "9.9.9" },
      duplicatePath,
    });
    try {
      await assert.rejects(
        installGlobal([directory], () => assert.fail("不得安装")),
        /重复.*package\/package\.json/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("installGlobal 拒绝 PAX 重复 path tarball 且不调用安装回调", async () => {
  const { installGlobal } = await import("../install-global.ts");
  const { directory } = await fixture({ tarBytes: PAX_DUPLICATE_TAR_GZ });
  try {
    await assert.rejects(
      installGlobal([directory], () => assert.fail("不得安装")),
      /PAX.*path|path.*PAX/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installGlobal 拒绝 PAX size=0 隐藏 package.json 且不调用安装回调", async () => {
  const { installGlobal } = await import("../install-global.ts");
  const { directory } = await fixture({ tarBytes: PAX_SIZE_ZERO_TAR_GZ });
  try {
    await assert.rejects(
      installGlobal([directory], () => assert.fail("不得安装")),
      /重复.*package\/package\.json|size/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installGlobal 拒绝单零块后第二份 package.json 且不调用安装回调", async () => {
  const { installGlobal } = await import("../install-global.ts");
  const { directory } = await fixture({ tarBytes: SINGLE_ZERO_TAR_GZ });
  try {
    await assert.rejects(
      installGlobal([directory], () => assert.fail("不得安装")),
      /零块|重复.*package\/package\.json/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("缺参数、未知选项与多余参数在调用包管理器前失败", async () => {
  const { installGlobal } = await import("../install-global.ts");
  for (const args of [[], ["--unknown"], ["one", "two"]]) {
    await assert.rejects(
      installGlobal(args, () => assert.fail("不得安装")),
      /用法/,
    );
  }
});

test("损坏清单、dirty 和验证专用制品均拒绝，不安装或回退", async () => {
  const { installGlobal } = await import("../install-global.ts");
  for (const patch of [
    { schemaVersion: 1 },
    { dirty: true },
    { validationOnly: true },
    { version: "../escape" },
    { commit: "unknown" },
    { mode: "unknown" },
    { artifacts: [] },
    {
      artifacts: [{ kind: "core", file: "../escape", sha256: "f".repeat(64) }],
    },
  ]) {
    const { directory, manifest } = await fixture();
    try {
      await saveManifest(directory, { ...manifest, ...patch });
      await assert.rejects(
        installGlobal([directory], () => assert.fail("不得安装")),
        /清单|core|制品/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("重复 core、hash 格式错误与 core 双重 hash 不一致均拒绝", async () => {
  const { installGlobal } = await import("../install-global.ts");
  for (const change of ["duplicate", "invalid-hash", "mismatch"]) {
    const { directory, manifest } = await fixture();
    try {
      if (change === "duplicate")
        manifest.artifacts.push(manifest.artifacts[0]!);
      else
        manifest.artifacts[0]!.sha256 =
          change === "invalid-hash" ? "oops" : "0".repeat(64);
      await saveManifest(directory, manifest);
      await assert.rejects(
        installGlobal([directory], () => assert.fail("不得安装")),
        /core|SHA-256|校验和/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("manifest 或 tarball 被篡改、缺 checksum、重复及越界 checksum 项均拒绝", async () => {
  const { installGlobal } = await import("../install-global.ts");
  for (const change of [
    "manifest",
    "tarball",
    "missing",
    "duplicate",
    "traversal",
  ]) {
    const { directory } = await fixture();
    try {
      if (change === "manifest")
        await writeFile(join(directory, "manifest.json"), "{}");
      if (change === "tarball")
        await writeFile(join(directory, CORE), "tampered");
      if (change === "missing")
        await writeFile(join(directory, "SHA256SUMS"), "");
      if (change === "duplicate" || change === "traversal") {
        const sums = await readFile(join(directory, "SHA256SUMS"), "utf8");
        await writeFile(
          join(directory, "SHA256SUMS"),
          sums +
            `${digest("x")}  ${change === "duplicate" ? CORE : "../escape"}\n`,
        );
      }
      await assert.rejects(
        installGlobal([directory], () => assert.fail("不得安装")),
        /校验和|SHA256SUMS/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test(
  "拒绝通过 tarball 符号链接逃出制品目录",
  { skip: process.platform === "win32" },
  async () => {
    const { installGlobal } = await import("../install-global.ts");
    const { directory } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "xas-outside-"));
    try {
      await writeFile(join(outside, CORE), "core fixture");
      await rm(join(directory, CORE));
      await symlink(join(outside, CORE), join(directory, CORE));
      await assert.rejects(
        installGlobal([directory], () => assert.fail("不得安装")),
        /制品目录/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  },
);

test("包管理器失败原样传播，不打印或返回安装成功", async () => {
  const { installGlobal } = await import("../install-global.ts");
  const { directory } = await fixture();
  const failure = new Error("fake global installation failed");
  try {
    await assert.rejects(
      installGlobal([directory], () => {
        throw failure;
      }),
      (error) => error === failure,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
