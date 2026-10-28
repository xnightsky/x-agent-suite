/**
 * @module @x-agent-suite/assertions
 * 行为断言公共入口：检查层原语、确定性判据与 AI 断言。
 * 定位：可选插件。原语与判据模板由本包沉淀；领域判据名与 rubric 仍由消费者提供，
 * 本包不认识任何具体被测系统、宿主、协议或消费者判据。
 */
export {
  checkListResult,
  dryChecks,
  fuzzyChecks,
  hardChecks,
  toolActionMatches,
  toolNameMatches,
} from "./checks.ts";
export type {
  EnumerateCheck,
  EnumerateResult,
  HardExpectation,
} from "@x-agent-suite/contracts";
export {
  textContains,
  textNotContains,
  toolCall,
  type ToolCallExpect,
} from "./deterministic.ts";
export {
  createJudgeAssertion,
  type JudgeAssertionOptions,
} from "./judge-assertion.ts";
