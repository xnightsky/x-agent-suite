/** 机械分值 CLI 夹具：真实检查当前文本，复用零网络 transport，不内建到框架。 */
import { appendFileSync } from "node:fs";
import { parseAssertionScore } from "@x-agent-suite/assertions";
import type { RecallRegistry } from "../../src/registry.ts";
import base from "./recall-judge.registry.ts";

function inputOf(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("scored-text 输入必须是对象");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "text" && key !== "score")) {
    throw new Error("scored-text 存在未知字段");
  }
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new Error("scored-text.text 必须是非空字符串");
  }
  return { text: input.text, score: input.score };
}

const scoredText = {
  name: "scored-text",
  assertionScore(expect: unknown) {
    const logPath = process.env.XAS_RECALL_TEST_SCORE_LOG;
    if (logPath) appendFileSync(logPath, JSON.stringify(expect) + "\n");
    const { score } = inputOf(expect);
    return parseAssertionScore(score === undefined ? {} : score);
  },
  evaluate(observation: { text: string }, context: { expect: unknown }) {
    const pass = observation.text.includes(inputOf(context.expect).text);
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass ? "文本包含声明内容" : "文本缺少声明内容",
    };
  },
};

/** 机械评分测试注册表：逐轮与最终判据分别预检，共用同一输入协议。 */
const registry: RecallRegistry = {
  ...base,
  criteria: [
    ...base.criteria,
    { ...scoredText, scope: "turn" },
    { ...scoredText, scope: "session" },
  ],
};
export default registry;
