/** 测试运行配置：记录 driver 生命周期，不访问真实宿主或模型。 */
import { MockDriver } from "@x-agent-suite/driver";
import { textContains } from "@x-agent-suite/criteria";
import type { RecallConfig } from "../../src/config.ts";

export interface RecallTestState {
  created: string[];
  closed: string[];
  drivers: object[];
}

const state = globalThis as typeof globalThis & {
  __xasRecallTest?: RecallTestState;
};
state.__xasRecallTest = { created: [], closed: [], drivers: [] };

class TrackedDriver extends MockDriver {
  override async close(reason?: string): Promise<void> {
    state.__xasRecallTest!.closed.push("closed");
    await super.close(reason);
  }

  override async sendPrompt(text: string) {
    const observation = await super.sendPrompt(text);
    return {
      ...observation,
      carrier: "fixture-carrier",
      metadata: { provider: "fixture-provider", model: "fixture-model" },
    };
  }
}

const config: RecallConfig = {
  createDriver: (spec) => {
    state.__xasRecallTest!.created.push(spec.id);
    const driver = new TrackedDriver();
    state.__xasRecallTest!.drivers.push(driver);
    return driver;
  },
  criteria: [textContains],
  repeat: 2,
  get outDir() {
    return process.env.XAS_RECALL_TEST_OUT_DIR;
  },
};

export default config;
