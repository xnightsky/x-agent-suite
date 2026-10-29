/**
 * @module scripts/tests/artifacts-tarball
 * 用真实 pnpm 打包验证 scoped 主包的附件命名。
 * 不变量：只创建本地 tarball，不安装依赖、不访问 registry、不执行发布。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("scoped 主包保留既有 Release 附件名，tarball 内包名不丢失 scope", async () => {
  const module = await import("../artifacts-build.ts");
  const pack = Reflect.get(module, "packPackage") as (
    stage: string,
    destination: string,
    file: string,
  ) => Promise<void>;
  assert.equal(typeof pack, "function");
  const root = await mkdtemp(join(tmpdir(), "xas-scoped-pack-"));
  const version = "0.7.2";
  const file = `x-agent-suite-${version}.tgz`;
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "@xnightsky/x-agent-suite", version }),
    );
    await pack(root, join(root, "output"), file);
    assert.deepEqual(await readdir(join(root, "output")), [file]);
    assert.ok((await readFile(join(root, "output", file))).length > 0);
    const manifest = JSON.parse(
      execFileSync(
        "tar",
        ["-xOf", join(root, "output", file), "package/package.json"],
        {
          encoding: "utf8",
        },
      ),
    );
    assert.equal(manifest.name, "@xnightsky/x-agent-suite");
    assert.equal(manifest.version, version);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
