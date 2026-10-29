/**
 * @module integrations/script-criteria
 * 场景仓的脚本事件与文件效果判据；证据来自宿主事件和清理前文件快照。
 * 不变量：不执行脚本、不读取模型声称的产物内容，不在核心包注册领域语义。
 */
import type { TurnCriterion } from "@x-agent-suite/contracts";
import { isDeepStrictEqual } from "node:util";

/** 根据原生命令工具事件判断脚本调用及成功、失败状态。 */
export const scriptExecution: TurnCriterion = {
  name: "script-execution",
  scope: "turn",
  evaluate(turn, { expect }) {
    const wanted = expect as {
      called?: unknown;
      status?: unknown;
      outputContains?: unknown;
    };
    if (
      !wanted ||
      typeof wanted.called !== "boolean" ||
      (wanted.status !== undefined &&
        !["completed", "failed"].includes(String(wanted.status))) ||
      (wanted.outputContains !== undefined &&
        typeof wanted.outputContains !== "string")
    ) {
      throw new Error(
        "script-execution 需要 called 与合法的 status/outputContains",
      );
    }
    const calls = turn.toolCalls.filter((call) => {
      const input = call.input as { command?: unknown } | null;
      return (
        call.name === "bash" &&
        typeof input?.command === "string" &&
        input.command.includes("/scripts/build-report.mjs")
      );
    });
    const pass = wanted.called
      ? calls.some(
          (call) =>
            (wanted.status === undefined || call.status === wanted.status) &&
            (wanted.outputContains === undefined ||
              (JSON.stringify(call.output) ?? "").includes(
                String(wanted.outputContains),
              )),
        )
      : calls.length === 0;
    return {
      pass,
      score: pass ? 1 : 0,
      reason: "核对原生脚本调用事件与执行结果",
    };
  },
};

/** 检查清理前采集的文件是否存在，以及 JSON 是否等于预期值。 */
export const artifactJson: TurnCriterion = {
  name: "artifact-json",
  scope: "turn",
  evaluate(turn, { expect }) {
    const wanted = expect as {
      key?: unknown;
      exists?: unknown;
      value?: unknown;
    };
    if (
      !wanted ||
      typeof wanted.key !== "string" ||
      !wanted.key ||
      typeof wanted.exists !== "boolean"
    ) {
      throw new Error("artifact-json 需要非空 key 与 exists");
    }
    const all = turn.metadata.fileEvidence as
      Record<string, { exists: boolean; content?: string }> | undefined;
    const evidence = all?.[wanted.key];
    if (!evidence) throw new Error("缺少文件采集证据：" + wanted.key);
    if (evidence.exists !== wanted.exists) {
      return { pass: false, score: 0, reason: "产物存在状态不符合预期" };
    }
    if (!wanted.exists) return { pass: true, score: 1, reason: "未生成产物" };
    let actual: unknown;
    try {
      actual = JSON.parse(evidence.content ?? "");
    } catch {
      return { pass: false, score: 0, reason: "产物不是有效 JSON" };
    }
    const pass = isDeepStrictEqual(actual, wanted.value);
    return { pass, score: pass ? 1 : 0, reason: "核对实际文件 JSON 内容" };
  },
};
