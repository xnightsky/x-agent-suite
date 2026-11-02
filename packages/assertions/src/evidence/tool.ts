/**
 * @module @x-agent-suite/assertions/evidence/tool
 * 成功且非空工具结果证据的声明解析与内容判定。
 */
import type { ToolCall, TurnObservation } from "@x-agent-suite/contracts";
import { toolActionMatches, toolNameMatches } from "../checks.ts";
import { inputContains } from "../deterministic.ts";
import type {
  ToolResultEvidenceExpect,
  WorkspaceResourceExpect,
} from "./types.ts";
import {
  assertEvidenceFields,
  isEvidenceRecord,
  parseEvidenceContains,
  requiredEvidenceString,
} from "./validation.ts";
import { extractToolOutputText } from "./tool-output.ts";
import { normalizeWorkspacePath } from "./workspace-path.ts";

/** 单个证据谓词的内部判定结果。 */
export interface EvidenceVerdict {
  readonly pass: boolean;
  readonly reason: string;
}

/** 当前 turn 的 workspace 解析器。 */
export type WorkspaceResolver = (turn: TurnObservation) => string | undefined;

function parseResource(value: unknown, at: string): WorkspaceResourceExpect {
  if (!isEvidenceRecord(value)) throw new TypeError(at + " 必须是对象");
  assertEvidenceFields(value, ["arg", "resource"], at);
  const arg = requiredEvidenceString(value.arg, at + ".arg");
  const resource = requiredEvidenceString(value.resource, at + ".resource");
  const segments = resource.split("/");
  if (
    resource.startsWith("/") ||
    /^[A-Za-z]:/.test(resource) ||
    resource.includes("\\") ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new TypeError(
      at + ".resource 必须是严格的 workspace 相对 POSIX 资源路径",
    );
  }
  return { arg, resource };
}

/** 严格解析 toolResult 声明。 */
export function parseToolResultExpect(
  value: unknown,
  at: string,
): ToolResultEvidenceExpect {
  if (!isEvidenceRecord(value)) throw new TypeError(at + " 必须是对象");
  assertEvidenceFields(
    value,
    ["tool", "action", "args", "path", "contains"],
    at,
  );
  const tool = requiredEvidenceString(value.tool, at + ".tool");
  const action =
    value.action === undefined
      ? undefined
      : requiredEvidenceString(value.action, at + ".action");
  if (value.args !== undefined && !isEvidenceRecord(value.args)) {
    throw new TypeError(at + ".args 必须是对象");
  }
  return {
    tool,
    ...(action === undefined ? {} : { action }),
    ...(value.args === undefined
      ? {}
      : { args: value.args as Record<string, unknown> }),
    ...(value.path === undefined
      ? {}
      : { path: parseResource(value.path, at + ".path") }),
    ...(value.contains === undefined
      ? {}
      : { contains: parseEvidenceContains(value.contains, at + ".contains") }),
  };
}

function requireWorkspace(
  turn: TurnObservation,
  resolver: WorkspaceResolver | undefined,
): string {
  const workspace = resolver?.(turn);
  if (typeof workspace !== "string" || workspace.length === 0) {
    throw new Error("evidence 观察不完整：路径断言缺少可信 workspace 边界");
  }
  return workspace;
}

function callResource(
  call: ToolCall,
  resource: WorkspaceResourceExpect,
  workspace: string,
): string | undefined {
  if (
    !isEvidenceRecord(call.input) ||
    !Object.hasOwn(call.input, resource.arg)
  ) {
    return undefined;
  }
  const inputPath = call.input[resource.arg];
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new Error(
      "evidence 观察不完整：路径输入 " + resource.arg + " 不是非空字符串",
    );
  }
  try {
    return normalizeWorkspacePath(workspace, inputPath) ?? undefined;
  } catch (cause) {
    throw new Error("evidence 观察不完整：路径输入无法可信归一", { cause });
  }
}

function missingContains(
  text: string,
  expected: readonly string[],
): readonly string[] {
  return expected.filter((fragment) => !text.includes(fragment));
}

function evaluateTexts(
  calls: readonly ToolCall[],
  expect: ToolResultEvidenceExpect,
): EvidenceVerdict {
  const completed = calls.filter((call) => call.status === "completed");
  if (completed.length === 0) {
    return { pass: false, reason: "目标调用失败或未完成，无 completed 调用" };
  }
  const texts = completed.flatMap((call) => {
    const text = extractToolOutputText(call.output);
    return text !== undefined && text.trim().length > 0 ? [text] : [];
  });
  if (texts.length === 0) {
    return { pass: false, reason: "目标调用缺 output、无文本块或正文为空" };
  }
  if (expect.contains) {
    if (expect.path) {
      const missing = missingContains(texts.join("\n"), expect.contains);
      if (missing.length > 0) {
        return {
          pass: false,
          reason: "同一路径聚合正文缺少片段：" + missing.join("、"),
        };
      }
    } else if (
      !texts.some(
        (text) => missingContains(text, expect.contains!).length === 0,
      )
    ) {
      return { pass: false, reason: "无同一次成功调用同时包含全部声明片段" };
    }
  }
  return {
    pass: true,
    reason: expect.path
      ? "资源 " + expect.path.resource + " 存在成功非空读取"
      : "工具 " + expect.tool + " 存在成功非空结果",
  };
}

/** 判定成功且非空工具结果证据；所有约束复用同一候选调用集合。 */
export function evaluateToolResult(
  turn: TurnObservation,
  expect: ToolResultEvidenceExpect,
  resolver: WorkspaceResolver | undefined,
): EvidenceVerdict {
  const workspace = expect.path ? requireWorkspace(turn, resolver) : undefined;
  const named = turn.toolCalls.filter((call) =>
    toolNameMatches(call, expect.tool),
  );
  if (named.length === 0)
    return { pass: false, reason: "未调用工具 " + expect.tool };
  const acted = expect.action
    ? named.filter((call) => toolActionMatches(call, expect.action!))
    : named;
  if (acted.length === 0) return { pass: false, reason: "工具 action 不匹配" };
  const argsMatched = expect.args
    ? acted.filter((call) => inputContains(call.input, expect.args!))
    : acted;
  if (argsMatched.length === 0)
    return { pass: false, reason: "工具入参不匹配期望子集" };
  if (!expect.path) return evaluateTexts(argsMatched, expect);
  const resource = expect.path;
  const matched = argsMatched.filter(
    (call) => callResource(call, resource, workspace!) === resource.resource,
  );
  if (matched.length === 0) {
    return { pass: false, reason: "未读取目标资源 " + resource.resource };
  }
  return evaluateTexts(matched, expect);
}
