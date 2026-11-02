/**
 * @module @x-agent-suite/assertions/tests/evidence-support
 * 证据公开接口测试共享的最小观察夹具；本文件不是测试入口。
 */
import type { ToolCall, TurnObservation } from "@x-agent-suite/contracts";
import { createEvidenceCriterion } from "../src/index.ts";
import { makeTurn } from "./support.ts";

/** 构造标准 content-block 文本输出。 */
export function output(text: string) {
  return { content: [{ type: "text", text }] };
}

/** 构造一次读取工具调用。 */
export function readCall(
  path: string,
  text = "正文",
  status: "completed" | "failed" = "completed",
): ToolCall {
  return { name: "read", input: { path }, output: output(text), status };
}

/** 创建从消费者 metadata 适配 workspace 的证据判据。 */
export function workspaceEvidence(criterionOptions?: {
  resolveWorkspaceCwd?: (turn: TurnObservation) => string | undefined;
}) {
  return createEvidenceCriterion(
    criterionOptions ?? {
      resolveWorkspaceCwd: (turn) =>
        turn.metadata.workspaceCwd as string | undefined,
    },
  );
}

/** 构造携带隔离 workspace 的单轮观察。 */
export function workspaceTurn(
  text: string,
  toolCalls: ToolCall[],
): TurnObservation {
  return {
    ...makeTurn(text, toolCalls),
    metadata: { workspaceCwd: "/sandbox/root" },
  };
}
