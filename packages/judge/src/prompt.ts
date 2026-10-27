import type { JudgeInput, JudgeOptions } from "./types.ts";

/** 构造默认 judge-v1 prompt；可选 instructions 仅追加场景约束。 */
export function buildJudgePrompt(
  input: JudgeInput,
  options?: JudgeOptions["prompt"],
): string {
  const criteria = input.rubrics
    .map((item, index) => `${index + 1}. ${item.name}: ${item.rubric}`)
    .join("\n");
  const prompt = [
    "policy: judge-v1",
    "You are verifying an answer against a list of named criteria.",
    "For EVERY listed criterion, decide pass (the criterion holds) or fail (it does not).",
    'Respond with ONLY a JSON object: { "<name>": { "pass": true|false, "reason": "..." } }.',
    "Include every criterion name exactly once.",
    "Do not produce scores, confidence, thresholds, overall pass, or extra prose.",
    "",
    "Example:",
    "<Output>Paris is the capital of France.</Output>",
    "<Criteria>",
    "1. geography: Is the geography correct?",
    "2. concise: Is the answer concise?",
    "</Criteria>",
    '{"geography":{"pass":true,"reason":"Correct capital"},"concise":{"pass":false,"reason":"Too verbose"}}',
    "",
    "<Output>",
    input.output,
    "</Output>",
    "<Criteria>",
    criteria,
    "</Criteria>",
  ];
  const instructions = options?.instructions?.trim();
  if (instructions) {
    prompt.push("", "Additional instructions: " + instructions);
  }
  return prompt.join("\n");
}
