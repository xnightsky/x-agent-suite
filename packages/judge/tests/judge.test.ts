import assert from "node:assert/strict";
import test from "node:test";
import { judge, JudgeDefinitionError, JudgeModelError } from "../src/index.ts";
import type { JudgeModelClient } from "../src/index.ts";

const input = {
  output: "被测答案",
  rubrics: [
    { name: "correct", rubric: "答案正确" },
    { name: "bounded", rubric: "边界完整" },
  ],
} as const;

function clientWith(complete: JudgeModelClient["complete"]): {
  client: JudgeModelClient;
  calls: number;
} {
  const state = {
    calls: 0,
    client: {
      complete: (request) => {
        state.calls += 1;
        return complete(request);
      },
    } satisfies JudgeModelClient,
  };
  return state;
}

test("定义错误在模型调用前抛出", async () => {
  const state = clientWith(async () => ({ text: "{}" }));
  const invalidInputs = [
    [{ ...input, rubrics: [] }, undefined],
    [{ ...input, rubrics: [{ name: "", rubric: "x" }] }, undefined],
    [{ ...input, rubrics: [{ name: "x", rubric: "" }] }, undefined],
    [
      {
        ...input,
        rubrics: [
          { name: "x", rubric: "a" },
          { name: "x", rubric: "b" },
        ],
      },
      undefined,
    ],
    [input, { timeoutMs: 0 }],
    [input, { maxRetries: -1 }],
  ] as const;
  for (const [candidate, options] of invalidInputs) {
    await assert.rejects(
      judge(candidate, { client: state.client, ...options }),
      JudgeDefinitionError,
    );
  }
  await assert.rejects(judge(input, {} as never), JudgeDefinitionError);
  assert.equal(state.calls, 0);
});

test("一次批量调用生成 judge-v1 prompt，返回 verdict 与 absent 且不含分数", async () => {
  const state = clientWith(async ({ prompt }) => {
    assert.match(prompt, /policy: judge-v1/);
    assert.match(prompt, /被测答案/);
    assert.match(prompt, /1\. correct: 答案正确/);
    assert.match(prompt, /2\. bounded: 边界完整/);
    assert.match(prompt, /Do not produce scores/i);
    return { text: '{"correct":{"pass":true,"reason":"ok"}}' };
  });
  const result = await judge(input, { client: state.client });
  assert.deepEqual(result, {
    status: "completed",
    verdicts: [{ name: "correct", pass: true, reason: "ok" }],
    absent: ["bounded"],
    attempts: 1,
  });
  assert.equal("score" in result, false);
  assert.equal(state.calls, 1);
});
test("prompt 省略使用默认 judge-v1，instructions 仅追加场景约束", async () => {
  const prompts: string[] = [];
  const state = clientWith(async ({ prompt }) => {
    prompts.push(prompt);
    return { text: '{"correct":true,"bounded":true}' };
  });
  await judge(input, { client: state.client });
  await judge(input, { client: state.client, prompt: {} });
  await judge(input, {
    client: state.client,
    prompt: { instructions: "使用中文，保留文件路径。" },
  });
  assert.equal(prompts.length, 3);
  assert.equal(prompts[0], prompts[1]);
  const baseline = prompts[0]!;
  const customized = prompts[2]!;
  assert.ok(customized.startsWith(baseline));
  assert.match(customized, /Additional instructions: 使用中文，保留文件路径。/);
  assert.match(customized, /Do not produce scores/i);
});

test("rate-limited 在预算内重试，parse 与未知 client 错误不重试", async () => {
  let attempts = 0;
  const limited = clientWith(async () => {
    attempts += 1;
    if (attempts === 1) throw new JudgeModelError("rate-limited", "429");
    return { text: '{"correct":true,"bounded":false}' };
  });
  const started = Date.now();
  const recovered = await judge(input, {
    client: limited.client,
    maxRetries: 1,
  });
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.attempts, 2);
  assert.ok(Date.now() - started >= 900, "首次重试应退避约 1 秒");

  for (const failure of [
    new JudgeModelError("parse", "bad json"),
    new Error("unknown"),
  ]) {
    const state = clientWith(async () => {
      throw failure;
    });
    const result = await judge(input, { client: state.client, maxRetries: 2 });
    assert.equal(result.status, "not-evaluated");
    assert.equal(result.attempts, 1);
    assert.equal(state.calls, 1);
  }
});

test("timeout 先 abort，空响应与 parse 失败进入 not-evaluated", async () => {
  let aborted = false;
  const stalled = clientWith(
    ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      }),
  );
  const timeout = await judge(input, {
    client: stalled.client,
    timeoutMs: 5,
    maxRetries: 0,
  });
  assert.deepEqual(timeout, {
    status: "not-evaluated",
    failure: { kind: "timeout", message: "Judge 调用超时" },
    attempts: 1,
  });
  assert.equal(aborted, true);

  for (const [text, kind] of [
    ["", "empty-response"],
    ["not-json", "parse"],
  ] as const) {
    const state = clientWith(async () => ({ text }));
    const result = await judge(input, { client: state.client });
    assert.equal(result.status, "not-evaluated");
    if (result.status === "not-evaluated")
      assert.equal(result.failure.kind, kind);
  }
});
