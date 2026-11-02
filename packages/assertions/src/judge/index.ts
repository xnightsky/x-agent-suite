/**
 * @module @x-agent-suite/assertions/judge
 * AI 断言适配公开子路径；底层 Judge 执行器仍由 @x-agent-suite/judge 提供。
 */
export {
  createJudgeAssertion,
  type JudgeAssertionBaseOptions,
  type JudgeAssertionOptions,
} from "./assertion.ts";
export { judgeAssertionResults, type NamedAssertionResult } from "./results.ts";
