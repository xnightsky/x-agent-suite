/**
 * CLI 端到端 fixture：mock config 声明 3 场景（过 / 不过 / 无判据）。
 * 注意：本文件是测试资产，不是框架 API。
 */
import { MockDriver } from "@x-agent-suite/driver";
import { textContains } from "@x-agent-suite/criteria";
import type { RunConfig } from "../../src/cli.ts";

const config: RunConfig = {
  scenarios: [
    {
      id: "demo/pass",
      turns: [{ send: "你好，世界", expect: { "text-contains": ["你好"] } }],
      aggregate: {
        dimensions: [{ metric: "text-contains" }, { metric: "style" }],
      },
    },
    {
      id: "demo/fail",
      turns: [{ send: "你好", expect: { "text-contains": ["不存在"] } }],
    },
    {
      id: "demo/no-expect",
      turns: [{ send: "自由回答" }],
    },
  ],
  createDriver: () => new MockDriver(),
  criteria: [textContains],
  repeat: 2,
  outDir: process.env.XAS_TEST_OUT_DIR ?? ".tmp/runner-cli-test",
};

export default config;
