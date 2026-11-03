/**
 * @module scripts/tests/aggregate-driver-exports
 * 聚合 driver 子路径与 workspace source entry 的运行时/类型导出契约。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonRpcPeer,
  LongLivedJsonRpcDriver,
  type JsonRpcLongLivedAdapter,
  type JsonRpcPeerOptions,
  type NotificationMapping,
} from "../../packaging/entries/driver.ts";

/** 仅编译期使用的类型烟测；运行时不构造 adapter。 */
function typeSmoke(
  _options: JsonRpcPeerOptions,
  _adapter: JsonRpcLongLivedAdapter,
  _mapping: NotificationMapping,
): void {}

test("聚合 driver 入口覆盖除 PTY 专用符号外的全部 source 运行时导出", async () => {
  const source = await import("../../packages/driver/src/index.ts");
  const aggregate = await import("../../packaging/entries/driver.ts");
  const ptyOnly = new Set(["PtyProcess", "createPtyScreen"]);
  const expected = Object.keys(source)
    .filter((name) => !ptyOnly.has(name))
    .sort();

  assert.deepEqual(Object.keys(aggregate).sort(), expected);
  assert.equal(typeof JsonRpcPeer, "function");
  assert.equal(typeof LongLivedJsonRpcDriver, "function");
  assert.equal(typeof typeSmoke, "function");
  assert.equal("PtyProcess" in aggregate, false);
  assert.equal("createPtyScreen" in aggregate, false);
});
