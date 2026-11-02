/**
 * @module @x-agent-suite/assertions/evidence
 * 领域中立证据判据：工具结果、workspace 资源、引用关联及布尔组合。
 * 不变量：先完整校验声明和观察，再返回内容结果；不创建 Runner、不调用模型。
 */
import type { TurnCriterion, TurnObservation } from "@x-agent-suite/contracts";
import { evaluateCitation, parseCitationExpect } from "./citation.ts";
import {
  evaluateToolResult,
  parseToolResultExpect,
  type EvidenceVerdict,
  type WorkspaceResolver,
} from "./tool.ts";
import type { EvidenceCriterionOptions, EvidenceExpect } from "./types.ts";
import {
  assertEvidenceFields,
  assertEvidenceObservation,
  isEvidenceRecord,
  requiredEvidenceString,
} from "./validation.ts";

const OPERATORS = ["toolResult", "citation", "allOf", "not"] as const;

function parseEvidenceExpect(
  value: unknown,
  at = "evidence 的 expect",
  requireName = false,
): EvidenceExpect {
  if (!isEvidenceRecord(value)) throw new TypeError(at + " 必须是对象");
  assertEvidenceFields(value, ["name", ...OPERATORS], at);
  const operators = OPERATORS.filter((key) => Object.hasOwn(value, key));
  if (operators.length !== 1)
    throw new TypeError(at + " 必须且只能声明一个证据节点");
  const name =
    value.name === undefined
      ? undefined
      : requiredEvidenceString(value.name, at + ".name");
  if (requireName && name === undefined)
    throw new TypeError(at + ".name 必须是非空字符串");
  const named = name === undefined ? {} : { name };
  const operator = operators[0]!;
  if (operator === "toolResult") {
    return {
      ...named,
      toolResult: parseToolResultExpect(value.toolResult, at + ".toolResult"),
    };
  }
  if (operator === "citation") {
    return {
      ...named,
      citation: parseCitationExpect(value.citation, at + ".citation"),
    };
  }
  if (operator === "not") {
    return { ...named, not: parseEvidenceExpect(value.not, at + ".not") };
  }
  if (!Array.isArray(value.allOf) || value.allOf.length === 0) {
    throw new TypeError(at + ".allOf 必须是非空数组");
  }
  const seen = new Set<string>();
  const allOf = value.allOf.map((child, index) => {
    const parsed = parseEvidenceExpect(
      child,
      at + ".allOf[" + index + "]",
      true,
    );
    if (seen.has(parsed.name!))
      throw new TypeError(at + ".allOf 子项 name 必须同级唯一");
    seen.add(parsed.name!);
    return parsed;
  });
  return { ...named, allOf };
}

function evaluateEvidence(
  turn: TurnObservation,
  expect: EvidenceExpect,
  resolver: WorkspaceResolver | undefined,
): EvidenceVerdict {
  if ("toolResult" in expect)
    return evaluateToolResult(turn, expect.toolResult, resolver);
  if ("citation" in expect)
    return evaluateCitation(turn, expect.citation, resolver);
  if ("not" in expect) {
    const child = evaluateEvidence(turn, expect.not, resolver);
    return {
      pass: !child.pass,
      reason:
        (child.pass ? "出现禁止证据：" : "未出现禁止证据：") + child.reason,
    };
  }
  const children = expect.allOf.map((child) => ({
    name: child.name!,
    result: evaluateEvidence(turn, child, resolver),
  }));
  const pass = children.every((child) => child.result.pass);
  return {
    pass,
    reason: children
      .map(
        (child) =>
          (child.result.pass ? "pass " : "fail ") +
          child.name +
          "：" +
          child.result.reason,
      )
      .join("；"),
  };
}

/**
 * 创建通用证据判据；workspace 由调用方按当前 turn 动态注入。
 * @param options 可选 workspace 解析器；无路径断言时无需提供。
 * @returns metric 名为 evidence 的 TurnCriterion。
 */
export function createEvidenceCriterion(
  options: EvidenceCriterionOptions = {},
): TurnCriterion {
  return {
    name: "evidence",
    scope: "turn",
    evaluate(turn, context) {
      const expect = parseEvidenceExpect(context.expect);
      assertEvidenceObservation(turn);
      const result = evaluateEvidence(
        turn,
        expect,
        options.resolveWorkspaceCwd,
      );
      return {
        pass: result.pass,
        score: result.pass ? 1 : 0,
        reason: result.reason,
      };
    },
  };
}

/** 无 workspace 依赖时可直接注册的通用证据判据。 */
export const evidence: TurnCriterion = createEvidenceCriterion();

export { extractToolOutputText } from "./tool-output.ts";
export { normalizeWorkspacePath } from "./workspace-path.ts";
export type {
  CitationEvidenceExpect,
  EvidenceCriterionOptions,
  EvidenceExpect,
  ToolResultEvidenceExpect,
  WorkspaceResourceExpect,
} from "./types.ts";
