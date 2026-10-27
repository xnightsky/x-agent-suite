/**
 * @module scripts/tests/pi-token-ittest
 * Pi token 入口参数契约：完整目标经启动器传递，非法参数不得静默忽略。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  PI_TOKEN_MODEL_ENV,
  parsePiTokenArgs,
} from "../run-pi-token-ittest.ts";

test("Pi token 启动器解析可选模型并拒绝无效尾部参数", () => {
  assert.equal(PI_TOKEN_MODEL_ENV, "XAS_TUTORIAL_LIVE_MODEL");
  assert.equal(parsePiTokenArgs([]), undefined);
  assert.equal(
    parsePiTokenArgs(["--model", "co/default/glm5-3-flash"]),
    "co/default/glm5-3-flash",
  );
  assert.equal(
    parsePiTokenArgs(["--", "--model", "co/default/glm5-3-flash"]),
    "co/default/glm5-3-flash",
  );
  assert.throws(() => parsePiTokenArgs(["--model"]), /用法/);
  assert.throws(() => parsePiTokenArgs(["--model", "--other"]), /用法/);
  assert.throws(
    () => parsePiTokenArgs(["--model", "a", "--model", "b"]),
    /用法/,
  );
  assert.throws(() => parsePiTokenArgs(["--unknown"]), /用法/);
});
