/** Recall 报告 target 子目录安全路径段回归。 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { targetOutDir } from "../src/run.ts";

function execution(
  carrier: string,
  provider: string | undefined,
  model: string,
) {
  return {
    target: { carrier, channel: { provider, model } },
  } as never;
}

test("Recall 报告 target 目录拒绝 . / .. / 空路径分量", () => {
  const invalid: Array<[string, string | undefined, string]> = [
    [".", "provider", "model"],
    ["..", "provider", "model"],
    ["carrier", ".", "model"],
    ["carrier", "..", "model"],
    ["carrier", "provider", "."],
    ["carrier", "provider", ".."],
    ["carrier", "", "model"],
    ["carrier", "provider", ""],
  ];
  for (const [carrier, provider, model] of invalid) {
    assert.throws(
      () => targetOutDir("/base", execution(carrier, provider, model)),
      /安全|路径|非空/,
      `${carrier}/${provider}/${model}`,
    );
  }
});

test("Recall 报告 target 目录编码分隔符且保持 base 下", () => {
  const out = targetOutDir("/base", execution("a/b", "p/q", "m/n"));
  assert.equal(out, join("/base", "a%2Fb", "p%2Fq", "m%2Fn"));
  assert.ok(out.startsWith("/base/"));
});
