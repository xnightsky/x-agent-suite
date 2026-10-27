/**
 * @module @x-agent-suite/llm-fixture/target-tag-decision
 * 用四层 TargetTags 评估完整 live target 的 direct/borrowed 候选与 live 门禁。
 * 不变量：复用 resolveLiveTargets；不选择模型、不发起调用、不跨模式回退。
 */
import { resolveLiveTargets } from "./live-targets.ts";
import type { LiveConfigLoad, ResolvedLiveTarget } from "./live-types.ts";
import { assertTargetTagId, TargetTagDefinitionError } from "./target-tags.ts";
import type {
  CliTags,
  LivePolicyDecision,
  LiveTargetDecision,
  LiveTargetDecisionResult,
  ModelTags,
  ProviderModelTags,
  ProviderTags,
  TargetAccessMode,
  TargetAccessDecisionOptions,
  TargetDecisionOptions,
  TargetModeEvaluation,
  TargetTagCatalog,
  TargetTagRequirement,
} from "./target-tag-types.ts";

type RequirementGroups = readonly (readonly string[])[];
type ModeRequirements = Readonly<Record<TargetAccessMode, RequirementGroups>>;

function fail(message: string): never {
  throw new TargetTagDefinitionError(message);
}

function normalizeRequirement(
  requirement: TargetTagRequirement,
  catalog: TargetTagCatalog,
  mode: TargetAccessMode,
): RequirementGroups {
  if (!requirement || typeof requirement !== "object") {
    fail(mode + " requirements 必填");
  }
  const allOf = requirement.allOf ?? [];
  const anyOf = requirement.anyOf ?? [];
  if (!Array.isArray(allOf) || !Array.isArray(anyOf)) {
    fail(mode + " requirements.allOf/anyOf 必须是数组");
  }
  const groups: string[][] = [
    ...allOf.map((tag) => [tag]),
    ...anyOf.map((group, index) => {
      if (!Array.isArray(group) || group.length === 0) {
        fail(mode + " requirements.anyOf[" + index + "] 必须非空");
      }
      return [...group];
    }),
  ];
  for (const tag of groups.flat()) {
    if (typeof tag !== "string") fail(mode + " requirements 含非字符串 TagId");
    assertTargetTagId(catalog.dictionary, tag);
    if (mode === "direct" && tag.startsWith("cli.")) {
      fail("direct requirements 不得依赖 CliTags：" + tag);
    }
  }
  return groups;
}

interface ProviderModelMatch {
  readonly instance?: ProviderModelTags;
  readonly issue?: string;
}

function matchProviderModel(
  target: ResolvedLiveTarget,
  instances: readonly ProviderModelTags[],
): ProviderModelMatch {
  const channel = target.channel;
  const identities = instances.filter(
    (instance) =>
      instance.providerRef === channel.provider &&
      instance.model === channel.model,
  );
  if (identities.length === 0) {
    return { issue: "未声明 target 对应的 ProviderModelTags" };
  }
  const wired = identities.filter((instance) => instance.wire === channel.wire);
  const unknownWire = identities.filter(
    (instance) => instance.wire === undefined,
  );
  const matches = wired.length > 0 ? wired : unknownWire;
  const instance = matches[0];
  if (matches.length !== 1 || !instance) {
    return { issue: "ProviderModelTags 的 wire 不兼容或存在歧义" };
  }
  return { instance };
}

function resolveLivePolicy(
  provider: ProviderTags | undefined,
  providerModel: ProviderModelTags | undefined,
  reviewApproved: boolean,
): LivePolicyDecision {
  if (!provider || !providerModel) {
    return { status: "unknown", allowed: false };
  }
  const tags = new Set([...provider.tags, ...providerModel.tags]);
  for (const status of ["disallowed", "review-required", "allowed"] as const) {
    const hit =
      tags.has("provider.usage.live." + status) ||
      tags.has("provider-model.usage.live." + status);
    if (hit) {
      return {
        status,
        allowed:
          status === "allowed" ||
          (status === "review-required" && reviewApproved),
      };
    }
  }
  return { status: "unknown", allowed: false };
}

function inheritProviderDimension(
  provider: ProviderTags | undefined,
  providerModel: ProviderModelTags | undefined,
  dimension: "auth" | "usage",
  tags: Set<string>,
): void {
  const providerPrefix = "provider." + dimension + ".";
  const modelPrefix = "provider-model." + dimension + ".";
  const nonLive = (tag: string) =>
    dimension !== "usage" ||
    (!tag.startsWith("provider.usage.live.") &&
      !tag.startsWith("provider-model.usage.live."));
  const overridden = providerModel?.tags.some(
    (tag) => tag.startsWith(modelPrefix) && nonLive(tag),
  );
  if (overridden) return;
  for (const tag of provider?.tags ?? []) {
    if (tag.startsWith(providerPrefix) && nonLive(tag)) {
      tags.add(modelPrefix + tag.slice(providerPrefix.length));
    }
  }
}

function effectiveTags(
  provider: ProviderTags | undefined,
  providerModel: ProviderModelTags | undefined,
  model: ModelTags | undefined,
): Set<string> {
  const tags = new Set([
    ...(provider?.tags ?? []),
    ...(providerModel?.tags ?? []),
    ...(model?.tags ?? []),
  ]);
  inheritProviderDimension(provider, providerModel, "auth", tags);
  inheritProviderDimension(provider, providerModel, "usage", tags);
  return tags;
}

function evaluateMode(
  mode: TargetAccessMode,
  cliRef: string | undefined,
  tags: Set<string>,
  groups: RequirementGroups,
  issues: readonly string[],
  live: LivePolicyDecision,
  liveRequired: boolean,
): TargetModeEvaluation {
  const missingGroups = groups.filter(
    (group) => !group.some((tag) => tags.has(tag)),
  );
  const allowed =
    issues.length === 0 &&
    missingGroups.length === 0 &&
    (!liveRequired || live.allowed);
  return {
    mode,
    ...(cliRef ? { cliRef } : {}),
    allowed,
    missingGroups,
    issues,
  };
}

function evaluateBorrowed(
  profiles: readonly CliTags[],
  commonTags: Set<string>,
  commonIssues: readonly string[],
  providerModel: ProviderModelTags | undefined,
  target: ResolvedLiveTarget,
  groups: RequirementGroups,
  live: LivePolicyDecision,
  liveRequired: boolean,
): readonly TargetModeEvaluation[] {
  const candidates: (CliTags | undefined)[] =
    profiles.length > 0 ? [...profiles] : [undefined];
  return candidates.map((cli) => {
    const tags = new Set([...commonTags, ...(cli?.tags ?? [])]);
    const issues = [...commonIssues];
    if (!cli) issues.push("未声明 target carrier 对应的 CliTags");
    if (cli && cli.wires.length === 0) issues.push("CliTags wire 未声明");
    if (
      cli &&
      cli.wires.length > 0 &&
      !cli.wires.includes(target.channel.wire)
    ) {
      issues.push("CliTags 与 target wire 不兼容");
    }
    if (providerModel && !providerModel.wire) {
      issues.push("ProviderModelTags wire 未声明，不能验证 borrowed 兼容性");
    }
    return evaluateMode(
      "borrowed",
      cli?.id,
      tags,
      groups,
      issues,
      live,
      liveRequired,
    );
  });
}

function decideTarget(
  target: ResolvedLiveTarget,
  catalog: TargetTagCatalog,
  requirements: ModeRequirements,
  options: TargetDecisionOptions,
): LiveTargetDecision {
  const { instances } = catalog;
  const provider = instances.providers.find(
    ({ id }) => id === target.channel.provider,
  );
  const matched = matchProviderModel(target, instances.providerModels);
  const providerModel = matched.instance;
  const model = instances.models.find(
    (instance) =>
      instance.id === providerModel?.modelRef &&
      instance.revision === providerModel.modelRevision,
  );
  const issues: string[] = [];
  if (!provider) issues.push("未声明 target 对应的 ProviderTags");
  if (matched.issue) issues.push(matched.issue);
  if (providerModel?.modelRef && !model) {
    issues.push("ProviderModelTags 的 modelRef/revision 无法归一");
  }
  const live = resolveLivePolicy(
    provider,
    providerModel,
    options.liveReviewApproved ?? false,
  );
  const tags = effectiveTags(provider, providerModel, model);
  const liveRequired = options.live ?? true;
  const direct = evaluateMode(
    "direct",
    undefined,
    tags,
    requirements.direct,
    issues,
    live,
    liveRequired,
  );
  const profiles = instances.cli.filter(
    ({ carrier }) => carrier === target.carrier,
  );
  const borrowed = evaluateBorrowed(
    profiles,
    tags,
    issues,
    providerModel,
    target,
    requirements.borrowed,
    live,
    liveRequired,
  );
  const evaluations = [direct, ...borrowed];
  return {
    target,
    live,
    evaluations,
    candidates: evaluations.filter(({ allowed }) => allowed),
  };
}

function normalizeRequirements(
  options: TargetAccessDecisionOptions,
  catalog: TargetTagCatalog,
): ModeRequirements {
  if (!options?.requirements) fail("TargetTags requirements 必填");
  return {
    direct: normalizeRequirement(
      options.requirements.direct,
      catalog,
      "direct",
    ),
    borrowed: normalizeRequirement(
      options.requirements.borrowed,
      catalog,
      "borrowed",
    ),
  };
}

/** 评估一个已解析完整 target，不要求调用方重建 LiveConfigLoad。 */
export function decideLiveTarget(
  target: ResolvedLiveTarget,
  catalog: TargetTagCatalog,
  options: TargetAccessDecisionOptions,
): LiveTargetDecision {
  const requirements = normalizeRequirements(options, catalog);
  return decideTarget(target, catalog, requirements, options);
}

/** 复用现有 target 解析并评估全部 direct/borrowed 候选；live 默认要求放行。 */
export function decideLiveTargets(
  load: LiveConfigLoad,
  catalog: TargetTagCatalog,
  options: TargetDecisionOptions,
): LiveTargetDecisionResult {
  const requirements = normalizeRequirements(options, catalog);
  const resolved = resolveLiveTargets(load, options.selection ?? {});
  if (resolved.kind !== "configured") return resolved;
  return {
    kind: "configured",
    source: resolved.source,
    decisions: resolved.targets.map((target) =>
      decideTarget(target, catalog, requirements, options),
    ),
  };
}
