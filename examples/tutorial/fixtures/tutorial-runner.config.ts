/**
 * 教程 fixture：scenario-runner recipe 的 run config。
 * 声明 3 个场景（过 / 不过 / 无判据），演示「一条命令出全部出口分」。
 */
import { MockDriver } from "@x-agent-suite/driver";
import { textContains, textNotContains } from "@x-agent-suite/criteria";
import type { RunConfig } from "@x-agent-suite/runner";

const config: RunConfig = {
  scenarios: [
    {
      id: "tutorial/runner-pass",
      turns: [
        {
          send: "你好，世界；答案是不加载",
          expect: {
            "text-contains": ["你好"],
            "text-not-contains": ["已加载"],
          },
        },
      ],
      aggregate: {
        dimensions: [
          { metric: "text-contains", weight: 2 },
          { metric: "text-not-contains", weight: 1 },
          { metric: "style", weight: 2 },
        ],
        threshold: 0.5,
      },
    },
    {
      id: "tutorial/runner-fail",
      turns: [{ send: "你好", expect: { "text-contains": ["不存在"] } }],
    },
    {
      id: "tutorial/runner-no-expect",
      turns: [{ send: "自由回答" }],
    },
  ],
  createDriver: () => new MockDriver(),
  criteria: [textContains, textNotContains],
  repeat: 2,
  outDir: process.env.XAS_TUTORIAL_OUT_DIR ?? ".tmp/tutorial/scenario-runner",
};

export default config;
