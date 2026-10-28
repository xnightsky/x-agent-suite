/**
 * @module @x-agent-suite/assertions/tests/judge-assertion
 * AI 断言单元测试：fake 裁判客户端驱动，零 token、零网络。
 * 不变量：
 * - rubric 清单来自该轮 expect，判据配置不持有全局 rubric；
 * - 整体不可评测与 rubric 缺证据都显式抛错，绝不伪造成 0 分或 false；
 * - 只有模型明确给出的 false 才映射为 pass=false / score=0。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { JudgeModelClient } from "@x-agent-suite/judge";
import { createJudgeAssertion } from "../src/index.ts";
import { makeContext, makeTurn } from "./support.ts";

/** 记录 prompt 的假裁判客户端；reply 为 Error 时模拟执行失败。 */
function fakeJudge(reply: string | Error): {
  client: JudgeModelClient;
  prompts: string[];
} {
  const prompts: string[] = [];
  const client: JudgeModelClient = {
    async complete(request) {
      prompts.push(request.prompt);
      if (reply instanceof Error) throw reply;
      return { text: reply };
    },
  };
  return { client, prompts };
}

/** 两项 rubric，作为该轮 expect 传入。 */
const RUBRICS = [
  { name: "grounded", rubric: "回答是否基于观测证据" },
  { name: "bounded", rubric: "回答是否保留边界条件" },
];

/** 短超时 + 不重试，避免测试长驻与退避等待。 */
const OPTIONS = { name: "answer-quality", timeoutMs: 1000, maxRetries: 0 };

test("judge 断言：全部 rubric 通过则判定通过", async () => {
  const { client } = fakeJudge(
    '{"grounded":{"pass":true,"reason":"有证据"},"bounded":{"pass":true,"reason":"有边界"}}',
  );
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  assert.equal(criterion.scope, "turn");
  assert.equal(criterion.name, "answer-quality");
  const result = await criterion.evaluate(
    makeTurn("答案"),
    makeContext(RUBRICS),
  );
  assert.equal(result.pass, true);
  assert.equal(result.score, 1);
});

test("judge 断言：模型明确 false 才映射 0 分并点名理由", async () => {
  const { client } = fakeJudge(
    '{"grounded":{"pass":true,"reason":"有证据"},"bounded":{"pass":false,"reason":"缺边界"}}',
  );
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  const result = await criterion.evaluate(
    makeTurn("答案"),
    makeContext(RUBRICS),
  );
  assert.equal(result.pass, false);
  assert.equal(result.score, 0);
  assert.match(result.reason, /bounded/);
  assert.match(result.reason, /缺边界/);
});

test("judge 断言：rubric 缺证据显式抛错，不得当作 false", async () => {
  const { client } = fakeJudge('{"grounded":{"pass":true,"reason":"有证据"}}');
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  await assert.rejects(
    async () =>
      await criterion.evaluate(makeTurn("答案"), makeContext(RUBRICS)),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^\[absent\]/);
      assert.match(error.message, /bounded/);
      return true;
    },
  );
});

test("judge 断言：整体不可评测显式抛错，保留 judge 失败类别", async () => {
  const { client } = fakeJudge(new Error("boom"));
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  await assert.rejects(
    async () =>
      await criterion.evaluate(makeTurn("答案"), makeContext(RUBRICS)),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^\[not-evaluated:client\]/);
      assert.match(error.message, /answer-quality/);
      return true;
    },
  );
});

test("judge 断言：rubrics 逐个来自该轮 expect，不共享全局配置", async () => {
  const { client, prompts } = fakeJudge(
    '{"grounded":{"pass":true},"bounded":{"pass":true},"fresh":{"pass":true}}',
  );
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  await criterion.evaluate(makeTurn("第一轮"), makeContext(RUBRICS));
  await criterion.evaluate(
    makeTurn("第二轮"),
    makeContext([{ name: "fresh", rubric: "是否引用最新证据" }]),
  );
  assert.equal(prompts.length, 2);
  assert.match(prompts[0]!, /grounded/);
  assert.doesNotMatch(prompts[0]!, /fresh/);
  assert.match(prompts[1]!, /fresh/);
  assert.doesNotMatch(prompts[1]!, /grounded/);
});

test("judge 断言：被判文本取自 turn.text", async () => {
  const { client, prompts } = fakeJudge(
    '{"grounded":{"pass":true},"bounded":{"pass":true}}',
  );
  const criterion = createJudgeAssertion({ ...OPTIONS, client });
  await criterion.evaluate(makeTurn("本轮答案文本"), makeContext(RUBRICS));
  assert.match(prompts[0]!, /<Output>\n本轮答案文本\n<\/Output>/);
});

test("judge 断言：expect 形状非法由 Judge 现有校验显式拒绝且不发起调用", async () => {
  const illegal: unknown[] = [[], true, "grounded", [{ name: "", rubric: "" }]];
  for (const expect of illegal) {
    const { client, prompts } = fakeJudge("{}");
    const criterion = createJudgeAssertion({ ...OPTIONS, client });
    await assert.rejects(
      async () =>
        await criterion.evaluate(makeTurn("答案"), makeContext(expect)),
      /Judge/,
    );
    assert.equal(prompts.length, 0, "非法 expect 不得发起模型调用");
  }
});

test("judge 断言：判据名为空显式抛错", () => {
  const { client } = fakeJudge("{}");
  assert.throws(
    () => createJudgeAssertion({ ...OPTIONS, name: " ", client }),
    /非空字符串/,
  );
});
