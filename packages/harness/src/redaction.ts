/**
 * @module @x-agent-suite/harness/redaction
 * harness 生命周期异常的统一上下文包装与脱敏。
 */
import type { Redactor } from "@x-agent-suite/contracts";
import { redactValue } from "@x-agent-suite/llm-fixture";

/** 构造已脱敏且保留原始 cause 链的生命周期错误。 */
export function createLifecycleError(
  owner: string,
  stage: string,
  error: unknown,
  cleanupError: unknown,
  redactor?: Redactor,
): Error {
  const redact = (text: string) => redactor?.(text) ?? text;
  const detail = redact(error instanceof Error ? error.message : String(error));
  const cleanupDetail =
    cleanupError === undefined
      ? ""
      : `；cleanup: ${redact(
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
        )}`;
  const cause = redactValue(
    cleanupError === undefined
      ? error
      : new AggregateError([error, cleanupError]),
    redactor,
  );
  return new Error(`${owner} start[${stage}]: ${detail}${cleanupDetail}`, {
    cause,
  });
}
