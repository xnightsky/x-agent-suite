/**
 * @module @x-agent-suite/recall/judge-criterion
 * Recall turn/case 文本与 rubric 装配；通用裁定解包由 @x-agent-suite/assertions 执行。
 * 不变量：每个评价点独立批量调用与缓存，不跨轮、不跨 turn/case 复用裁定。
 */
import {
  judgeAssertionResults,
  type NamedAssertionResult,
} from "@x-agent-suite/assertions";
import type {
  Criterion,
  CriterionResult,
  ScenarioSpec,
  SessionCriterion,
  SessionObservation,
  TurnCriterion,
  TurnObservation,
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

interface RecallTurnAssertionMetadata {
  readonly judge?: RecallJudgeDefinition;
}

interface RecallAssertionMetadata {
  readonly judge?: RecallJudgeDefinition;
  readonly turnAssertions?: readonly RecallTurnAssertionMetadata[];
}

type BatchResults = Promise<readonly NamedAssertionResult[]>;

function assertionMetadata(
  metadata: Record<string, unknown> | undefined,
): RecallAssertionMetadata | undefined {
  return metadata?.recall as RecallAssertionMetadata | undefined;
}

function judgeMetadata(spec: ScenarioSpec): RecallJudgeDefinition | undefined {
  return assertionMetadata(spec.metadata)?.judge;
}

function sessionJudge(session: SessionObservation): RecallJudgeDefinition {
  const judge = assertionMetadata(session.metadata)?.judge;
  if (!judge) throw new Error("Recall case Judge 元数据缺失");
  return judge;
}

function turnJudge(
  session: SessionObservation,
  turnIndex: number,
): RecallJudgeDefinition {
  const judge = assertionMetadata(session.metadata)?.turnAssertions?.[turnIndex]
    ?.judge;
  if (!judge) throw new Error("Recall turn Judge 元数据缺失");
  return judge;
}

async function evaluateBatch(
  output: string,
  definition: RecallJudgeDefinition,
  client: JudgeModelClient,
): Promise<JudgeOutcome> {
  return judge(
    {
      output,
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

function resultOf(
  results: readonly NamedAssertionResult[],
  name: string,
): CriterionResult {
  const result = results.find((item) => item.name === name);
  if (!result) throw new Error("[absent] 缺少裁定：" + name);
  return { pass: result.pass, score: result.score, reason: result.reason };
}

function createSessionCriterion(
  name: string,
  client: JudgeModelClient,
  cache: WeakMap<SessionObservation, BatchResults>,
): SessionCriterion {
  return {
    name: recallJudgeCriterionName(name),
    scope: "session",
    async evaluate(session): Promise<CriterionResult> {
      const last = session.turns[session.turns.length - 1];
      if (!last) throw new Error("Recall case Judge 缺少最终输出");
      let pending = cache.get(session);
      if (!pending) {
        pending = evaluateBatch(last.text, sessionJudge(session), client).then(
          (outcome) => judgeAssertionResults(outcome, "Recall case Judge"),
        );
        cache.set(session, pending);
      }
      return resultOf(await pending, name);
    },
  };
}

function createTurnCriterion(
  name: string,
  client: JudgeModelClient,
  cache: WeakMap<TurnObservation, BatchResults>,
): TurnCriterion {
  return {
    name: recallJudgeCriterionName(name),
    scope: "turn",
    async evaluate(turn, context): Promise<CriterionResult> {
      let pending = cache.get(turn);
      if (!pending) {
        pending = evaluateBatch(
          turn.text,
          turnJudge(context.session, turn.index),
          client,
        ).then((outcome) =>
          judgeAssertionResults(outcome, "Recall turn Judge"),
        );
        cache.set(turn, pending);
      }
      return resultOf(await pending, name);
    },
  };
}

/** 装配当前 target 实际声明的 turn/case 内部 rubric 判据；无 Judge 时返回空数组。 */
export function createRecallJudgeCriteria(
  options: CreateRecallJudgeCriteriaOptions,
): readonly Criterion[] {
  const sessionNames = new Set<string>();
  const turnNames = new Set<string>();
  for (const scenario of options.scenarios) {
    for (const name of Object.keys(judgeMetadata(scenario)?.rubrics ?? {})) {
      sessionNames.add(name);
    }
    const turnAssertions =
      assertionMetadata(scenario.metadata)?.turnAssertions ?? [];
    for (const turn of turnAssertions) {
      for (const name of Object.keys(turn.judge?.rubrics ?? {})) {
        turnNames.add(name);
      }
    }
  }
  if (sessionNames.size === 0 && turnNames.size === 0) return [];
  const client = createRecallJudgeModelClient(options);
  const sessionCache = new WeakMap<SessionObservation, BatchResults>();
  const turnCache = new WeakMap<TurnObservation, BatchResults>();
  return [
    ...[...sessionNames].map((name) =>
      createSessionCriterion(name, client, sessionCache),
    ),
    ...[...turnNames].map((name) =>
      createTurnCriterion(name, client, turnCache),
    ),
  ];
}
