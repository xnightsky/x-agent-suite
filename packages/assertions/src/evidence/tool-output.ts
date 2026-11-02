/**
 * @module @x-agent-suite/assertions/tool-output
 * 从公开 ToolCall.output 的 content-block 形状提取观察文本证据。
 * 不变量：不读取原始宿主事件，不猜测其他 output 包装，不裁剪正文。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 提取 output.content 中的文本块，并按观察顺序以换行拼接。
 * @param output 公开 ToolCall 的可选原始出参。
 * @returns 至少存在一个合法文本块时返回拼接正文，否则返回 undefined。
 */
export function extractToolOutputText(output: unknown): string | undefined {
  if (!isRecord(output) || !Array.isArray(output.content)) return undefined;
  const texts = output.content.flatMap((block) =>
    isRecord(block) && block.type === "text" && typeof block.text === "string"
      ? [block.text]
      : [],
  );
  return texts.length > 0 ? texts.join("\n") : undefined;
}
