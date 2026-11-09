/** @module integrations/recall-scoring/first-of/fake
 * 默认示例的零 token 注册表：真实 provision 与消费者 evidence，脚本化主输出/Judge。
 * 不变量：只接受显式 fixture target；不启动宿主、不创建 backend 连接、不读取真实凭据。
 */
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDriver, SandboxContext } from "@x-agent-suite/contracts";
import { createSandbox, cleanupSandbox } from "@x-agent-suite/sandbox";
import {
  materializeRecallProvision,
  type RecallProfileDriverContext,
  type RecallRegistry,
} from "@x-agent-suite/recall";
import consumer from "../../../pi.registry.ts";
function log(record: object): void {
  const path = process.env.XAS_FIRST_OF_FIXTURE_LOG;
  if (path) appendFileSync(path, JSON.stringify(record) + "\n");
}
function scriptedJudge(prompt: string): string {
  const output = prompt.split("<Output>").at(-1)!.split("</Output>")[0]!;
  const sample = output.match(/样本=([a-z-]+)/)?.[1];
  const eligible = [
    "standard",
    "downgrade",
    "hard-missing",
    "parallel",
  ].includes(sample ?? "");
  const table: Record<string, boolean> = {
    routing: sample === "standard",
    authority: eligible,
    minimum: eligible,
    honesty: true,
    explanation: true,
    brief: true,
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
async function scriptedObservation(prompt: string, cwd: string) {
  const text = prompt.split("<Sample>")[1]?.split("</Sample>")[0]?.trim();
  if (!text) throw new Error("示例缺少 Sample 正文");
  const toolCalls = text.includes("样本=hard-missing")
    ? []
    : [
        {
          name: "read",
          input: { path: "rules/entry.md" },
          status: "completed" as const,
          output: {
            content: [
              {
                type: "text",
                text: await readFile(join(cwd, "rules/entry.md"), "utf8"),
              },
            ],
          },
        },
      ];
  return {
    text,
    toolCalls,
    toolCallsCount: toolCalls.length,
    events: [],
    metadata: { workspaceCwd: cwd },
  };
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
      await materializeRecallProvision(sandbox, context.spec.provision);
    },
    async sendPrompt(prompt) {
      if (!sandbox) throw new Error("fake Driver 未启动");
      log({ phase: "send", judge, prompt });
      if (judge)
        return {
          text: scriptedJudge(prompt),
          toolCalls: [],
          toolCallsCount: 0,
          events: [],
        };
      return scriptedObservation(prompt, sandbox.cwd);
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
  criteria: consumer.criteria,
  profiles: {
    "fixture-cli-0": { carrier: "fixture-carrier", createDriver: createFake },
  },
  effectsProfiles: consumer.effectsProfiles,
  transport: async () => {
    throw new Error("fake 示例禁止网络 transport");
  },
};
export default registry;
