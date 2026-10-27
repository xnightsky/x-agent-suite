import { buildJudgePrompt } from "./prompt.ts";
import { parseJudgeResponse } from "./parse.ts";
import {
  JudgeDefinitionError,
  JudgeModelError,
  type JudgeFailure,
  type JudgeFailureKind,
  type JudgeInput,
  type JudgeOptions,
  type JudgeOutcome,
} from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BUDGETS: Partial<Record<JudgeFailureKind, number>> = {
  "rate-limited": 2,
  transport: 1,
  timeout: 1,
};

/** 校验输入与执行选项；所有定义错误必须先于模型调用。 */
function validate(input: JudgeInput, options: JudgeOptions): void {
  if (!options || typeof options.client?.complete !== "function") {
    throw new JudgeDefinitionError("Judge client 必须提供 complete()");
  }
  if (
    !input ||
    typeof input.output !== "string" ||
    !Array.isArray(input.rubrics)
  ) {
    throw new JudgeDefinitionError(
      "Judge output 必须是 string，rubrics 必须是数组",
    );
  }
  if (input.rubrics.length === 0) {
    throw new JudgeDefinitionError("Judge rubrics 不能为空");
  }
  const names = new Set<string>();
  for (const item of input.rubrics) {
    if (!item || !item.name?.trim() || !item.rubric?.trim()) {
      throw new JudgeDefinitionError("Judge name 与 rubric 必须非空");
    }
    if (names.has(item.name))
      throw new JudgeDefinitionError("Judge name 不得重复");
    names.add(item.name);
  }
  if (
    options.prompt !== undefined &&
    (typeof options.prompt !== "object" ||
      options.prompt === null ||
      Array.isArray(options.prompt))
  ) {
    throw new JudgeDefinitionError("Judge prompt 必须是对象");
  }
  if (
    options.prompt?.instructions !== undefined &&
    typeof options.prompt.instructions !== "string"
  ) {
    throw new JudgeDefinitionError("Judge prompt.instructions 必须是 string");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new JudgeDefinitionError("Judge timeoutMs 必须是正整数");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new JudgeDefinitionError("Judge maxRetries 必须是非负整数");
  }
}

/** 执行一次 attempt；超时先 abort，再等待客户端完成清理。 */
async function completeAttempt(
  prompt: string,
  options: JudgeOptions,
): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await options.client.complete({
      prompt,
      signal: controller.signal,
    });
    if (timedOut) throw new JudgeModelError("timeout", "Judge 调用超时");
    if (!response.text.trim()) {
      throw new JudgeModelError("empty-response", "Judge 响应为空");
    }
    return response.text;
  } catch (error) {
    if (timedOut)
      throw new JudgeModelError("timeout", "Judge 调用超时", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 把执行异常归一为脱敏失败；未知错误保守归为 client。 */
function asFailure(error: unknown): JudgeFailure {
  if (error instanceof JudgeModelError) {
    return { kind: error.kind, message: error.message };
  }
  return { kind: "client", message: "Judge 客户端调用失败" };
}

/** 同类错误的退避序列：1s、2s、4s，最高 8s。 */
function backoff(attempts: number): Promise<void> {
  const delay = Math.min(1000 * 2 ** (attempts - 1), 8000);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** 批量执行 AI 裁定；AI 不出分，单项 absent 与整体不可评测严格分层。 */
export async function judge(
  input: JudgeInput,
  options: JudgeOptions,
): Promise<JudgeOutcome> {
  validate(input, options);
  const prompt = buildJudgePrompt(input, options.prompt);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      const text = await completeAttempt(prompt, options);
      const parsed = parseJudgeResponse(text, input.rubrics);
      return { status: "completed", ...parsed, attempts };
    } catch (error) {
      const failure = asFailure(error);
      const budget = Math.min(maxRetries, RETRY_BUDGETS[failure.kind] ?? 0);
      if (attempts > budget) {
        return { status: "not-evaluated", failure, attempts };
      }
      await backoff(attempts);
    }
  }
}
