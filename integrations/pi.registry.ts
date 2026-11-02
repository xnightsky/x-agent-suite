/**
 * @module integrations/pi.registry
 * 场景仓的显式消费者注册表；复用 Recall 的宿主工厂与判据。
 * 不变量：不选择渠道、不持有凭据，不自动加载消费者真实目录。
 */
import { textContains, textNotContains } from "@x-agent-suite/criteria";
import type { SessionCriterion, TurnCriterion } from "@x-agent-suite/contracts";
import type {
  RecallAssertionScoreResolver,
  RecallRegistry,
} from "@x-agent-suite/recall";
import { posix } from "node:path";
import { createPiRecallDriver } from "../profiles/pi-recall.ts";
import { artifactJson, scriptExecution } from "./script.criteria.ts";

/** 按唯一 Skill 名称核对原生读取事件，兼容源目录与安装目录。 */
const skillLoaded: TurnCriterion = {
  name: "skill-loaded",
  scope: "turn",
  evaluate(turn, { expect }) {
    const wanted = expect as { name?: unknown; loaded?: unknown } | null;
    if (
      !wanted ||
      typeof wanted.name !== "string" ||
      !wanted.name.trim() ||
      /[/\\]/.test(wanted.name) ||
      wanted.name === "." ||
      wanted.name === ".." ||
      typeof wanted.loaded !== "boolean"
    )
      throw new Error("skill-loaded 需要 Skill name（非路径）与 loaded");
    const reads = turn.toolCalls.filter((call) => {
      const input = call.input as { path?: unknown } | null;
      if (call.name !== "read" || typeof input?.path !== "string") return false;
      const path = input.path.replaceAll("\\", "/");
      return (
        posix.basename(path) === "SKILL.md" &&
        posix.basename(posix.dirname(path)) === wanted.name
      );
    });
    const pass = wanted.loaded
      ? reads.some((call) => call.status === "completed")
      : reads.length === 0;
    return {
      pass,
      score: pass ? 1 : 0,
      reason: wanted.loaded
        ? `核对同名 Skill ${wanted.name} 的成功读取事件`
        : `核对同名 Skill ${wanted.name} 未被读取`,
    };
  },
};

/** 核对最终回答前缀的 session 机械判据；score 由自身输入协议显式 opt-in。 */
const answerContract: SessionCriterion & {
  readonly assertionScore: RecallAssertionScoreResolver;
} = {
  name: "answer-contract",
  scope: "session",
  assertionScore: (expect) =>
    (expect as { score?: { hit?: number; miss?: number } }).score ?? {},
  evaluate(session, { expect }) {
    const wanted = expect as { requiredPrefix?: unknown } | null;
    if (
      !wanted ||
      typeof wanted.requiredPrefix !== "string" ||
      !wanted.requiredPrefix.trim()
    ) {
      throw new Error("answer-contract 需要非空 requiredPrefix");
    }
    const text = session.turns.at(-1)?.text ?? "";
    const pass = text.startsWith(wanted.requiredPrefix);
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass
        ? "最终回答前缀符合约定"
        : `最终回答前缀不符合约定：期望 ${wanted.requiredPrefix}`,
    };
  },
};

/** 显式注册场景仓使用的宿主和判据，渠道仍由命令选择。 */
const registry: RecallRegistry = {
  criteria: [
    answerContract,
    textContains,
    textNotContains,
    skillLoaded,
    scriptExecution,
    artifactJson,
  ],
  profiles: {
    pi: {
      carrier: "pi",
      createDriver: (context) =>
        createPiRecallDriver(context, {
          contextFiles: "project",
          skills: context.effects.tools === "none" ? "off" : "project",
          ...(context.effects.commands.allow.length > 0
            ? { evidence: { report: "out/change-report.json" } }
            : {}),
        }),
    },
  },
  effectsProfiles: {
    "skill-readonly": { tools: "allowlist", maxSteps: 4, timeoutMs: 60000 },
    "skill-script": {
      tools: "allowlist",
      commands: {
        allow: [
          "node .pi/skills/change-report/scripts/build-report.mjs --input fixtures/changes.json --output out/change-report.json",
        ],
      },
      maxSteps: 6,
      timeoutMs: 60000,
    },
  },
};

export default registry;
