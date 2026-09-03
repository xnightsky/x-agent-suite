/**
 * @module @x-agent-suite/harness/tests/plugin-install
 * installKimiPlugins 单测：过滤拷贝、注册表落盘、符号链接解引用与入口缺失显式失败。
 * 不变量（对应 plugin-install.ts 模块头）：
 * - 托管副本内不得出现 .git / node_modules / tmp / .pnpm-store —— 真实 `/plugins install`
 *   不过滤导致隔离被击穿，本层必须挡住；
 * - 符号链接一律解引用，托管副本不得留下指回源码仓的链接；
 * - 清单声明的入口在副本中不存在时显式抛错，不静默装出跑不起来的插件。
 */
import assert from "node:assert/strict";
import { existsSync, lstatSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installKimiPlugins } from "../src/plugin-install.ts";

/** 一个最小可用的插件源码目录；返回其绝对路径。 */
async function makePluginSource(
  options: { manifest?: unknown; withDist?: boolean } = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xas-plugin-src-"));
  const manifest = options.manifest ?? {
    name: "kimi-intercom",
    hooks: [{ event: "Stop", command: "node ./dist/kimi-hook.js" }],
    mcpServers: {
      "kimi-intercom": { command: "node", args: ["./dist/mcp-server.js"] },
    },
  };
  await writeFile(
    join(dir, "kimi.plugin.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  if (options.withDist !== false) {
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "dist", "kimi-hook.js"), "// hook\n", "utf8");
    await writeFile(join(dir, "dist", "mcp-server.js"), "// mcp\n", "utf8");
  }
  return dir;
}

/** 创建沙箱 kimiHome 占位目录。 */
function makeKimiHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "xas-kimi-home-"));
}

test("installKimiPlugins：装入 managed 目录并写 installed.json 注册表", async () => {
  const source = await makePluginSource();
  const kimiHome = await makeKimiHome();
  try {
    const [installed] = await installKimiPlugins(kimiHome, [
      { sourceDir: source },
    ]);

    assert.equal(installed!.id, "kimi-intercom");
    assert.equal(
      installed!.root,
      join(kimiHome, "plugins", "managed", "kimi-intercom"),
    );
    assert.ok(existsSync(join(installed!.root, "kimi.plugin.json")));
    assert.ok(existsSync(join(installed!.root, "dist", "mcp-server.js")));
    assert.deepEqual(installed!.mcpServers, ["kimi-intercom"]);
    assert.deepEqual(installed!.hookCommands, ["node ./dist/kimi-hook.js"]);

    const registry = JSON.parse(
      await readFile(join(kimiHome, "plugins", "installed.json"), "utf8"),
    ) as {
      version: number;
      plugins: { id: string; root: string; enabled: boolean; source: string }[];
    };
    assert.equal(registry.version, 1);
    assert.equal(registry.plugins.length, 1);
    assert.equal(registry.plugins[0]!.id, "kimi-intercom");
    assert.equal(registry.plugins[0]!.root, installed!.root);
    assert.equal(registry.plugins[0]!.enabled, true);
    assert.equal(registry.plugins[0]!.source, "local-path");
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("installKimiPlugins：--import 的模块参数不是入口，仍校验显式相对文件", async () => {
  const source = await makePluginSource({
    manifest: {
      name: "kimi-intercom",
      hooks: [
        {
          event: "SessionStart",
          command: "node --import tsx/esm ./src/hooks/entry.ts",
        },
      ],
      mcpServers: {
        "kimi-intercom": {
          command: "node",
          args: ["--import", "tsx", "./src/mcp/server.ts"],
        },
      },
    },
  });
  const kimiHome = await makeKimiHome();
  try {
    await mkdir(join(source, "src", "hooks"), { recursive: true });
    await mkdir(join(source, "src", "mcp"), { recursive: true });
    await writeFile(
      join(source, "src", "hooks", "entry.ts"),
      "export {};\n",
      "utf8",
    );
    await writeFile(
      join(source, "src", "mcp", "server.ts"),
      "export {};\n",
      "utf8",
    );

    const [installed] = await installKimiPlugins(kimiHome, [
      { sourceDir: source },
    ]);
    assert.ok(existsSync(join(installed!.root, "src", "hooks", "entry.ts")));
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("installKimiPlugins：校验 --flag= 内嵌入口，不能用 --import 绕过托管根", async () => {
  const kimiHome = await makeKimiHome();
  const absolute = await makePluginSource({
    manifest: {
      name: "flag-absolute",
      hooks: [
        {
          command: `node --import=${join(tmpdir(), "outside.js")} ./dist/kimi-hook.js`,
        },
      ],
    },
  });
  const traversal = await makePluginSource({
    manifest: {
      name: "flag-traversal",
      hooks: [{ command: "node --import=../outside.js ./dist/kimi-hook.js" }],
    },
  });
  const quotedAbsolute = await makePluginSource({
    manifest: {
      name: "flag-quoted-absolute",
      hooks: [
        {
          command: `node --import="${join(tmpdir(), "outside file.js")}" ./dist/kimi-hook.js`,
        },
      ],
    },
  });
  const missing = await makePluginSource({
    manifest: {
      name: "flag-missing",
      hooks: [
        { command: "node --import=./dist/preload.js ./dist/kimi-hook.js" },
      ],
    },
  });
  try {
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: absolute }]),
      /入口必须位于插件根/,
    );
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: traversal }]),
      /入口必须位于插件根/,
    );
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: quotedAbsolute }]),
      /入口必须位于插件根/,
    );
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: missing }]),
      /入口.*不存在/,
    );
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
    await rm(absolute, { recursive: true, force: true });
    await rm(traversal, { recursive: true, force: true });
    await rm(quotedAbsolute, { recursive: true, force: true });
    await rm(missing, { recursive: true, force: true });
  }
});

test("installKimiPlugins：校验不带 ./ 的 path-like 相对入口", async () => {
  const kimiHome = await makeKimiHome();
  const missing = await makePluginSource({
    manifest: {
      name: "bare-relative-missing",
      hooks: [{ command: "node dist/missing.js" }],
    },
  });
  const traversal = await makePluginSource({
    manifest: {
      name: "bare-relative-traversal",
      hooks: [{ command: "node dist/../../outside.js" }],
    },
  });
  const valid = await makePluginSource({
    manifest: {
      name: "bare-relative-valid",
      hooks: [{ command: "node dist/kimi-hook.js" }],
    },
  });
  try {
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: missing }]),
      /入口.*不存在/,
    );
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: traversal }]),
      /入口必须位于插件根/,
    );
    const [installed] = await installKimiPlugins(kimiHome, [
      { sourceDir: valid },
    ]);
    assert.ok(existsSync(join(installed!.root, "dist", "kimi-hook.js")));
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
    await rm(missing, { recursive: true, force: true });
    await rm(traversal, { recursive: true, force: true });
    await rm(valid, { recursive: true, force: true });
  }
});

test("installKimiPlugins：命令首 token 为相对入口时同样校验", async () => {
  const kimiHome = await makeKimiHome();
  const missing = await makePluginSource({
    manifest: {
      name: "first-token-missing",
      hooks: [{ command: "./bin/server" }],
    },
  });
  const traversal = await makePluginSource({
    manifest: {
      name: "first-token-traversal",
      hooks: [{ command: "../outside" }],
    },
  });
  try {
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: missing }]),
      /入口.*不存在/,
    );
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: traversal }]),
      /入口必须位于插件根/,
    );
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
    await rm(missing, { recursive: true, force: true });
    await rm(traversal, { recursive: true, force: true });
  }
});

test("installKimiPlugins：拒绝 ../ 与绝对入口逃逸插件根", async () => {
  const kimiHome = await makeKimiHome();
  const traversal = await makePluginSource({
    manifest: { name: "traversal", hooks: [{ command: "node ../outside.js" }] },
  });
  const absolute = await makePluginSource({
    manifest: {
      name: "absolute",
      hooks: [{ command: `node ${join(tmpdir(), "outside.js")}` }],
    },
  });
  const quoted = await makePluginSource({
    manifest: { name: "quoted", hooks: [{ command: 'node "../outside.js"' }] },
  });
  try {
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: traversal }]),
      /入口必须位于插件根/,
    );
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: absolute }]),
      /入口必须位于插件根/,
    );
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: quoted }]),
      /入口必须位于插件根/,
    );
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
    await rm(traversal, { recursive: true, force: true });
    await rm(absolute, { recursive: true, force: true });
    await rm(quoted, { recursive: true, force: true });
  }
});

test("installKimiPlugins：入口带尾随参数仍校验，嵌套 traversal 仍拒绝", async () => {
  const kimiHome = await makeKimiHome();
  const missingWithFlag = await makePluginSource({
    manifest: {
      name: "missing-with-flag",
      hooks: [{ command: "node ./dist/missing.js --stdio" }],
    },
  });
  const nestedTraversal = await makePluginSource({
    manifest: {
      name: "nested-traversal",
      hooks: [{ command: "node ./dist/../../outside.js --stdio" }],
    },
  });
  const absoluteWithFlag = await makePluginSource({
    manifest: {
      name: "absolute-with-flag",
      hooks: [{ command: `node ${join(tmpdir(), "outside.js")} --stdio` }],
    },
  });
  try {
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: missingWithFlag }]),
      /入口.*不存在/,
    );
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: nestedTraversal }]),
      /入口必须位于插件根/,
    );
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: absoluteWithFlag }]),
      /入口必须位于插件根/,
    );
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
    await rm(missingWithFlag, { recursive: true, force: true });
    await rm(nestedTraversal, { recursive: true, force: true });
    await rm(absoluteWithFlag, { recursive: true, force: true });
  }
});

test("installKimiPlugins：拒绝 manifest name 与显式 id 逃逸 managed 根", async () => {
  const kimiHome = await makeKimiHome();
  const unsafeManifest = await makePluginSource({
    manifest: {
      name: "../escaped",
      hooks: [{ command: "node ./dist/kimi-hook.js" }],
    },
  });
  const safeManifest = await makePluginSource();
  try {
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: unsafeManifest }]),
      /插件 id 非法/,
    );
    await assert.rejects(
      () =>
        installKimiPlugins(kimiHome, [
          { sourceDir: safeManifest, id: "../../escaped" },
        ]),
      /插件 id 非法/,
    );
    await assert.rejects(
      () =>
        installKimiPlugins(kimiHome, [
          { sourceDir: safeManifest, id: join(tmpdir(), "escaped") },
        ]),
      /插件 id 非法/,
    );
    assert.equal(existsSync(join(kimiHome, "escaped")), false);
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
    await rm(unsafeManifest, { recursive: true, force: true });
    await rm(safeManifest, { recursive: true, force: true });
  }
});

test("installKimiPlugins：过滤 .git/node_modules/tmp/.pnpm-store，不把源码仓垃圾带进托管副本", async () => {
  const source = await makePluginSource();
  const kimiHome = await makeKimiHome();
  try {
    for (const name of [".git", "node_modules", "tmp", ".pnpm-store"]) {
      await mkdir(join(source, name), { recursive: true });
      await writeFile(join(source, name, "marker.txt"), name, "utf8");
    }
    await mkdir(join(source, "src"), { recursive: true });
    await writeFile(join(source, "src", "keep.ts"), "// keep\n", "utf8");

    const [installed] = await installKimiPlugins(kimiHome, [
      { sourceDir: source },
    ]);

    for (const name of [".git", "node_modules", "tmp", ".pnpm-store"]) {
      assert.equal(
        existsSync(join(installed!.root, name)),
        false,
        `${name} 不应进入托管副本`,
      );
    }
    assert.ok(
      existsSync(join(installed!.root, "src", "keep.ts")),
      "未被排除的目录应正常拷贝",
    );
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("installKimiPlugins：exclude 追加项生效，且与默认清单合并而非替换", async () => {
  const source = await makePluginSource();
  const kimiHome = await makeKimiHome();
  try {
    await mkdir(join(source, "docs"), { recursive: true });
    await writeFile(join(source, "docs", "a.md"), "doc\n", "utf8");
    await mkdir(join(source, ".git"), { recursive: true });
    await writeFile(join(source, ".git", "HEAD"), "ref\n", "utf8");

    const [installed] = await installKimiPlugins(kimiHome, [
      { sourceDir: source, exclude: ["docs"] },
    ]);

    assert.equal(
      existsSync(join(installed!.root, "docs")),
      false,
      "追加排除项应生效",
    );
    assert.equal(
      existsSync(join(installed!.root, ".git")),
      false,
      "默认排除项不应被覆盖",
    );
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("installKimiPlugins：符号链接解引用为实体，副本内不残留链接", async () => {
  const source = await makePluginSource();
  const kimiHome = await makeKimiHome();
  const linkTarget = await mkdtemp(join(tmpdir(), "xas-link-target-"));
  try {
    await writeFile(join(linkTarget, "payload.txt"), "real\n", "utf8");
    await mkdir(join(source, "vendor"), { recursive: true });
    try {
      await symlink(linkTarget, join(source, "vendor", "linked"), "junction");
    } catch {
      // 无权限创建链接的环境跳过本用例（win32 非管理员）。
      return;
    }

    const [installed] = await installKimiPlugins(kimiHome, [
      { sourceDir: source },
    ]);
    const copied = join(installed!.root, "vendor", "linked");

    assert.ok(existsSync(join(copied, "payload.txt")), "链接目标内容应被拷入");
    assert.equal(
      lstatSync(copied).isSymbolicLink(),
      false,
      "副本中不应残留符号链接",
    );
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(kimiHome, { recursive: true, force: true });
    await rm(linkTarget, { recursive: true, force: true });
  }
});

test("installKimiPlugins：清单声明的入口在副本中缺失时显式抛错", async () => {
  const source = await makePluginSource({ withDist: false });
  const kimiHome = await makeKimiHome();
  try {
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: source }]),
      /入口在托管副本中不存在.*dist[\\/]kimi-hook\.js/s,
    );
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("installKimiPlugins：入口被 exclude 过滤掉时同样抛错（防止装出跑不起来的插件）", async () => {
  const source = await makePluginSource();
  const kimiHome = await makeKimiHome();
  try {
    await assert.rejects(
      () =>
        installKimiPlugins(kimiHome, [
          { sourceDir: source, exclude: ["dist"] },
        ]),
      /入口在托管副本中不存在/,
    );
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(kimiHome, { recursive: true, force: true });
  }
});

test("installKimiPlugins：清单缺失或非法 JSON 显式抛错", async () => {
  const kimiHome = await makeKimiHome();
  const empty = await mkdtemp(join(tmpdir(), "xas-plugin-empty-"));
  const broken = await mkdtemp(join(tmpdir(), "xas-plugin-broken-"));
  try {
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: empty }]),
      /读不到插件清单/,
    );

    await writeFile(join(broken, "kimi.plugin.json"), "{ not json", "utf8");
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: broken }]),
      /不是合法 JSON/,
    );
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
    await rm(broken, { recursive: true, force: true });
  }
});

test("installKimiPlugins：清单无 name 且未传 id 时抛错；显式 id 覆盖清单 name", async () => {
  const kimiHome = await makeKimiHome();
  const anonymous = await makePluginSource({ manifest: { hooks: [] } });
  try {
    await assert.rejects(
      () => installKimiPlugins(kimiHome, [{ sourceDir: anonymous }]),
      /缺少 name/,
    );

    const [installed] = await installKimiPlugins(kimiHome, [
      { sourceDir: anonymous, id: "explicit-id" },
    ]);
    assert.equal(installed!.id, "explicit-id");
    assert.equal(
      installed!.root,
      join(kimiHome, "plugins", "managed", "explicit-id"),
    );
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
    await rm(anonymous, { recursive: true, force: true });
  }
});

test("installKimiPlugins：多插件按序安装，注册表含全部条目", async () => {
  const kimiHome = await makeKimiHome();
  const a = await makePluginSource({ manifest: { name: "plugin-a" } });
  const b = await makePluginSource({ manifest: { name: "plugin-b" } });
  try {
    const installed = await installKimiPlugins(kimiHome, [
      { sourceDir: a },
      { sourceDir: b },
    ]);
    assert.deepEqual(
      installed.map((p) => p.id),
      ["plugin-a", "plugin-b"],
    );

    const registry = JSON.parse(
      await readFile(join(kimiHome, "plugins", "installed.json"), "utf8"),
    ) as {
      plugins: { id: string; originalSource: string }[];
    };
    assert.deepEqual(
      registry.plugins.map((p) => p.id),
      ["plugin-a", "plugin-b"],
    );
    assert.equal(registry.plugins[0]!.originalSource, a);
  } finally {
    await rm(kimiHome, { recursive: true, force: true });
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});
