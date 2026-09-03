/**
 * @module scripts/tests/test-layering
 * 测试分层契约：规则、脚本和规范文档必须使用同一套分类口径。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");

test("测试分层规则覆盖 unit、integration 与 token integration", async () => {
  const agents = await readFile(resolve(ROOT, "AGENTS.md"), "utf8");
  const spec = await readFile(resolve(ROOT, "docs/spec/testing.md"), "utf8");

  for (const document of [agents, spec]) {
    assert.match(document, /\*\.test\.ts/);
    assert.match(document, /\*\.ittest\.ts/);
    assert.match(document, /\*\.token\.ittest\.ts/);
    assert.match(document, /不看是否起子进程|不是.*是否起子进程/);
    assert.match(document, /真实宿主 CLI/);
    assert.match(document, /真实 provider/);
  }
  assert.match(spec, /平铺/);
  assert.match(spec, /可选.*tests\/token|tests\/token.*可选/);
  assert.doesNotMatch(spec, /必须.*tests\/token|tests\/token.*必须/);
  assert.match(spec, /不进.*pnpm test.*pnpm itest.*pnpm check/s);
});

test("默认回归包含零 token 集成测试且 token 只有精确入口", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  const checkScript = packageJson.scripts.check;
  const testScript = packageJson.scripts.test;
  const itestRunner = await readFile(
    resolve(ROOT, "scripts/run-itests.ts"),
    "utf8",
  );
  assert.equal(packageJson.scripts.itest, "tsx scripts/run-itests.ts");
  assert.ok(checkScript);
  assert.ok(testScript);
  assert.match(checkScript, /pnpm itest/);
  assert.doesNotMatch(testScript, /ittest/);
  assert.match(itestRunner, /!entry\.name\.endsWith\("\.token\.ittest\.ts"\)/);
  assert.equal("itest:token" in packageJson.scripts, false);
  assert.equal(
    packageJson.scripts["itest:token:tutorial"],
    "tsx --test examples/tutorial/10-live-smoke.token.ittest.ts",
  );
});
