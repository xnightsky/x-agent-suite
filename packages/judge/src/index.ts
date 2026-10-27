/**
 * @module @x-agent-suite/judge
 * 通用 AI Judge：批量 rubric 到具名 boolean verdict。
 * 不变量：AI 不出分；不接 Criterion/Recall/decision；不跨 mode fallback。
 */
export { createJudgeClient } from "./client.ts";
export { judge } from "./judge.ts";
export {
  JudgeDefinitionError,
  JudgeModelError,
  type BorrowedJudgeClientOptions,
  type CreateJudgeClientOptions,
  type DirectJudgeClientOptions,
  type JudgeClient,
  type JudgeClientBaseOptions,
  type JudgeFailure,
  type JudgeFailureKind,
  type JudgeInput,
  type JudgeMode,
  type JudgeModelClient,
  type JudgeModelRequest,
  type JudgeModelResponse,
  type JudgeOptions,
  type JudgeOutcome,
  type JudgeRubric,
  type JudgeVerdict,
} from "./types.ts";
