/**
 * @module scripts/tests/install-global
 * 指定制品集的全局安装回归；包管理器用 fake 注入，默认测试不修改真实全局目录。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
const digest = (content: string) =>
  createHash("sha256").update(content).digest("hex");

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "xas global-install-"));
  const manifest = {
    schemaVersion: 2,
    version: VERSION,
    commit: "4".repeat(40),
    dirty: false,
    mode: "snapshot",
    artifacts: [{ kind: "core", file: CORE, sha256: digest("core fixture") }],
  };
  await writeFile(join(directory, CORE), "core fixture");
  await saveManifest(directory, manifest);
  return { directory, manifest };
}

async function saveManifest(directory: string, manifest: object) {
  const content = JSON.stringify(manifest);
  await writeFile(join(directory, "manifest.json"), content);
  await writeFile(
    join(directory, "SHA256SUMS"),
    `${digest(content)}  manifest.json\n${digest("core fixture")}  ${CORE}\n`,
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
