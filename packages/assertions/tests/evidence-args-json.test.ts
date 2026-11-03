/** evidence toolResult.args 复用 JSON-safe 语义的回归。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evidence } from "../src/index.ts";
import { evaluateSync, makeContext } from "./support.ts";
import { readCall, workspaceTurn } from "./evidence-support.ts";

test("evidence args：对象键序无关、数组元素对象也按 JSON 相等比较", () => {
  const call = {
    ...readCall("docs/a.md"),
    input: { files: [{ b: 2, a: 1 }], extra: true },
  };
  const result = evaluateSync(
    evidence,
    workspaceTurn("", [call]),
    makeContext({
      toolResult: {
        tool: "read",
        args: { files: [{ a: 1, b: 2 }] },
      },
    }),
  );
  assert.equal(result.pass, true, result.reason);
});

test("evidence args：继承属性不满足 own-property 子集", () => {
  const inherited = Object.create({ path: "docs/a.md" }) as Record<
    string,
    unknown
  >;
  inherited.other = true;
  const result = evaluateSync(
    evidence,
    workspaceTurn("", [{ ...readCall("docs/a.md"), input: inherited }]),
    makeContext({ toolResult: { tool: "read", args: { path: "docs/a.md" } } }),
  );
  assert.equal(result.pass, false);
});

test("evidence args：对象/数组类型错配及非 JSON 期望值拒绝", () => {
  const mismatch = evaluateSync(
    evidence,
    workspaceTurn("", [{ ...readCall("docs/a.md"), input: { a: ["x"] } }]),
    makeContext({ toolResult: { tool: "read", args: { a: { 0: "x" } } } }),
  );
  assert.equal(mismatch.pass, false);

  for (const args of [
    { x: Number.NaN },
    { x: Number.POSITIVE_INFINITY },
    { x: undefined },
  ]) {
    assert.throws(
      () =>
        evaluateSync(
          evidence,
          workspaceTurn("", [readCall("docs/a.md")]),
          makeContext({ toolResult: { tool: "read", args } }),
        ),
      /args|JSON|有限/,
    );
  }
});
