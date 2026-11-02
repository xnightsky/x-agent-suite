/**
 * @module @x-agent-suite/assertions/evidence/citation
 * 最终回答路径文本与同路径成功非空读取的关联判定。
 */
import type { TurnObservation } from "@x-agent-suite/contracts";
import {
  evaluateToolResult,
  parseToolResultExpect,
  type EvidenceVerdict,
  type WorkspaceResolver,
} from "./tool.ts";
import type {
  CitationEvidenceExpect,
  ToolResultEvidenceExpect,
} from "./types.ts";
import { assertEvidenceFields, isEvidenceRecord } from "./validation.ts";

function asToolResult(
  expect: CitationEvidenceExpect,
): ToolResultEvidenceExpect {
  return {
    tool: expect.tool,
    ...(expect.action === undefined ? {} : { action: expect.action }),
    ...(expect.args === undefined ? {} : { args: expect.args }),
    path: { arg: expect.pathArg, resource: expect.path },
    ...(expect.contains === undefined ? {} : { contains: expect.contains }),
  };
}

/** 严格解析 citation，并复用 toolResult 的全部读取声明校验。 */
export function parseCitationExpect(
  value: unknown,
  at: string,
): CitationEvidenceExpect {
  if (!isEvidenceRecord(value)) throw new TypeError(at + " 必须是对象");
  assertEvidenceFields(
    value,
    ["tool", "action", "args", "pathArg", "path", "contains"],
    at,
  );
  const parsed = parseToolResultExpect(
    {
      tool: value.tool,
      ...(value.action === undefined ? {} : { action: value.action }),
      ...(value.args === undefined ? {} : { args: value.args }),
      path: { arg: value.pathArg, resource: value.path },
      ...(value.contains === undefined ? {} : { contains: value.contains }),
    },
    at,
  );
  return {
    tool: parsed.tool,
    ...(parsed.action === undefined ? {} : { action: parsed.action }),
    ...(parsed.args === undefined ? {} : { args: parsed.args }),
    pathArg: parsed.path!.arg,
    path: parsed.path!.resource,
    ...(parsed.contains === undefined ? {} : { contains: parsed.contains }),
  };
}

/** 判定回答引用与实读；即使引用缺失也先求值实读以保留完整诊断和异常。 */
export function evaluateCitation(
  turn: TurnObservation,
  expect: CitationEvidenceExpect,
  resolver: WorkspaceResolver | undefined,
): EvidenceVerdict {
  const read = evaluateToolResult(turn, asToolResult(expect), resolver);
  const cited = turn.text.includes(expect.path);
  const pass = cited && read.pass;
  if (pass) {
    return { pass: true, reason: "引用与成功非空读取均命中 " + expect.path };
  }
  const failures: string[] = [];
  if (!cited) failures.push("最终回答未引用 " + expect.path);
  if (!read.pass)
    failures.push("实读未满足 " + expect.path + "：" + read.reason);
  return { pass: false, reason: failures.join("；") };
}
