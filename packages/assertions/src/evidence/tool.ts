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

/**
 * 解析 workspace 资源身份声明。
 *
 * @behavior evidence-resource-expect-parse
 * Given: 原始 path.arg 与 path.resource 字段及错误位置。
 * When: 校验工具入参键和逻辑资源路径。
 * Then: 返回非空 arg 与严格的 workspace 相对 POSIX resource。
 * Failure: 绝对路径、盘符、反斜杠、空段、点段或父级段均抛 TypeError。
 */
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

/**
 * 严格解析 toolResult 声明并保留可选约束。
 *
 * @behavior evidence-tool-result-expect-parse
 * Given: 原始 tool/action/args/path/contains 字段及错误位置。
 * When: 逐字段校验声明形状和资源路径。
 * Then: 返回规范化 ToolResultEvidenceExpect；未声明的可选字段保持缺省。
 * Failure: 未知字段、空工具名、非对象 args、非法资源路径或非法 contains 均抛 TypeError。
 */
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

/**
 * 为路径断言取得可信 workspace 边界。
 *
 * @behavior evidence-workspace-boundary
 * Given: 当前 turn 和消费者显式提供的 workspace resolver。
 * When: toolResult.path 需要归一资源身份。
 * Then: 返回能归一为 workspace 根的非空绝对边界；无路径断言不调用本函数。
 * Failure: resolver 缺失、返回空值、相对路径或不可归一边界均抛观察错误，
 * 不猜测进程 cwd，也不回退真实文件系统。
 */
function requireWorkspace(
  turn: TurnObservation,
  resolver: WorkspaceResolver | undefined,
): string {
  const workspace = resolver?.(turn);
  if (typeof workspace !== "string" || workspace.length === 0) {
    throw new Error("evidence 观察不完整：路径断言缺少可信 workspace 边界");
  }
  try {
    normalizeWorkspacePath(workspace, ".");
  } catch (cause) {
    throw new Error("evidence 观察不完整：workspace 边界无法可信归一", {
      cause,
    });
  }
  return workspace;
}

/**
 * 将一次工具调用的路径输入映射到 workspace 逻辑资源。
 *
 * @behavior evidence-call-resource
 * Given: 一次 ToolCall、资源声明和可信 workspace。
 * When: 读取声明的顶层入参键并做纯词法路径归一。
 * Then: 返回 workspace 相对逻辑路径；缺入参键或路径越界时返回 undefined。
 * Failure: 路径不是非空字符串或无法可信归一时抛观察错误，不当作普通未命中。
 */
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

/**
 * 评估候选调用的成功非空正文及 contains 约束。
 *
 * @behavior evidence-tool-result-texts
 * Given: 已按工具、action、args 和可选 path 过滤的调用及 contains 声明。
 * When: 筛选 completed 调用并提取可识别文本块。
 * Then: 有 path 时聚合相同资源的非空正文，无 path 时要求同次调用覆盖全部片段；
 * 全部满足才 pass；有 path 且变量模式下，缺失片段只报告数量与脱敏标记；无 path 保留通用原因。
 * Failure: 无 completed、无有效正文或片段缺失均返回内容失败；
 * 未注入变量时保留原有片段明细。
 */
function evaluateTexts(
  calls: readonly ToolCall[],
  expect: ToolResultEvidenceExpect,
  maskContains: boolean,
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
          // 解析值可能含源仓或隔离目录物理路径；变量模式下只保留数量，避免进入报告。
          reason: maskContains
            ? `同一路径聚合正文缺少 ${missing.length} 个已解析片段（值已脱敏）`
            : "同一路径聚合正文缺少片段：" + missing.join("、"),
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

/**
 * 判定成功且非空工具结果证据；所有约束复用同一候选调用集合。
 *
 * @behavior evidence-tool-result-match
 * Given: 当前 turn、严格 toolResult 声明和可选 workspace resolver。
 * When: 依次按 tool、action、args、path 过滤，再评估成功非空正文。
 * Then: 全部约束命中同一证据集合才通过；path 使用 workspace 相对逻辑资源身份。
 * Failure: 缺可信 workspace 或路径观察损坏显式抛错；普通未命中返回 pass=false；
 * maskContains 开启时诊断不回显变量解析值。
 */
export function evaluateToolResult(
  turn: TurnObservation,
  expect: ToolResultEvidenceExpect,
  resolver: WorkspaceResolver | undefined,
  maskContains = false,
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
  if (!expect.path) return evaluateTexts(argsMatched, expect, maskContains);
  const resource = expect.path;
  const matched = argsMatched.filter(
    (call) => callResource(call, resource, workspace!) === resource.resource,
  );
  if (matched.length === 0) {
    return { pass: false, reason: "未读取目标资源 " + resource.resource };
  }
  return evaluateTexts(matched, expect, maskContains);
}
