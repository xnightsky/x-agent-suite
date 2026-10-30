/** 测试注册表：Criterion、通用判据工厂、fake transport、CLI/临时 Client profile 与 EffectsProfile；零真实网络。 */
import { MockDriver } from "@x-agent-suite/driver";
import { textContains } from "@x-agent-suite/criteria";
import type {
  TurnCriterionContext,
  TurnObservation,
} from "@x-agent-suite/contracts";
import type {
  RecallCriterionFactoryContext,
  RecallRegistry,
} from "../../src/registry.ts";
import { createDirectClient } from "./direct-client.ts";

export interface RecallRegistryTestState {
  transports: { model: string; messageCount: number }[];
  profiles: {
    cliRef?: string;
    clientRef?: string;
    backendCarrier: string;
    effects: string;
    provision: unknown;
  }[];
  factoryCalls: {
    carrier: string;
    model: string;
    hasConfig: boolean;
    hasTags: boolean;
    tagCliIds: string[];
    liveReviewApproved: boolean;
    cliRef?: string;
    clientRef?: string;
    effects: string;
  }[];
}

const globalState = globalThis as typeof globalThis & {
  __xasRecallRegistryTest?: RecallRegistryTestState;
};
globalState.__xasRecallRegistryTest = {
  transports: [],
  profiles: [],
  factoryCalls: [],
};

/** 通用判据工厂夹具：记录同源装配上下文，产出按 expect 子串判定的 turn 判据。 */
const echoFactory = {
  name: "fixture-echo",
  scope: "turn" as const,
  create: (context: RecallCriterionFactoryContext) => {
    globalState.__xasRecallRegistryTest!.factoryCalls.push({
      carrier: context.target.carrier,
      model: context.target.channel.model,
      hasConfig: typeof context.config === "object" && context.config !== null,
      hasTags: typeof context.tags === "object" && context.tags !== null,
      tagCliIds: context.tags.instances.cli.map((instance) => instance.id),
      liveReviewApproved: context.liveReviewApproved,
      ...(context.cliRef ? { cliRef: context.cliRef } : {}),
      ...(context.clientRef ? { clientRef: context.clientRef } : {}),
      effects: context.effects.attribution,
    });
    return {
      name: "fixture-echo",
      scope: "turn" as const,
      evaluate: (
        turn: TurnObservation,
        criterionContext: TurnCriterionContext,
      ) => {
        const needle = String(criterionContext.expect ?? "");
        const hit = needle.length > 0 && turn.text.includes(needle);
        return {
          pass: hit,
          score: hit ? 1 : 0,
          reason: hit ? "命中 expect" : "未命中 expect",
        };
      },
    };
  },
};

const registry: RecallRegistry = {
  criteria: [textContains, echoFactory],
  transport: async (request) => {
    const body = request.body as {
      model: string;
      messages: { role: string; content: string }[];
    };
    globalState.__xasRecallRegistryTest!.transports.push({
      model: body.model,
      messageCount: body.messages.length,
    });
    const text = body.messages[body.messages.length - 1]!.content;
    return {
      status: 200,
      text: JSON.stringify({
        choices: [{ message: { role: "assistant", content: text } }],
      }),
    };
  },
  profiles: {
    "fixture-direct": {
      carrier: "fixture-carrier",
      createDriver: ({ backend }) => createDirectClient(backend),
    },
    "fixture-cli-0": {
      carrier: "fixture-carrier",
      createDriver: (context) => {
        globalState.__xasRecallRegistryTest!.profiles.push({
          cliRef: context.cliRef,
          ...(context.clientRef ? { clientRef: context.clientRef } : {}),
          backendCarrier: context.backend.carrier,
          effects: context.effects.attribution,
          provision: context.spec.provision,
        });
        return new MockDriver();
      },
    },
    "fixture-client-0": {
      carrier: "fixture-ephemeral",
      createDriver: (context) => {
        globalState.__xasRecallRegistryTest!.profiles.push({
          ...(context.cliRef ? { cliRef: context.cliRef } : {}),
          ...(context.clientRef ? { clientRef: context.clientRef } : {}),
          backendCarrier: context.backend.carrier,
          effects: context.effects.attribution,
          provision: context.spec.provision,
        });
        return new MockDriver();
      },
    },
  },
  effectsProfiles: {
    "safe-read": {
      tools: "read-only",
      commands: { allow: ["read-file"], deny: [] },
      maxSteps: 2,
      timeoutMs: 10_000,
      workspace: "isolated",
      cleanup: "required",
    },
  },
};

export default registry;
