/**
 * 教程 registry：注册文本判据与 borrowed MockDriver；零真实网络、零 token。
 */
import { MockDriver } from "@x-agent-suite/driver";
import { textContains } from "@x-agent-suite/criteria";
import type { RecallRegistry } from "@x-agent-suite/recall";

const registry: RecallRegistry = {
  criteria: [textContains],
  profiles: {
    "tutorial-cli": {
      carrier: "tutorial-carrier",
      createDriver: () => new MockDriver(),
    },
  },
  effectsProfiles: {},
};

export default registry;
