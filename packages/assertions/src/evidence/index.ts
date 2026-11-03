/**
 * @module @x-agent-suite/assertions/evidence
 * 领域中立证据判据：工具结果、workspace 资源、引用关联及布尔组合。
 * 不变量：先完整校验声明和观察，再返回内容结果；不创建 Runner、不调用模型。
 */
import type {
  TurnCriterion,
  TurnCriterionContext,
  TurnObservation,
} from "@x-agent-suite/contracts";
import { evaluateCitation, parseCitationExpect } from "./citation.ts";
import {
  evaluateToolResult,
  parseToolResultExpect,
  type EvidenceVerdict,
  type WorkspaceResolver,
} from "./tool.ts";
import type {
  EvidenceCriterionOptions,
  EvidenceExpect,
  EvidenceVariableResolver,
  PreparedEvidenceVariableValue,
} from "./types.ts";
import {
  assertEvidenceFields,
  assertEvidenceObservation,
  isEvidenceRecord,
  requiredEvidenceString,
} from "./validation.ts";

const OPERATORS = ["toolResult", "citation", "allOf", "not"] as const;

/**
 * 完整解析 evidence 声明树并保留布尔组合结构。
 *
 * @behavior evidence-expect-parse
 * Given: 调用方给出 toolResult、citation、not 或 allOf 声明及嵌套位置。
 * When: 递归解析每个节点，不读取任何工具观察。
 * Then: 返回严格类型化声明；allOf 保留声明顺序并约束直接子项名称同级唯一。
 * Failure: 非对象、未知字段、多个操作符、非法子声明或重复名称均抛 TypeError；
 * 未命中或不会求值的分支也不能豁免。
 */
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

/**
 * 只变换 toolResult.contains，保留其余声明字段和组合结构。
 *
 * @behavior evidence-contains-tree-map
 * Given: 一棵原始声明树和一个 contains 映射函数。
 * When: 递归经过 toolResult、not 与 allOf 节点。
 * Then: 按先序遍历映射每个已声明 contains；citation、tool、path、args 和 YAML 键保持原值。
 * Failure: 映射函数抛出的定义错误原样向上传播，不转换成内容失败。
 */
function mapContains(
  value: unknown,
  map: (contains: unknown) => unknown,
): unknown {
  if (!isEvidenceRecord(value)) return value;
  if (
    isEvidenceRecord(value.toolResult) &&
    Object.hasOwn(value.toolResult, "contains")
  ) {
    return {
      ...value,
      toolResult: {
        ...value.toolResult,
        contains: map(value.toolResult.contains),
      },
    };
  }
  if (Object.hasOwn(value, "not")) {
    return { ...value, not: mapContains(value.not, map) };
  }
  if (Array.isArray(value.allOf)) {
    return {
      ...value,
      allOf: value.allOf.map((child) => mapContains(child, map)),
    };
  }
  return value;
}

function containsTemplate(value: unknown): boolean {
  if (typeof value === "string") return value.includes("{{");
  if (Array.isArray(value)) return value.some(containsTemplate);
  return false;
}

/**
 * 按字段 opt-in 准备变量，并在统一求值后重新执行原字段校验。
 *
 * @behavior evidence-variable-prepare
 * Given: 原始 evidence 声明、当前 turn 上下文和可选变量解析器。
 * When: 判据开始评估，先遍历完整声明树，再统一解析 contains。
 * Then: 无解析器时普通声明保持原义；有解析器时先 prepare 全树、后 resolve，
 * 最终 contains 仍满足非空字符串数组约束，其他字段不插值。
 * Failure: 未配置解析器的模板、非法引用或错误目标类型均抛定义错误；
 * 已注入解析器的 contains 求值为 undefined 同样拒绝；
 * not/allOf 未命中分支不得隐藏这些错误。
 */
function prepareExpect(
  value: unknown,
  variables: EvidenceVariableResolver | undefined,
  context: TurnCriterionContext,
): EvidenceExpect {
  if (!variables) {
    const checked = mapContains(value, (contains) => {
      if (containsTemplate(contains)) {
        throw new TypeError(
          "evidence.toolResult.contains 含变量语法但未配置解析器",
        );
      }
      return contains;
    });
    return parseEvidenceExpect(checked);
  }
  const prepared: PreparedEvidenceVariableValue[] = [];
  // 占位值先通过原声明树校验；所有分支完成 prepare 前，不允许任何分支提前 resolve。
  const masked = mapContains(value, (contains) => {
    prepared.push(variables.prepareValue(contains, context));
    return ["变量占位"];
  });
  parseEvidenceExpect(masked);
  let index = 0;
  // 统一求值后重跑字段 schema；显式声明的 undefined 不能被当成字段缺省而静默放行。
  const resolved = mapContains(masked, () => {
    const value = prepared[index++]!.resolve();
    if (value === undefined) {
      throw new TypeError("evidence.toolResult.contains 求值不得为 undefined");
    }
    return value;
  });
  return parseEvidenceExpect(resolved);
}

/**
 * 对已校验声明执行内容判定，并组合具名诊断。
 *
 * @behavior evidence-boolean-evaluation
 * Given: 当前 turn、严格 EvidenceExpect、workspace resolver 和变量诊断脱敏标记。
 * When: 逐节点评估 toolResult/citation，或递归处理 not/allOf。
 * Then: not 只翻转内容布尔值；allOf 保留每个子项的 pass/fail 原因；
 * 脱敏标记沿整棵声明树传递。
 * Failure: 定义错误和观察错误继续向上抛出，不被 not 否定或被 allOf 转成普通 miss。
 */
function evaluateEvidence(
  turn: TurnObservation,
  expect: EvidenceExpect,
  resolver: WorkspaceResolver | undefined,
  maskResolvedContains: boolean,
): EvidenceVerdict {
  if ("toolResult" in expect)
    return evaluateToolResult(
      turn,
      expect.toolResult,
      resolver,
      maskResolvedContains,
    );
  if ("citation" in expect)
    return evaluateCitation(turn, expect.citation, resolver);
  if ("not" in expect) {
    const child = evaluateEvidence(
      turn,
      expect.not,
      resolver,
      maskResolvedContains,
    );
    return {
      pass: !child.pass,
      reason:
        (child.pass ? "出现禁止证据：" : "未出现禁止证据：") + child.reason,
    };
  }
  const children = expect.allOf.map((child) => ({
    name: child.name!,
    result: evaluateEvidence(turn, child, resolver, maskResolvedContains),
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
 * 创建通用证据判据；workspace 与变量解析器均由调用方显式注入。
 *
 * @behavior evidence-criterion-factory
 * Given: 调用方显式提供可选 workspace 与变量解析器。
 * When: Runner 请求评估一个 turn。
 * Then: 先完整准备并校验声明和观察，再返回统一 CriterionResult；
 * 变量只开放 toolResult.contains，变量模式下诊断不回显解析值。
 * Failure: 声明、配置或观察错误显式抛出，不伪装成内容 pass/fail。
 * @param options 可选 workspace 与变量解析器；变量仅开放 toolResult.contains。
 * @returns metric 名为 evidence 的 TurnCriterion。
 */
export function createEvidenceCriterion(
  options: EvidenceCriterionOptions = {},
): TurnCriterion {
  return {
    name: "evidence",
    scope: "turn",
    evaluate(turn, context) {
      const expect = prepareExpect(context.expect, options.variables, context);
      assertEvidenceObservation(turn);
      const result = evaluateEvidence(
        turn,
        expect,
        options.resolveWorkspaceCwd,
        options.variables !== undefined,
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
  EvidenceVariableResolver,
  PreparedEvidenceVariableValue,
  ToolResultEvidenceExpect,
  WorkspaceResourceExpect,
} from "./types.ts";
