/**
 * @module @x-agent-suite/observation/checks
 * 检查原语兼容入口；新代码使用 @x-agent-suite/assertions。
 * 不变量：行为实现只有 assertions 一份；保留原导出名与检查契约类型。
 */
export {
  checkListResult,
  dryChecks,
  fuzzyChecks,
  hardChecks,
  toolActionMatches,
  toolNameMatches,
  type EnumerateCheck,
  type EnumerateResult,
  type HardExpectation,
} from "@x-agent-suite/assertions";
