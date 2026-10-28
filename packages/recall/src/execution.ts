/**
 * @module @x-agent-suite/recall/execution
 * 按 Carrier kind、effects 与场景需求选择内置 direct、borrowed 或临时 Client Adapter；不在 Plan DSL 暴露 mode/cliRef。
 * 不变量：live 与 TargetTags fail-closed；borrowed 候选与注册 profile 的交集必须唯一。
 */
import {
  decideLiveTarget,
  type ResolvedLiveTarget,
  type TargetAccessDecisionOptions,
  type TargetAccessMode,
  type TargetTagCatalog,
  type TargetTagRequirement,
} from "@x-agent-suite/llm-fixture";
import type { RecallEffects } from "./effects.ts";
import type { RecallExecutionProfile, RecallRegistry } from "./registry.ts";

/** 一个已确定的 target 执行实现。 */
export interface RecallResolvedExecution {
  /** 完整 carrier/provider/model。 */
  readonly target: ResolvedLiveTarget;
  /** 由 effects 和场景需求推导，不由 Plan DSL 指定。 */
  readonly mode: TargetAccessMode;
  /** borrowed 的唯一注册 profile。 */
  readonly cliRef?: string;
  /** ephemeral-client 的注册实现引用。 */
  readonly clientRef?: string;
  /** CLI 或临时 Client 创建 Driver 的注册实现。 */
  readonly profile?: RecallExecutionProfile;
}

const DIRECT_REQUIREMENTS: TargetTagRequirement = {
  allOf: ["provider-model.api.complete", "model.inference.chat"],
  anyOf: [
    [
      "provider-model.usage.api-payg",
      "provider-model.usage.api-credit",
      "provider-model.usage.api-free",
    ],
  ],
};

function borrowedRequirements(effects: RecallEffects): TargetTagRequirement {
  const toolTags =
    effects.tools === "none"
      ? ["cli.tools.none"]
      : effects.tools === "read-only"
        ? ["cli.tools.allowlist", "cli.tools.read-only"]
        : ["cli.tools.allowlist"];
  return {
    allOf: [
      "cli.execution.one-shot",
      "cli.execution.unattended",
      "cli.session.ephemeral",
      "cli.context.context-files.off",
      "cli.context.extensions.off",
      "cli.context.skills.off",
      "model.inference.chat",
      ...toolTags,
    ],
    anyOf: [
      [
        "provider-model.usage.cli-subscription",
        "provider-model.usage.ci-subscription",
        "provider-model.usage.third-party-subscription",
        "provider-model.usage.cli-free",
      ],
      ["cli.io.text", "cli.io.jsonl"],
    ],
  };
}

function requirements(
  effects: RecallEffects,
): TargetAccessDecisionOptions["requirements"] {
  return {
    direct: DIRECT_REQUIREMENTS,
    borrowed: borrowedRequirements(effects),
  };
}

function decisionError(
  target: ResolvedLiveTarget,
  live: string,
  mode: TargetAccessMode,
  details: unknown,
): Error {
  return new Error(
    "Recall 执行实现未唯一确定：" +
      JSON.stringify({
        target: {
          carrier: target.carrier,
          provider: target.channel.provider,
          model: target.channel.model,
        },
        live,
        requiredMode: mode,
        details,
      }),
  );
}

function selectDirect(
  target: ResolvedLiveTarget,
  catalog: TargetTagCatalog,
  effects: RecallEffects,
  liveReviewApproved: boolean,
): RecallResolvedExecution {
  const decision = decideLiveTarget(target, catalog, {
    requirements: requirements(effects),
    live: true,
    liveReviewApproved,
  });
  const candidates = decision.candidates.filter(
    ({ mode }) => mode === "direct",
  );
  if (candidates.length !== 1) {
    throw decisionError(
      target,
      decision.live.status,
      "direct",
      decision.evaluations,
    );
  }
  return { target, mode: "direct" };
}

function selectBorrowed(
  target: ResolvedLiveTarget,
  catalog: TargetTagCatalog,
  effects: RecallEffects,
  registry: RecallRegistry,
  liveReviewApproved: boolean,
): RecallResolvedExecution {
  const decision = decideLiveTarget(target, catalog, {
    requirements: requirements(effects),
    live: true,
    liveReviewApproved,
  });
  const candidates = decision.candidates.filter(
    (candidate) =>
      candidate.mode === "borrowed" &&
      candidate.cliRef !== undefined &&
      registry.profiles[candidate.cliRef]?.carrier === target.carrier,
  );
  if (candidates.length !== 1) {
    throw decisionError(
      target,
      decision.live.status,
      "borrowed",
      decision.evaluations.map((evaluation) => ({
        mode: evaluation.mode,
        cliRef: evaluation.cliRef,
        allowed: evaluation.allowed,
        registered:
          evaluation.cliRef !== undefined &&
          registry.profiles[evaluation.cliRef]?.carrier === target.carrier,
        missingGroups: evaluation.missingGroups,
        issues: evaluation.issues,
      })),
    );
  }
  const selected = candidates[0]!;
  return {
    target,
    mode: "borrowed",
    cliRef: selected.cliRef!,
    profile: registry.profiles[selected.cliRef!]!,
  };
}

/** 选择 ephemeral-client 的自定义 direct Adapter；不得回退内置 direct。 */
function selectEphemeralClient(
  target: ResolvedLiveTarget,
  catalog: TargetTagCatalog,
  effects: RecallEffects,
  registry: RecallRegistry,
  liveReviewApproved: boolean,
): RecallResolvedExecution {
  const selected = selectDirect(target, catalog, effects, liveReviewApproved);
  const clientRef = target.clientRef;
  const profile = clientRef ? registry.profiles[clientRef] : undefined;
  if (!clientRef || profile?.carrier !== target.carrier) {
    throw new Error(
      "Recall ephemeral-client 执行实现未唯一确定：" +
        JSON.stringify({ carrier: target.carrier, clientRef }),
    );
  }
  return { ...selected, clientRef, profile };
}

/** 解析一个 target；requireBorrowed 由显式 effects 或场景 provision 在外层推导。 */
export function resolveRecallExecution(options: {
  readonly target: ResolvedLiveTarget;
  readonly catalog: TargetTagCatalog;
  readonly effects: RecallEffects;
  readonly registry: RecallRegistry;
  readonly requireBorrowed: boolean;
  readonly liveReviewApproved: boolean;
}): RecallResolvedExecution {
  if (options.target.kind === "ephemeral-client") {
    return selectEphemeralClient(
      options.target,
      options.catalog,
      options.effects,
      options.registry,
      options.liveReviewApproved,
    );
  }
  return options.requireBorrowed
    ? selectBorrowed(
        options.target,
        options.catalog,
        options.effects,
        options.registry,
        options.liveReviewApproved,
      )
    : selectDirect(
        options.target,
        options.catalog,
        options.effects,
        options.liveReviewApproved,
      );
}
