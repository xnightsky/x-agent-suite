/**
 * 教程 fixture：Recall 运行配置，纯 MockDriver、零 token。
 * 消费者替换 createDriver/criteria；模型与凭证不进入 Recall。
 */
import { MockDriver } from "@x-agent-suite/driver";
import { textContains } from "@x-agent-suite/criteria";
import type { RecallConfig } from "@x-agent-suite/recall";
import { resolveTutorialOutDir } from "../support.ts";

const config: RecallConfig = {
  createDriver: () => new MockDriver(),
  criteria: [textContains],
  get outDir() {
    return resolveTutorialOutDir(".tmp/tutorial/recall");
  },
  carrier: "tutorial",
};

export default config;
