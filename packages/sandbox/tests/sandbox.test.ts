/**
 * @module @x-agent-suite/sandbox/tests/sandbox
 * Sandbox 隔离环境：临时 HOME / cwd、环境剥离与注入、清理策略。
 *
 * 不变量：子进程 env 的 HOME 必须指向 sandbox homeDir；代理变量一律剥离；
 * E2E_KEEP_SANDBOX=1 时清理跳过删除并保留目录。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSandbox, cleanupSandbox } from "../src/index.ts";

test("createSandbox：homeDir/cwd 存在且互不相同", async () => {
  const a = await createSandbox();
  const b = await createSandbox();
  try {
    assert.ok(existsSync(a.homeDir));
    assert.ok(existsSync(a.cwd));
    assert.notEqual(a.homeDir, a.cwd);
    assert.notEqual(a.homeDir, b.homeDir);
    assert.notEqual(a.cwd, b.cwd);
    assert.ok(a.id.length > 0);
  } finally {
    await cleanupSandbox(a);
    await cleanupSandbox(b);
  }
});

test("createSandbox：env.HOME 指向 homeDir，win32 注入 USERPROFILE/APPDATA/LOCALAPPDATA", async () => {
  const sandbox = await createSandbox();
  try {
    assert.equal(sandbox.env.HOME, sandbox.homeDir);
    if (process.platform === "win32") {
      assert.equal(sandbox.env.USERPROFILE, sandbox.homeDir);
      assert.equal(
        sandbox.env.APPDATA,
        join(sandbox.homeDir, "AppData", "Roaming"),
      );
      assert.equal(
        sandbox.env.LOCALAPPDATA,
        join(sandbox.homeDir, "AppData", "Local"),
      );
    }
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("createSandbox：代理变量一律剥离，stripEnv 声明的变量不出现", async () => {
  const savedProxy = process.env.http_proxy;
  const savedStrip = process.env.XAS_TEST_STRIP_ME;
  process.env.http_proxy = "http://127.0.0.1:9";
  process.env.XAS_TEST_STRIP_ME = "secret";
  try {
    const sandbox = await createSandbox({ stripEnv: ["XAS_TEST_STRIP_ME"] });
    try {
      assert.equal(sandbox.env.http_proxy, undefined);
      assert.equal(sandbox.env.https_proxy, undefined);
      assert.equal(sandbox.env.HTTP_PROXY, undefined);
      assert.equal(sandbox.env.HTTPS_PROXY, undefined);
      assert.equal(sandbox.env.all_proxy, undefined);
      assert.equal(sandbox.env.ALL_PROXY, undefined);
      assert.equal(sandbox.env.XAS_TEST_STRIP_ME, undefined);
    } finally {
      await cleanupSandbox(sandbox);
    }
  } finally {
    if (savedProxy === undefined) delete process.env.http_proxy;
    else process.env.http_proxy = savedProxy;
    if (savedStrip === undefined) delete process.env.XAS_TEST_STRIP_ME;
    else process.env.XAS_TEST_STRIP_ME = savedStrip;
  }
});

test("createSandbox：env 注入合并进子进程环境", async () => {
  const sandbox = await createSandbox({
    env: { FAKE_BASE_URL: "http://127.0.0.1:1234/v1", FAKE_API_KEY: "dummy" },
  });
  try {
    assert.equal(sandbox.env.FAKE_BASE_URL, "http://127.0.0.1:1234/v1");
    assert.equal(sandbox.env.FAKE_API_KEY, "dummy");
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("createSandbox：env 注入不能覆盖 HOME、代理剥离与 stripEnv", async () => {
  const sandbox = await createSandbox({
    stripEnv: ["XAS_TEST_PROTECTED"],
    env: {
      HOME: "outside-home",
      http_proxy: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      XAS_TEST_PROTECTED: "secret",
    },
  });
  try {
    assert.equal(sandbox.env.HOME, sandbox.homeDir);
    assert.equal(sandbox.env.http_proxy, undefined);
    assert.equal(sandbox.env.HTTPS_PROXY, undefined);
    assert.equal(sandbox.env.XAS_TEST_PROTECTED, undefined);
  } finally {
    await cleanupSandbox(sandbox);
  }
});

test("createSandbox：按需创建 configDirs / runtimeDir / configFilePath", async () => {
  const sandbox = await createSandbox({
    configDirs: ["config-a", "config-b"],
    runtimeDir: true,
    configFile: true,
  });
  try {
    assert.ok(sandbox.configDirs);
    assert.ok(
      sandbox.configDirs!["config-a"] &&
        existsSync(sandbox.configDirs!["config-a"]),
    );
    assert.ok(
      sandbox.configDirs!["config-b"] &&
        existsSync(sandbox.configDirs!["config-b"]),
    );
    assert.ok(sandbox.runtimeDir && existsSync(sandbox.runtimeDir));
    assert.ok(sandbox.configFilePath && existsSync(sandbox.configFilePath));
  } finally {
    await cleanupSandbox(sandbox);
  }

  const plain = await createSandbox();
  try {
    assert.equal(plain.configDirs, undefined);
    assert.equal(plain.runtimeDir, undefined);
    assert.equal(plain.configFilePath, undefined);
  } finally {
    await cleanupSandbox(plain);
  }
});

test("createSandbox：拒绝可逃逸或跨平台非法的 configDirs 路径段", async () => {
  const escapeName = `xas-sandbox-escape-${Date.now()}`;
  const outside = join(tmpdir(), escapeName);
  const invalid = [
    "..",
    ".",
    `../${escapeName}`,
    "..\\escape",
    "/absolute",
    "C:\\absolute",
    "bad\0name",
  ];
  try {
    for (const name of invalid) {
      const attempt = createSandbox({ configDirs: [name] }).then(
        async (sandbox) => {
          await cleanupSandbox(sandbox);
          throw new Error(`接受了非法 configDirs：${name}`);
        },
      );
      await assert.rejects(attempt, /configDirs.*安全路径段/);
    }
    assert.equal(existsSync(outside), false, "不得在 sandbox home 外创建目录");
    const safe = await createSandbox({ configDirs: ["..safe"] });
    try {
      assert.ok(existsSync(safe.configDirs!["..safe"]!));
    } finally {
      await cleanupSandbox(safe);
    }
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("cleanupSandbox：默认删除全部临时目录", async () => {
  const sandbox = await createSandbox({
    configDirs: ["config-a", "config-b"],
    runtimeDir: true,
    configFile: true,
  });
  const dirs = [
    sandbox.homeDir,
    sandbox.cwd,
    sandbox.configDirs!["config-a"]!,
    sandbox.configDirs!["config-b"]!,
    sandbox.runtimeDir!,
  ];
  await cleanupSandbox(sandbox);
  for (const dir of dirs) {
    assert.ok(!existsSync(dir), `${dir} 应被删除`);
  }
});

test("cleanupSandbox：E2E_KEEP_SANDBOX=1 时保留目录", async () => {
  const sandbox = await createSandbox();
  const saved = process.env.E2E_KEEP_SANDBOX;
  process.env.E2E_KEEP_SANDBOX = "1";
  try {
    await cleanupSandbox(sandbox);
    assert.ok(existsSync(sandbox.homeDir), "保留模式下 homeDir 不应被删除");
    assert.ok(existsSync(sandbox.cwd), "保留模式下 cwd 不应被删除");
  } finally {
    if (saved === undefined) delete process.env.E2E_KEEP_SANDBOX;
    else process.env.E2E_KEEP_SANDBOX = saved;
    await rm(sandbox.homeDir, { recursive: true, force: true });
    await rm(sandbox.cwd, { recursive: true, force: true });
  }
});
