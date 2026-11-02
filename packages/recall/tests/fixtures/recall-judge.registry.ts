/** Recall Judge 测试注册表：会话机械判据与脚本化 direct transport，零真实网络。 */
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { SessionCriterion } from "@x-agent-suite/contracts";
import base from "./recall.registry.ts";
import type { RecallRegistry } from "../../src/registry.ts";

/** 一条脚本化主执行或 Judge 请求。 */
export interface JudgeRequestRecord {
  readonly judge: boolean;
  readonly prompt: string;
  readonly messageCount: number;
}

/** 当前 fake transport 收到的主执行与 Judge 请求。 */
export interface RecallJudgeRegistryTestState {
  requests: JudgeRequestRecord[];
}

const globalState = globalThis as typeof globalThis & {
  __xasRecallJudgeRegistryTest?: RecallJudgeRegistryTestState;
};
globalState.__xasRecallJudgeRegistryTest = { requests: [] };

/** 返回当前测试的脚本化请求记录。 */
export function judgeState(): RecallJudgeRegistryTestState {
  return globalState.__xasRecallJudgeRegistryTest!;
}

/** 清空同一进程内多个 CLI 场景的请求记录。 */
export function resetJudgeState(): void {
  judgeState().requests = [];
}

/** 读取子进程写入的 JSONL 请求记录。 */
export async function readJudgeRequests(
  path: string,
): Promise<JudgeRequestRecord[]> {
  const text = await readFile(path, "utf8");
  return text.trim().length === 0
    ? []
    : text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as JudgeRequestRecord);
}

function mechanical(name: string, pass: boolean): SessionCriterion {
  return {
    name,
    scope: "session",
    evaluate: () => ({
      pass,
      score: pass ? 1 : 0,
      reason: pass ? name + " 通过" : name + " 未通过",
    }),
  };
}

const registry: RecallRegistry = {
  ...base,
  criteria: [
    ...base.criteria,
    mechanical("mechanical-a", true),
    mechanical("mechanical-b", false),
  ],
  transport: async (request) => {
    const body = request.body as {
      messages: { role: string; content: string }[];
    };
    const prompt = body.messages[body.messages.length - 1]!.content;
    const isJudge = prompt.startsWith("policy: judge-v1");
    const record = {
      judge: isJudge,
      prompt,
      messageCount: body.messages.length,
    };
    judgeState().requests.push(record);
    const logPath = process.env.XAS_RECALL_TEST_JUDGE_LOG;
    if (logPath) appendFileSync(logPath, JSON.stringify(record) + "\n");
    const mode = process.env.XAS_RECALL_TEST_JUDGE_MODE;
    if (isJudge && mode === "call")
      return { status: 500, text: "scripted failure" };
    if (isJudge && mode === "timeout") {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const text = !isJudge
      ? prompt === "准备回答"
        ? "中间答案"
        : "最终答案"
      : mode === "parse"
        ? "not-json"
        : mode === "absent"
          ? JSON.stringify({ "ai-a": { pass: true, reason: "AI A 通过" } })
          : JSON.stringify({
              "ai-a": { pass: true, reason: "AI A 通过" },
              "ai-b": { pass: false, reason: "AI B 未通过" },
            });
    return {
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { role: "assistant", content: text } }],
      }),
    };
  },
};

export default registry;
