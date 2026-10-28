/**
 * @module @x-agent-suite/sandbox/tests/sandbox
 * Sandbox 隔离环境：临时 HOME / cwd、环境剥离与注入、清理策略。
 *
 * 不变量：子进程 env 的 HOME 必须指向 sandbox homeDir；代理变量一律剥离；
 * E2E_KEEP_SANDBOX=1 时清理跳过删除并保留目录。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
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

test("createSandbox：homeDir/cwd 为物理路径，子进程 process.cwd() 与 sandbox.cwd 一致", async () => {
  // macOS 上 tmpdir() 经 /var 符号链接；子进程 getcwd 恒返回物理路径。
  // 消费者若拿 sandbox.cwd 与子进程上报的 cwd 做字符串比较（如身份展示断言），
  // 符号链接形态差会导致永不命中。sandbox 必须在创建点 canonicalize。
  const sandbox = await createSandbox();
  try {
    assert.equal(
      sandbox.cwd,
      await realpath(sandbox.cwd),
      "cwd 不含符号链接段",
    );
    assert.equal(
      sandbox.homeDir,
      await realpath(sandbox.homeDir),
      "homeDir 不含符号链接段",
    );
    const child = spawnSync(process.execPath, ["-p", "process.cwd()"], {
      cwd: sandbox.cwd,
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(
      child.stdout.trim(),
      sandbox.cwd,
      "子进程视角 cwd 必须与 sandbox.cwd 字面一致",
    );
  } finally {
    await cleanupSandbox(sandbox);
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

test("cleanupSandbox：只读目录与文件不阻碍删除", async () => {
  const sandbox = await createSandbox();
  const readonly = join(sandbox.cwd, "readonly");
  const deeper = join(readonly, "deeper");
  await mkdir(deeper, { recursive: true });
  await writeFile(join(deeper, "file.txt"), "ro");
  await chmod(join(deeper, "file.txt"), 0o444);
  await chmod(deeper, 0o555);
  await chmod(readonly, 0o555);
  await cleanupSandbox(sandbox);
  assert.ok(!existsSync(sandbox.cwd), "只读 cwd 树必须被删除");
  assert.ok(!existsSync(sandbox.homeDir), "只读 cwd 树不得拖累 homeDir 清理");
});

test("cleanupSandbox：树内符号链接只删链接，不改链接目标", async () => {
  const sandbox = await createSandbox();
  const outside = await mkdtemp(join(tmpdir(), "xas-cleanup-outside-"));
  const sentinel = join(outside, "sentinel.txt");
  await writeFile(sentinel, "keep");
  await chmod(sentinel, 0o600);
  const sentinelMode = (await stat(sentinel)).mode & 0o777;
  const outsideMode = (await stat(outside)).mode & 0o777;
  await symlink(sentinel, join(sandbox.cwd, "link-file.txt"));
  await symlink(outside, join(sandbox.cwd, "link-dir"), "junction");
  try {
    await cleanupSandbox(sandbox);
    assert.ok(!existsSync(sandbox.cwd), "含链接的 cwd 必须被删除");
    assert.equal(
      (await stat(sentinel)).mode & 0o777,
      sentinelMode,
      "链接目标文件权限不得被改写",
    );
    assert.equal(await readFile(sentinel, "utf8"), "keep");
    assert.equal(
      (await stat(outside)).mode & 0o777,
      outsideMode,
      "链接目标目录权限不得被改写",
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("cleanupSandbox：根被替换为符号链接时不触碰链接目标", async () => {
  const sandbox = await createSandbox();
  const outside = await mkdtemp(join(tmpdir(), "xas-cleanup-swap-"));
  const payload = join(outside, "payload.txt");
  await writeFile(payload, "payload");
  const outsideMode = (await stat(outside)).mode & 0o777;
  await rm(sandbox.cwd, { recursive: true, force: true });
  await symlink(outside, sandbox.cwd, "junction");
  try {
    await cleanupSandbox(sandbox);
    assert.ok(!existsSync(sandbox.cwd), "根链接本身必须被删除");
    assert.ok(existsSync(outside), "链接目标目录不得被删除");
    assert.equal(
      (await stat(outside)).mode & 0o777,
      outsideMode,
      "链接目标目录权限不得被改写",
    );
    assert.equal(await readFile(payload, "utf8"), "payload");
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
