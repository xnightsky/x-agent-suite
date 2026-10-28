/**
 * @module @x-agent-suite/recall/execution
 * 仅按 Carrier kind 选择真实 CLI borrowed 或临时 Client direct Adapter；不在 Plan DSL 暴露 mode/cliRef。
 * 不变量：live 与 TargetTags fail-closed；borrowed 候选与注册 profile 的交集必须唯一。
 */
import {
  decideLiveTarget,
  type LiveTargetDecision,
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
  /** 由 Carrier kind 固定，不由 Plan DSL 或运行参数指定。 */
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

/** borrowed 测试暂不按计费分类过滤；运行能力与 live 审批仍由同一次决策校验。 */
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
    anyOf: [["cli.io.text", "cli.io.jsonl"]],
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

function selectBorrowed(
  target: ResolvedLiveTarget,
  decision: LiveTargetDecision,
  registry: RecallRegistry,
): RecallResolvedExecution {
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
  const cliRef = candidates[0]!.cliRef!;
  return {
    target,
    mode: "borrowed",
    cliRef,
    profile: registry.profiles[cliRef]!,
  };
}

/** ephemeral-client 直接产出完整 direct Adapter；不得回退其他实现。 */
function selectEphemeralClient(
  target: ResolvedLiveTarget,
  decision: LiveTargetDecision,
  registry: RecallRegistry,
): RecallResolvedExecution {
  const direct = decision.candidates.filter(({ mode }) => mode === "direct");
  if (direct.length !== 1) {
    throw decisionError(
      target,
      decision.live.status,
      "direct",
      decision.evaluations,
    );
  }
  const clientRef = target.clientRef;
  const profile = clientRef ? registry.profiles[clientRef] : undefined;
  if (!clientRef || profile?.carrier !== target.carrier) {
    throw new Error(
      "Recall ephemeral-client 执行实现未唯一确定：" +
        JSON.stringify({ carrier: target.carrier, clientRef }),
    );
  }
  return { target, mode: "direct", clientRef, profile };
}

/** 按 Carrier kind 解析一个 target；effects 只约束能力，不切换执行路径。 */
export function resolveRecallExecution(options: {
  readonly target: ResolvedLiveTarget;
  readonly catalog: TargetTagCatalog;
  readonly effects: RecallEffects;
  readonly registry: RecallRegistry;
  readonly liveReviewApproved: boolean;
}): RecallResolvedExecution {
  const decision = decideLiveTarget(options.target, options.catalog, {
    requirements: requirements(options.effects),
    live: true,
    liveReviewApproved: options.liveReviewApproved,
  });
  return options.target.kind === "ephemeral-client"
    ? selectEphemeralClient(options.target, decision, options.registry)
    : selectBorrowed(options.target, decision, options.registry);
}
