/**
 * @module examples/tutorial/judge-pi
 * 消费者侧最小接线：公开 Judge client + Pi borrowed driver；不包装裁判生命周期。
 */
import { createJudgeClient, type JudgeClient } from "@x-agent-suite/judge";
import type {
  LiveConfigOptions,
  ResolvedLiveTarget,
  TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";
import type { RecallEffects } from "@x-agent-suite/recall";
import {
  createPiRecallDriver,
  type PiRecallDriverOptions,
} from "../../../profiles/pi-recall.ts";

const JUDGE_EFFECTS: RecallEffects = {
  kind: "none",
  attribution: "none",
  tools: "none",
  commands: { allow: [], deny: [] },
  maxSteps: 1,
  timeoutMs: 5_000,
  workspace: "isolated",
  cleanup: "required",
};

/** 创建裁判 client 所需的消费者显式输入。 */
export interface PiJudgeExampleOptions {
  /** 已解析且与本次获批范围同源的完整 target。 */
  readonly target: ResolvedLiveTarget;
  /** 与 target 配套的通用能力目录。 */
  readonly tags: TargetTagCatalog;
  /** 本次运行的渠道、隔离 HOME 与借用 hooks。 */
  readonly config: LiveConfigOptions;
  /** 受信任调用方对本次裁判的显式批准；不是从 Recall 推断。 */
  readonly liveReviewApproved: boolean;
  /** 仅离线示例使用的合成 CLI；生产调用应省略。 */
  readonly commandOverride?: PiRecallDriverOptions["commandOverride"];
}

/**
 * 用公开工厂创建单轮、无工具、无项目上下文/Skills 的 borrowed Judge client。
 * createDriver 只做上下文形状适配，start/sendPrompt/close 全由既有实现负责。
 */
export function createPiJudgeClient(
  options: PiJudgeExampleOptions,
): JudgeClient {
  return createJudgeClient({
    target: options.target,
    tags: options.tags,
    config: options.config,
    liveReviewApproved: options.liveReviewApproved,
    mode: "borrowed",
    toolPolicy: "none",
    createDriver: ({ backend, target, cliRef }) =>
      createPiRecallDriver(
        {
          backend,
          target,
          cliRef,
          spec: { id: "judge/single-turn", turns: [{ send: "judge" }] },
          effects: JUDGE_EFFECTS,
          executionParams: {},
        },
        {
          ...(options.commandOverride
            ? { commandOverride: options.commandOverride }
            : {}),
        },
      ),
  });
}
