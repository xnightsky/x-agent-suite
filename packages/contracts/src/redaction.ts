/**
 * @module @x-agent-suite/contracts/redaction
 * 敏感文本离开运行时边界前的通用脱敏接缝。
 */

/** 把一段可能包含秘密的文本转换为可公开文本。 */
export type Redactor = (text: string) => string;
