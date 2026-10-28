/**
 * @module @x-agent-suite/criteria
 * 确定性判据兼容入口；新代码使用 @x-agent-suite/assertions。
 * 不变量：只重导出，不保留第二份断言实现，也不自动注册判据。
 */
export {
  textContains,
  textNotContains,
  toolCall,
  type ToolCallExpect,
} from "@x-agent-suite/assertions";
