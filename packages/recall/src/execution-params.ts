/**
 * @module @x-agent-suite/recall/execution-params
 * 每次调用的执行参数；不变量：只验证 JSON 对象形状，不解释宿主字段、不回显输入。
 */
import { isRecord } from "./validation.ts";

/** 校验并复制执行参数，避免 Adapter 在 case/repeat 之间共享可变对象。 */
export function copyExecutionParams(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value))
    throw new Error("Recall executionParams 必须是 JSON 对象");
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(value));
    if (!isRecord(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("Recall executionParams 必须是可序列化 JSON 对象");
  }
}

/** 解析 CLI 的 JSON 对象；解析错误不得包含原始值。 */
export function parseExecutionParams(
  raw: string,
): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("--execution-params 必须是 JSON 对象");
  }
  return copyExecutionParams(value);
}
