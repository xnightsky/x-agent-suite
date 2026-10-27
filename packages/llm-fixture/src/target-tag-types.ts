/**
 * @module @x-agent-suite/llm-fixture/target-tag-types
 * TargetTags 词典、四层实例与访问决策的公开类型。
 * 不变量：类型只表达通用身份与能力，不枚举具体 CLI、provider 或 model。
 */
import type {
  LiveConfigLoad,
  LiveConfigSource,
  LiveTargetSelection,
  ResolvedLiveTarget,
} from "./live-types.ts";

/** 标签作用域。 */
export type TargetTagScope = "cli" | "provider" | "provider-model" | "model";

/** TagKey 的维护状态。 */
export type TargetTagStatus = "maintained" | "reserved" | "deprecated";

/** 一个已注册的 TagKey 及其合法 TagValue。 */
export interface TargetTagKey {
  readonly key: string;
  readonly scope: TargetTagScope;
  readonly dimension: string;
  readonly status: TargetTagStatus;
  readonly values: readonly string[];
}

/** 机器可读 TagKey/TagValue 词典。 */
export interface TargetTagDictionary {
  readonly version: 1;
  readonly keys: readonly TargetTagKey[];
}

/** CLI 调用 profile 的能力实例。 */
export interface CliTags {
  readonly id: string;
  readonly carrier: string;
  readonly wires: readonly string[];
  readonly tags: readonly string[];
}

/** provider 级默认认证、使用范围与敏感策略实例。 */
export interface ProviderTags {
  readonly id: string;
  readonly tags: readonly string[];
}

/** provider 与模型别名组合的差异实例。 */
export interface ProviderModelTags {
  readonly id: string;
  readonly providerRef: string;
  readonly model: string;
  readonly modelRef?: string;
  readonly modelRevision?: string;
  readonly wire?: string;
  readonly tags: readonly string[];
}

/** canonical model/revision 的自身能力实例。 */
export interface ModelTags {
  readonly id: string;
  readonly revision?: string;
  readonly tags: readonly string[];
}

/** 四层 TargetTags 实例集合。 */
export interface TargetTagInstances {
  readonly cli: readonly CliTags[];
  readonly providers: readonly ProviderTags[];
  readonly providerModels: readonly ProviderModelTags[];
  readonly models: readonly ModelTags[];
}

/** 决策使用的词典与实例目录。 */
export interface TargetTagCatalog {
  readonly dictionary: TargetTagDictionary;
  readonly instances: TargetTagInstances;
}

/** 一组能力需求：allOf 逐项满足，anyOf 每组至少满足一项。 */
export interface TargetTagRequirement {
  readonly allOf?: readonly string[];
  readonly anyOf?: readonly (readonly string[])[];
}

/** direct 与 borrowed 的通用访问模式。 */
export type TargetAccessMode = "direct" | "borrowed";

/** 合并后的 live 敏感策略。 */
export type LivePolicyStatus =
  "disallowed" | "review-required" | "allowed" | "unknown";

/** 当前调用的 live 策略与审批结果。 */
export interface LivePolicyDecision {
  readonly status: LivePolicyStatus;
  readonly allowed: boolean;
}

/** 一种访问模式的完整评估；missingGroups 中每组至少缺一项时才失败。 */
export interface TargetModeEvaluation {
  readonly mode: TargetAccessMode;
  readonly cliRef?: string;
  readonly allowed: boolean;
  readonly missingGroups: readonly (readonly string[])[];
  readonly issues: readonly string[];
}

/** 一个完整 target 的四层决策结果。 */
export interface LiveTargetDecision {
  readonly target: ResolvedLiveTarget;
  readonly live: LivePolicyDecision;
  readonly evaluations: readonly TargetModeEvaluation[];
  readonly candidates: readonly TargetModeEvaluation[];
}

/** 多目标访问决策结果；target 解析失败沿用 not-configured。 */
export type LiveTargetDecisionResult =
  | {
      readonly kind: "configured";
      readonly source: LiveConfigSource;
      readonly decisions: readonly LiveTargetDecision[];
    }
  | { readonly kind: "not-configured"; readonly reason: string };

/** live target 决策参数；live 缺省为 true，审批缺省为 false。 */
export interface TargetDecisionOptions {
  readonly selection?: LiveTargetSelection;
  readonly requirements: Readonly<
    Record<TargetAccessMode, TargetTagRequirement>
  >;
  readonly live?: boolean;
  readonly liveReviewApproved?: boolean;
}

/** TargetTags 文件加载参数；显式路径优先，liveConfig 用于合并同文件根级私密覆盖。 */
export interface LoadTargetTagCatalogOptions {
  readonly repoRoot?: string;
  readonly dictionaryPath?: string;
  readonly instancesPath?: string;
  readonly liveConfig?: LiveConfigLoad;
}
