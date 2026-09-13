/**
 * @module @x-agent-suite/criteria
 * 通用判据子包公共入口：文本包含/排除与工具调用核对。
 * 定位：可选插件——判据模板由本包沉淀，领域判据仍由消费者注册。
 */
export { textContains, textNotContains } from "./text.ts";
export { toolCall, type ToolCallExpect } from "./tool-call.ts";
