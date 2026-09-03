/**
 * @module scripts/tests/artifacts-version
 * Git history 驱动的制品版本推导回归。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExpectedVersion,
  inferNextVersion,
  type CommitMessage,
} from "../artifacts-version.ts";

function commit(subject: string, body = ""): CommitMessage {
  return { subject, body };
}

test("无历史 tag 时首次可交付基线为 0.1.0", () => {
  assert.equal(
    inferNextVersion(null, [commit("feat: 实现聚合制品打包")]),
    "0.1.0",
  );
});

test("0.x 阶段 fix 递增 PATCH", () => {
  assert.equal(
    inferNextVersion("0.1.0", [commit("fix: 修复制品清单")]),
    "0.1.1",
  );
});

test("0.x 阶段 feat 和 breaking 均递增 MINOR", () => {
  assert.equal(
    inferNextVersion("0.1.1", [commit("feat: 支持 snapshot")]),
    "0.2.0",
  );
  assert.equal(
    inferNextVersion("0.2.0", [
      commit("fix!: 调整制品契约"),
      commit("fix: 普通修复"),
    ]),
    "0.3.0",
  );
});

test("1.x 阶段遵循标准 major/minor/patch", () => {
  assert.equal(
    inferNextVersion("1.4.2", [
      commit("feat: 新能力", "BREAKING CHANGE: 删除旧入口"),
    ]),
    "2.0.0",
  );
  assert.equal(inferNextVersion("1.4.2", [commit("feat: 新能力")]), "1.5.0");
});

test("纯 docs/style/test/chore 不单独形成版本", () => {
  assert.equal(
    inferNextVersion("0.1.0", [
      commit("docs: 补充说明"),
      commit("style: 格式化"),
      commit("test: 增加覆盖"),
      commit("chore: 调整工具"),
    ]),
    null,
  );
});

test("显式 --version 只校验自动推导结果", () => {
  assert.doesNotThrow(() => assertExpectedVersion("0.2.0", "0.2.0"));
  assert.throws(
    () => assertExpectedVersion("0.2.0", "0.1.9"),
    /期望版本 0\.1\.9 与 Git history 推导版本 0\.2\.0 不一致/,
  );
});
