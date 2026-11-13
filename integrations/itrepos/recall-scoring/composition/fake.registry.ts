/** @module integrations/recall-scoring/composition/fake
 * 组合考卷的零 token 注册表：脚本化主输出与 Judge，禁止网络和真实凭据。
 * 不变量：只接受显式 fixture target；每次主/Judge attempt 都创建并清理独立 sandbox。
 */
import { appendFileSync } from "node:fs";
import type { AgentDriver, SandboxContext } from "@x-agent-suite/contracts";
import { createSandbox, cleanupSandbox } from "@x-agent-suite/sandbox";
import { textContains } from "@x-agent-suite/assertions";
import type {
  RecallProfileDriverContext,
  RecallRegistry,
} from "@x-agent-suite/recall";

function log(record: object): void {
  const path = process.env.XAS_COMPOSITION_FIXTURE_LOG;
  if (path) appendFileSync(path, JSON.stringify(record) + "\n");
}

function scriptedJudge(prompt: string): string {
  const output = prompt.split("<Output>").at(-1)!.split("</Output>")[0]!;
  const combined =
    output.includes("DETAIL_OK") && output.includes("STANDARD_OK");
  const table: Record<string, boolean> = {
    correctness: true,
    completeness: combined,
    concise: combined,
    detailed: combined,
    zero_standard: combined,
    zero_downgrade: true,
    leaf_present: combined,
    leaf_missing: false,
    leaf_fallback: true,
  };
  const criteria = prompt.split("<Criteria>").at(-1)!.split("</Criteria>")[0]!;
  return JSON.stringify(
    Object.fromEntries(
      [...criteria.matchAll(/^\d+\. (.+?):/gm)].map((match) => {
        const name = match[1]!;
        if (!Object.hasOwn(table, name))
          throw new Error("未注册的 fake rubric：" + name);
        return [
          name,
          { pass: table[name], reason: "脚本化零 token 裁定：" + name },
        ];
      }),
    ),
  );
}

function createFake(context: RecallProfileDriverContext): AgentDriver {
  if (context.target.carrier !== "fixture-carrier")
    throw new Error("fake 示例只接受 fixture-carrier");
  let sandbox: SandboxContext | undefined;
  const judge = context.spec.id === "recall/judge";
  log({ phase: "factory", judge });
  return {
    async start() {
      sandbox = await createSandbox();
    },
    async sendPrompt(prompt) {
      if (!sandbox) throw new Error("fake Driver 未启动");
      log({ phase: "send", judge, prompt });
      const text = judge
        ? scriptedJudge(prompt)
        : prompt.split("<Sample>")[1]?.split("</Sample>")[0]?.trim();
      if (!text) throw new Error("示例缺少 Sample 正文");
      return { text, toolCalls: [], toolCallsCount: 0, events: [] };
    },
    async *events() {},
    async close() {
      if (sandbox) {
        const current = sandbox;
        sandbox = undefined;
        await cleanupSandbox(current);
        log({ phase: "closed", judge, cwd: current.cwd });
      }
    },
  };
}

const registry: RecallRegistry = {
  criteria: [textContains],
  profiles: {
    "fixture-cli-0": { carrier: "fixture-carrier", createDriver: createFake },
  },
  effectsProfiles: {},
  transport: async () => {
    throw new Error("fake 示例禁止网络 transport");
  },
};
export default registry;
