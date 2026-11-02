/**
 * @module @x-agent-suite/recall/judge-criterion
 * Recall 只负责最后文本与 rubric 装配；通用裁定解包由 @x-agent-suite/assertions 执行。
 */
import {
  judgeAssertionResults,
  type NamedAssertionResult,
} from "@x-agent-suite/assertions";
import type {
  CriterionResult,
  ScenarioSpec,
  SessionCriterion,
  SessionObservation,
} from "@x-agent-suite/contracts";
import {
  judge,
  type JudgeModelClient,
  type JudgeOutcome,
} from "@x-agent-suite/judge";
import type { LiveConfigOptions } from "@x-agent-suite/llm-fixture";
import {
  recallJudgeCriterionName,
  type RecallJudgeDefinition,
} from "./assertion-dsl.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import type { RecallRegistry } from "./registry.ts";
import { createRecallJudgeModelClient } from "./judge-driver.ts";

/** 内置 Judge 判据装配选项。 */
export interface CreateRecallJudgeCriteriaOptions {
  readonly scenarios: readonly ScenarioSpec[];
  readonly execution: RecallResolvedExecution;
  readonly registry: RecallRegistry;
  readonly config: LiveConfigOptions;
}

type BatchResults = Promise<readonly NamedAssertionResult[]>;

function judgeMetadata(spec: ScenarioSpec): RecallJudgeDefinition | undefined {
  const recall = spec.metadata?.recall as
    { judge?: RecallJudgeDefinition } | undefined;
  return recall?.judge;
}

function sessionJudge(session: SessionObservation): RecallJudgeDefinition {
  const recall = session.metadata.recall as
    { judge?: RecallJudgeDefinition } | undefined;
  if (!recall?.judge) throw new Error("Recall Judge 元数据缺失");
  return recall.judge;
}

async function evaluateBatch(
  session: SessionObservation,
  definition: RecallJudgeDefinition,
  client: JudgeModelClient,
): Promise<JudgeOutcome> {
  const last = session.turns[session.turns.length - 1];
  if (!last) throw new Error("Recall Judge 缺少最终输出");
  return judge(
    {
      output: last.text,
      rubrics: Object.entries(definition.rubrics).map(([name, item]) => ({
        name,
        rubric: item.rubric,
      })),
    },
    {
      client,
      ...(definition.timeoutMs !== undefined
        ? { timeoutMs: definition.timeoutMs }
        : {}),
      ...(definition.maxRetries !== undefined
        ? { maxRetries: definition.maxRetries }
        : {}),
      ...(definition.instructions !== undefined
        ? { prompt: { instructions: definition.instructions } }
        : {}),
    },
  );
}

function createCriterion(
  name: string,
  client: JudgeModelClient,
  cache: WeakMap<SessionObservation, BatchResults>,
): SessionCriterion {
  return {
    name: recallJudgeCriterionName(name),
    scope: "session",
    async evaluate(session): Promise<CriterionResult> {
      const definition = sessionJudge(session);
      let pending = cache.get(session);
      if (!pending) {
        pending = evaluateBatch(session, definition, client).then((outcome) =>
          judgeAssertionResults(outcome, "Recall case Judge"),
        );
        cache.set(session, pending);
      }
      const results = await pending;
      const result = results.find((item) => item.name === name);
      if (!result) throw new Error("[absent] 缺少裁定：" + name);
      return { pass: result.pass, score: result.score, reason: result.reason };
    },
  };
}

/** 装配当前 target 实际声明的全部内部 rubric 判据；无 Judge 时返回空数组。 */
export function createRecallJudgeCriteria(
  options: CreateRecallJudgeCriteriaOptions,
): readonly SessionCriterion[] {
  const names = new Set<string>();
  for (const scenario of options.scenarios) {
    for (const name of Object.keys(judgeMetadata(scenario)?.rubrics ?? {})) {
      names.add(name);
    }
  }
  if (names.size === 0) return [];
  const client = createRecallJudgeModelClient(options);
  const cache = new WeakMap<SessionObservation, BatchResults>();
  return [...names].map((name) => createCriterion(name, client, cache));
}
