/** 测试注册表：Criterion、fake transport、borrowed profile 与 EffectsProfile；零真实网络。 */
import { MockDriver } from "@x-agent-suite/driver";
import { textContains } from "@x-agent-suite/criteria";
import type { RecallRegistry } from "../../src/registry.ts";

export interface RecallRegistryTestState {
  transports: { model: string; messageCount: number }[];
  profiles: {
    cliRef: string;
    effects: string;
    provision: unknown;
  }[];
}

const globalState = globalThis as typeof globalThis & {
  __xasRecallRegistryTest?: RecallRegistryTestState;
};
globalState.__xasRecallRegistryTest = { transports: [], profiles: [] };

const registry: RecallRegistry = {
  criteria: [textContains],
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
    "fixture-cli-0": {
      carrier: "fixture-carrier",
      createDriver: (context) => {
        globalState.__xasRecallRegistryTest!.profiles.push({
          cliRef: context.cliRef,
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
