/**
 * @module integrations/pi.registry
 * 场景仓的显式消费者注册表；复用 Recall 的宿主工厂与判据。
 * 不变量：不选择渠道、不持有凭据，不自动加载消费者真实目录。
 */
import { textContains, textNotContains } from "@x-agent-suite/criteria";
import type { RecallRegistry } from "@x-agent-suite/recall";
import { createPiRecallDriver } from "../profiles/pi-recall.ts";

/** 显式注册场景仓使用的宿主和判据，渠道仍由命令选择。 */
const registry: RecallRegistry = {
  criteria: [textContains, textNotContains],
  profiles: {
    pi: {
      carrier: "pi",
      createDriver: (context) =>
        createPiRecallDriver(context, { contextFiles: "project" }),
    },
  },
  effectsProfiles: {},
};

export default registry;
