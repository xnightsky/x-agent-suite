/** @module @x-agent-suite/recall/first-of-criterion
 * 局部组合评价点是普通 Criterion，档内复用 runCriteria，不引入执行引擎。
 * 不变量：复用同一主观测；Judge 仅在分支开始后创建隔离 client 与批次。
 */
import {
  assertionContribution,
  assertCriterionResult,
  evaluateAllOf,
  evaluateAnyOf,
  evaluateFirstOf,
  judgeAssertionResults,
  type CompositionBranch,
  type CompositionBranchResult,
  type CompositionEvent,
} from "@x-agent-suite/assertions";
import type {
  Criterion,
  CriterionOutcome,
  CriterionResult,
  SessionObservation,
  SessionCriterionContext,
  TurnObservation,
  TurnCriterionContext,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import type { JudgeOutcome } from "@x-agent-suite/judge";
import { runCriteria } from "@x-agent-suite/observation";
import {
  compileRecallCaseExpect,
  recallJudgeCriterionName,
} from "./assertion-dsl.ts";
import type { AssembleRecallCriteriaOptions } from "./criterion-assembly.ts";
import {
  compositionKindOfKey,
  type RecallCompositionBranch,
  type RecallCompositionKind,
} from "./first-of-dsl.ts";
import {
  compositeAssertion,
  compositionIdentity,
  compositionJournal,
  type RecallCompositePayload,
  type RecallComposition,
  type RecallCompositionJournal,
} from "./first-of-records.ts";
import {
  recallCompositionBranchMiss,
  recallCompositionMechanicalAssertionScore,
} from "./assertion-score.ts";
import {
  createRecallJudgeModelClient,
  type CreateRecallJudgeModelClientOptions,
  type RecallJudgeCleanup,
} from "./judge-driver.ts";
import { evaluateRecallJudgeBatch } from "./judge-criterion.ts";

interface BranchDetails {
  conditions: CriterionOutcome[];
  cleanup: RecallJudgeCleanup[];
  judge?: JudgeOutcome;
  onCleanup?: CreateRecallJudgeModelClientOptions["onCleanup"];
  onRedactor?: CreateRecallJudgeModelClientOptions["onRedactor"];
}

interface Position {
  key: string;
  kind: RecallCompositionKind;
  scope: "turn" | "session";
  turn?: TurnObservation;
  session: SessionObservation;
  branches: readonly RecallCompositionBranch[];
}

function captureCriteria(
  criteria: readonly Criterion[],
  details: BranchDetails,
): Criterion[] {
  return criteria.map((criterion) =>
    criterion.scope === "turn"
      ? {
          name: criterion.name,
          scope: "turn",
          async evaluate(turn: TurnObservation, context: TurnCriterionContext) {
            const result = await criterion.evaluate(turn, context);
            assertCriterionResult(result, criterion.name);
            details.conditions.push({
              ...result,
              name: criterion.name,
              scope: "turn",
              turnIndex: turn.index,
            });
            return result;
          },
        }
      : {
          name: criterion.name,
          scope: "session",
          async evaluate(
            session: SessionObservation,
            context: SessionCriterionContext,
          ) {
            const result = await criterion.evaluate(session, context);
            assertCriterionResult(result, criterion.name);
            details.conditions.push({
              ...result,
              name: criterion.name,
              scope: "session",
            });
            return result;
          },
        },
  );
}

function createBranchJudgeCriteria(
  branch: RecallCompositionBranch,
  position: Position,
  options: AssembleRecallCriteriaOptions,
  details: BranchDetails,
): Criterion[] {
  let pending: ReturnType<typeof judgeAssertionResults> | undefined;
  const results = async () => {
    if (pending) return pending;
    if (!branch.expect.judge) throw new Error("组合分支 Judge 声明缺失");
    const output = position.turn?.text ?? position.session.turns.at(-1)?.text;
    if (output === undefined) throw new Error("Recall 组合缺少评价输出");
    const client = createRecallJudgeModelClient({
      ...options,
      onCleanup: details.onCleanup,
      onRedactor: details.onRedactor,
    });
    details.judge = await evaluateRecallJudgeBatch(
      output,
      branch.expect.judge,
      client,
    );
    pending = judgeAssertionResults(details.judge, "Recall 组合 Judge");
    return pending;
  };
  return Object.keys(branch.expect.judge?.rubrics ?? {}).map(
    (name): Criterion => ({
      name: recallJudgeCriterionName(name),
      scope: position.scope,
      async evaluate() {
        const result = (await results()).find((item) => item.name === name);
        if (!result) throw new Error("[absent] 缺少组合裁定：" + name);
        return {
          pass: result.pass,
          score: result.score,
          reason: result.reason,
        };
      },
    }),
  );
}

function leafContribution(
  branch: RecallCompositionBranch,
  position: Position,
  branchIndex: number,
  spec: ScenarioSpec,
  options: AssembleRecallCriteriaOptions,
  outcome: CriterionOutcome,
): number {
  const rubric = Object.entries(branch.expect.judge?.rubrics ?? {}).find(
    ([name]) => recallJudgeCriterionName(name) === outcome.name,
  );
  return rubric
    ? assertionContribution(outcome.pass, rubric[1].score)
    : recallCompositionMechanicalAssertionScore(
        options.execution,
        spec,
        position.scope,
        position.turn?.index,
        position.key,
        branchIndex,
        outcome,
      );
}

async function evaluateBranch(
  branch: RecallCompositionBranch,
  position: Position,
  branchIndex: number,
  spec: ScenarioSpec,
  criteria: readonly Criterion[],
  options: AssembleRecallCriteriaOptions,
  details: BranchDetails,
): Promise<CompositionBranchResult> {
  const compiled = compileRecallCaseExpect(branch.expect);
  const judgeCriteria = createBranchJudgeCriteria(
    branch,
    position,
    options,
    details,
  );
  const children = await runCriteria({
    session: position.session,
    criteria: captureCriteria([...criteria, ...judgeCriteria], details),
    ...(position.scope === "turn"
      ? {
          turnExpects: position.session.turns.map((turn) =>
            turn.index === position.turn!.index ? compiled.expect : undefined,
          ),
        }
      : { sessionExpect: compiled.expect }),
  });
  const pass = children.every((item) => item.pass);
  const result: CriterionResult = {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? "档内全部条件通过"
      : children
          .filter((item) => !item.pass)
          .map((item) => item.name + ": " + item.reason)
          .join("；"),
  };
  if (branch.score !== undefined) return result;
  return {
    ...result,
    contribution: children.reduce(
      (sum, outcome) =>
        sum +
        leafContribution(branch, position, branchIndex, spec, options, outcome),
      0,
    ),
  };
}

function compositionSnapshot(
  identity: ReturnType<typeof compositionIdentity>,
  event: CompositionEvent,
  details: ReadonlyMap<number, BranchDetails>,
  commonMiss: number | undefined,
): RecallComposition {
  return {
    ...identity,
    accepted: event.accepted,
    ...(commonMiss === undefined ? {} : { commonMiss }),
    status:
      event.phase === "composition-error"
        ? "error"
        : event.phase === "composition-completed"
          ? event.result?.pass
            ? "passed"
            : "failed"
          : "running",
    branches: event.branches.map((branch) => {
      const captured = details.get(branch.index);
      return {
        ...branch,
        ...(captured
          ? {
              conditions: captured.conditions,
              cleanup: captured.cleanup,
              ...(captured.judge ? { judge: captured.judge } : {}),
            }
          : {}),
      };
    }),
  };
}

function lazyBranches(
  position: Position,
  spec: ScenarioSpec,
  criteria: readonly Criterion[],
  options: AssembleRecallCriteriaOptions,
  details: Map<number, BranchDetails>,
  journal: RecallCompositionJournal | undefined,
  assertionName: string,
): CompositionBranch[] {
  return position.branches.map((branch, index) => ({
    name: branch.name,
    ...(branch.score === undefined ? {} : { score: branch.score }),
    ...(branch.score === undefined && position.kind !== "allOf"
      ? {
          miss: recallCompositionBranchMiss(
            options.execution,
            spec,
            position.scope,
            position.turn?.index,
            position.key,
            branch,
            index,
          ),
        }
      : {}),
    evaluate: async () => {
      const captured: BranchDetails = {
        conditions: [],
        cleanup: [],
        onCleanup: (event) => {
          captured.cleanup.push(event);
          journal?.addCleanup({ ...event, assertionName, branchIndex: index });
        },
        onRedactor: (redact) => journal?.redactors.push(redact),
      };
      details.set(index, captured);
      return evaluateBranch(
        branch,
        position,
        index,
        spec,
        criteria,
        options,
        captured,
      );
    },
  }));
}

async function evaluateComposition(
  position: Position,
  criteria: readonly Criterion[],
  options: AssembleRecallCriteriaOptions,
): Promise<CriterionResult & RecallCompositePayload> {
  const spec = options.scenarios.find(
    (item) => item.id === position.session.driver,
  );
  if (!spec) throw new Error("Recall 组合场景归因缺失");
  const journal = compositionJournal(options.execution, spec);
  const identity = compositionIdentity(
    position.key,
    position.scope,
    position.turn?.index,
  );
  const details = new Map<number, BranchDetails>();
  let composition: RecallComposition | undefined;
  const branches = lazyBranches(
    position,
    spec,
    criteria,
    options,
    details,
    journal,
    identity.assertionName,
  );
  const evaluate = {
    allOf: evaluateAllOf,
    anyOf: evaluateAnyOf,
    firstOf: evaluateFirstOf,
  }[position.kind];
  const commonMiss =
    position.kind === "allOf"
      ? undefined
      : recallCompositionBranchMiss(
          options.execution,
          spec,
          position.scope,
          position.turn?.index,
          position.key,
          position.branches[0]!,
          0,
        );
  const result = await evaluate(branches, (event) => {
    composition = compositionSnapshot(identity, event, details, commonMiss);
    journal?.record(event, composition, event.result);
  });
  if (!composition) throw new Error("Recall 组合未产出完整结论");
  return {
    pass: result.pass,
    score: result.score,
    reason: result.reason,
    __recallComposition: {
      composition,
      assertion: compositeAssertion(identity.assertionName, result),
    },
  };
}

/** 装配 turn/session 组合；共享函数而不共享分支裁定或缓存。 */
export function createRecallCompositionCriteria(
  options: AssembleRecallCriteriaOptions,
  criteria: readonly Criterion[],
): Criterion[] {
  const keys = new Map<string, "turn" | "session">();
  for (const spec of options.scenarios) {
    for (const key of Object.keys(spec.expect ?? {}).filter(
      (name) => compositionKindOfKey(name) !== undefined,
    ))
      keys.set("session:" + key, "session");
    for (const turn of spec.turns)
      for (const key of Object.keys(turn.expect ?? {}).filter(
        (name) => compositionKindOfKey(name) !== undefined,
      ))
        keys.set("turn:" + key, "turn");
  }
  return [...keys].map(([fullKey, scope]): Criterion => {
    const key = fullKey.slice(scope.length + 1);
    const kind = compositionKindOfKey(key)!;
    return scope === "turn"
      ? {
          name: key,
          scope,
          evaluate: (turn, context) =>
            evaluateComposition(
              {
                key,
                kind,
                scope,
                turn,
                session: context.session,
                branches: context.expect as readonly RecallCompositionBranch[],
              },
              criteria,
              options,
            ),
        }
      : {
          name: key,
          scope,
          evaluate: (session, context) =>
            evaluateComposition(
              {
                key,
                kind,
                scope,
                session,
                branches: context.expect as readonly RecallCompositionBranch[],
              },
              criteria,
              options,
            ),
        };
  });
}

/** 兼容既有装配名；实现同时支持全部组合类型。 */
export const createRecallFirstOfCriteria = createRecallCompositionCriteria;
