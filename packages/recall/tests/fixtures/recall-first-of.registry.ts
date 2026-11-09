/** firstOf 专用零网络 transport；每次请求由当前 rubric 声明决定，不预评后档。 */
import { appendFileSync } from "node:fs";
import base from "./recall-judge.registry.ts";
import type { RecallRegistry } from "../../src/registry.ts";
const registry: RecallRegistry = {
  ...base,
  transport: async (request) => {
    const body = request.body as { messages: { content: string }[] };
    const prompt = body.messages.at(-1)!.content;
    const isJudge = prompt.startsWith("policy: judge-v1");
    const log = process.env.XAS_RECALL_TEST_JUDGE_LOG;
    if (log)
      appendFileSync(
        log,
        JSON.stringify({
          judge: isJudge,
          prompt,
          messageCount: body.messages.length,
        }) + "\n",
      );
    const mode = process.env.XAS_RECALL_TEST_JUDGE_MODE;
    if (isJudge && mode === "call") return { status: 500, text: "failure" };
    if (isJudge && mode === "timeout")
      await new Promise((resolve) => setTimeout(resolve, 80));
    const criteria = prompt
      .split("<Criteria>")
      .at(-1)!
      .split("</Criteria>")[0]!;
    const names = [...criteria.matchAll(/^\d+\. (.+?):/gm)].map(
      (match) => match[1]!,
    );
    const verdicts = Object.fromEntries(
      names.map((name) => [
        name,
        {
          pass: !name.startsWith("fail") && !criteria.includes(name + ": FAIL"),
          reason: name + " 原始理由",
        },
      ]),
    );
    const text = !isJudge
      ? prompt
      : mode === "parse"
        ? "not-json"
        : mode === "absent"
          ? "{}"
          : JSON.stringify(verdicts);
    return {
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { role: "assistant", content: text } }],
      }),
    };
  },
};
export default registry;
