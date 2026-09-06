/**
 * @module @x-agent-suite/harness/tests/json-seed
 * ensureJsonEntry 的回归测试：共享 JSON 配置的「读-校验-跳过」播种。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureJsonEntry } from "../src/json-seed.ts";

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "xas-json-seed-"));
}

test("ensureJsonEntry：文件不存在时创建并写入嵌套条目", async () => {
  const dir = await makeTmpDir();
  const file = join(dir, "config.json");
  await ensureJsonEntry(file, ["providers", "a"], { baseUrl: "http://x" });
  const written = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(written, { providers: { a: { baseUrl: "http://x" } } });
});

test("ensureJsonEntry：合并写入时保留既有兄弟键", async () => {
  const dir = await makeTmpDir();
  const file = join(dir, "config.json");
  await writeFile(
    file,
    JSON.stringify({ providers: { b: { keep: true } }, other: 1 }),
    "utf8",
  );
  await ensureJsonEntry(file, ["providers", "a"], { v: 2 });
  const written = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(written, {
    providers: { b: { keep: true }, a: { v: 2 } },
    other: 1,
  });
});

test("ensureJsonEntry：条目已存在且一致时跳过，不改写文件", async () => {
  const dir = await makeTmpDir();
  const file = join(dir, "config.json");
  const original = `${JSON.stringify({ a: { v: 1 } }, null, 2)}\n`;
  await writeFile(file, original, "utf8");
  await ensureJsonEntry(file, ["a"], { v: 1 });
  assert.equal(await readFile(file, "utf8"), original);
});

test("ensureJsonEntry：条目存在但不一致时显式报错，不静默覆盖", async () => {
  const dir = await makeTmpDir();
  const file = join(dir, "config.json");
  await writeFile(file, JSON.stringify({ a: { v: 1 } }), "utf8");
  await assert.rejects(ensureJsonEntry(file, ["a"], { v: 2 }), (error: unknown) => {
    assert.match((error as Error).message, /config\.json/);
    assert.match((error as Error).message, /不一致/);
    return true;
  });
  // 文件内容未被改动
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { a: { v: 1 } });
});

test("ensureJsonEntry：文件不是合法 JSON 或不是对象时显式报错", async () => {
  const dir = await makeTmpDir();
  const broken = join(dir, "broken.json");
  await writeFile(broken, "{not json", "utf8");
  await assert.rejects(ensureJsonEntry(broken, ["a"], 1), /broken\.json/);
  const array = join(dir, "array.json");
  await writeFile(array, "[1,2]", "utf8");
  await assert.rejects(ensureJsonEntry(array, ["a"], 1), /array\.json/);
});
