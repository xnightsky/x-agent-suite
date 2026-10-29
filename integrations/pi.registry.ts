/**
 * @module integrations/pi.registry
 * 场景仓的显式消费者注册表；复用 Recall 的宿主工厂与判据。
 * 不变量：不选择渠道、不持有凭据，不自动加载消费者真实目录。
 */
import { textContains, textNotContains } from "@x-agent-suite/criteria";
import type { TurnCriterion } from "@x-agent-suite/contracts";
import type { RecallRegistry } from "@x-agent-suite/recall";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createPiRecallDriver } from "../profiles/pi-recall.ts";

/** 依据原生工具事件判断安装位置是否被读取，不采信模型自述。 */
const skillLoaded: TurnCriterion = {
  name: "skill-loaded",
  scope: "turn",
  evaluate(turn, { expect }) {
    const wanted = expect as { path?: unknown; loaded?: unknown } | null;
    const root = turn.metadata.workspaceCwd;
    if (
      !wanted ||
      typeof wanted.path !== "string" ||
      !wanted.path ||
      typeof wanted.loaded !== "boolean" ||
      typeof root !== "string"
    )
      throw new Error("skill-loaded 需要 path、loaded 与工作区证据");
    const target = resolve(root, wanted.path);
    const nested = relative(root, target);
    if (
      isAbsolute(wanted.path) ||
      nested === ".." ||
      nested.startsWith(".." + sep)
    ) {
      throw new Error("skill-loaded path 必须在隔离工作区内");
    }
    const reads = turn.toolCalls.filter((call) => {
      const input = call.input as { path?: unknown } | null;
      return (
        call.name === "read" &&
        typeof input?.path === "string" &&
        resolve(root, input.path) === target
      );
    });
    const pass = wanted.loaded
      ? reads.some((call) => call.status === "completed")
      : reads.length === 0;
    return {
      pass,
      score: pass ? 1 : 0,
      reason: wanted.loaded
        ? "核对安装位置的成功读取事件"
        : "核对安装位置未被读取",
    };
  },
};

/** 显式注册场景仓使用的宿主和判据，渠道仍由命令选择。 */
const registry: RecallRegistry = {
  criteria: [textContains, textNotContains, skillLoaded],
  profiles: {
    pi: {
      carrier: "pi",
      createDriver: (context) =>
        createPiRecallDriver(context, {
          contextFiles: "project",
          skills: context.effects.tools === "none" ? "off" : "project",
        }),
    },
  },
  effectsProfiles: {
    "skill-readonly": { tools: "allowlist", maxSteps: 4, timeoutMs: 60000 },
  },
};

export default registry;
