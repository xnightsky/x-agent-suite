/**
 * @module @x-agent-suite/assertions/tests/tool-output
 * 工具输出文本提取的公开契约测试。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractToolOutputText } from "../src/index.ts";

test("工具输出文本：按块顺序以换行拼接并忽略非文本块", () => {
  const output = {
    content: [
      { type: "text", text: "第一段" },
      { type: "image", data: "ignored" },
      { type: "text", text: "第二段" },
    ],
  };
  assert.equal(extractToolOutputText(output), "第一段\n第二段");
});

test("工具输出文本：缺 output、无可识别文本块和其他形状均返回 undefined", () => {
  for (const output of [
    undefined,
    null,
    "plain text",
    {},
    { content: [] },
    { content: [{ type: "image", data: "ignored" }] },
    { content: [{ type: "text", text: 42 }] },
  ]) {
    assert.equal(extractToolOutputText(output), undefined);
  }
});

test("工具输出文本：空文本与纯空白保留原值供判据区分", () => {
  assert.equal(
    extractToolOutputText({ content: [{ type: "text", text: "" }] }),
    "",
  );
  assert.equal(
    extractToolOutputText({ content: [{ type: "text", text: " \n\t" }] }),
    " \n\t",
  );
});
