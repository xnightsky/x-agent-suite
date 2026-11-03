/**
 * @module @x-agent-suite/assertions/evidence/types
 * 通用证据判据的公开声明类型，不包含任何具体被测系统语义。
 */
import type {
  TurnCriterionContext,
  TurnObservation,
} from "@x-agent-suite/contracts";
/** workspace 内资源的输入字段与逻辑路径声明。 */
export interface WorkspaceResourceExpect {
  /** 工具 input 中承载路径的顶层字段名。 */
  readonly arg: string;
  /** 严格的 workspace 相对 POSIX 资源路径。 */
  readonly resource: string;
}

/** 成功且非空工具结果证据的声明。 */
export interface ToolResultEvidenceExpect {
  /** 期望工具裸名，匹配规则与 tool-call 一致。 */
  readonly tool: string;
  /** 可选 action 精确匹配。 */
  readonly action?: string;
  /** 可选工具入参递归子集约束。 */
  readonly args?: Record<string, unknown>;
  /** 可选 workspace 资源身份约束。 */
  readonly path?: WorkspaceResourceExpect;
  /** 可选正文片段清单；有路径时跨同路径有效读取聚合，无路径时要求同次调用命中。 */
  readonly contains?: readonly string[];
}

/** 回答引用必须对应同路径成功非空读取的声明。 */
export interface CitationEvidenceExpect {
  /** 期望读取工具裸名。 */
  readonly tool: string;
  /** 可选 action 精确匹配。 */
  readonly action?: string;
  /** 可选其他工具入参递归子集约束。 */
  readonly args?: Record<string, unknown>;
  /** 工具 input 中承载路径的顶层字段名。 */
  readonly pathArg: string;
  /** 回答必须出现且实读必须匹配的 workspace 相对 POSIX 路径。 */
  readonly path: string;
  /** 同路径多次成功非空读取的聚合正文必须包含的片段。 */
  readonly contains?: readonly string[];
}

interface EvidenceNodeName {
  /** 组合诊断使用的稳定名称；allOf 的直接子项必填且同级唯一。 */
  readonly name?: string;
}

/** evidence 判据的可组合声明节点。 */
export type EvidenceExpect = EvidenceNodeName &
  (
    | {
        /** 成功且非空工具结果证据。 */
        readonly toolResult: ToolResultEvidenceExpect;
      }
    | {
        /** 回答引用与同路径实读关联证据。 */
        readonly citation: CitationEvidenceExpect;
      }
    | {
        /** 所有命名子项均满足才通过。 */
        readonly allOf: readonly EvidenceExpect[];
      }
    | {
        /** 对同一证据谓词取反；定义与观察错误不取反。 */
        readonly not: EvidenceExpect;
      }
  );

/** 已准备的判据变量值；由调用方完成全树准备后再求值。 */
export interface PreparedEvidenceVariableValue {
  /** 同步返回变量求值结果。 */
  readonly resolve: () => unknown;
}

/** evidence 可显式接收的通用变量解析接口；不依赖任何变量实现。 */
export interface EvidenceVariableResolver {
  /** 绑定当前 turn 判据上下文并准备值。 */
  readonly prepareValue: (
    value: unknown,
    context: TurnCriterionContext,
  ) => PreparedEvidenceVariableValue;
}

/** evidence 判据工厂选项。 */
export interface EvidenceCriterionOptions {
  /** 按当前 turn 动态提供可信 workspace；仅路径断言需要。 */
  readonly resolveWorkspaceCwd?: (turn: TurnObservation) => string | undefined;
  /** 仅为 toolResult.contains 显式启用变量；其他字段保持原义。 */
  readonly variables?: EvidenceVariableResolver;
}
