/** @module @x-agent-suite/recall/first-of-criterion
 * 局部有序评价点是一个普通 Criterion，档内复用 runCriteria，不引入执行引擎。
 * 不变量：复用同一主观测；Judge 仅在档位开始后创建隔离 client 与批次。
 */
import {
  assertCriterionResult,
  evaluateFirstOf,
  judgeAssertionResults,
  type FirstOfBranch,
  type FirstOfEvent,
} from "@x-agent-suite/assertions";
import type {
  Criterion,
  CriterionOutcome,
  CriterionResult,
  SessionObservation,
  SessionCriterionContext,
  TurnObservation,
  TurnCriterionContext,
} from "@x-agent-suite/contracts";
import type { JudgeOutcome } from "@x-agent-suite/judge";
import { runCriteria } from "@x-agent-suite/observation";
import {
  compileRecallCaseExpect,
  recallJudgeCriterionName,
} from "./assertion-dsl.ts";
import type { AssembleRecallCriteriaOptions } from "./criterion-assembly.ts";
import { isFirstOfKey, type RecallFirstOfBranch } from "./first-of-dsl.ts";
import {
  compositeAssertion,
  compositionIdentity,
  compositionJournal,
  type RecallCompositePayload,
  type RecallComposition,
  type RecallCompositionJournal,
} from "./first-of-records.ts";
import {
  createRecallJudgeModelClient,
  type CreateRecallJudgeModelClientOptions,
} from "./judge-driver.ts";
import { evaluateRecallJudgeBatch } from "./judge-criterion.ts";
interface BranchDetails {
  conditions: CriterionOutcome[];
  judge?: JudgeOutcome;
  onCleanup?: CreateRecallJudgeModelClientOptions["onCleanup"];
  onRedactor?: CreateRecallJudgeModelClientOptions["onRedactor"];
}
interface Position {
  key: string;
  scope: "turn" | "session";
  turn?: TurnObservation;
  session: SessionObservation;
  branches: readonly RecallFirstOfBranch[];
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
  branch: RecallFirstOfBranch,
  position: Position,
  options: AssembleRecallCriteriaOptions,
  details: BranchDetails,
): Criterion[] {
  let pending: ReturnType<typeof judgeAssertionResults> | undefined;
  const results = async () => {
    if (pending) return pending;
    if (!branch.expect.judge) throw new Error("档内 Judge 声明缺失");
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
    pending = judgeAssertionResults(details.judge, "Recall firstOf Judge");
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
async function evaluateBranch(
  branch: RecallFirstOfBranch,
  position: Position,
  criteria: readonly Criterion[],
  options: AssembleRecallCriteriaOptions,
  details: BranchDetails,
): Promise<CriterionResult> {
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
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? "档内全部条件通过"
      : children
          .filter((item) => !item.pass)
          .map((item) => item.name + ": " + item.reason)
          .join("；"),
  };
}
function compositionSnapshot(
  identity: ReturnType<typeof compositionIdentity>,
  event: FirstOfEvent,
  details: ReadonlyMap<number, BranchDetails>,
): RecallComposition {
  return {
    ...identity,
    accepted: event.accepted,
    status:
      event.phase === "composition-error"
        ? "error"
        : event.phase === "composition-completed"
          ? event.accepted === null
            ? "failed"
            : "passed"
          : "running",
    branches: event.branches.map((branch) => {
      const captured = details.get(branch.index);
      return {
        ...branch,
        ...(captured
          ? {
              conditions: captured.conditions,
              ...(captured.judge ? { judge: captured.judge } : {}),
            }
          : {}),
      };
    }),
  };
}
function lazyBranches(
  position: Position,
  criteria: readonly Criterion[],
  options: AssembleRecallCriteriaOptions,
  details: Map<number, BranchDetails>,
  journal: RecallCompositionJournal | undefined,
  assertionName: string,
): FirstOfBranch[] {
  return position.branches.map((branch, index) => ({
    name: branch.name,
    ...(branch.score ? { score: branch.score } : {}),
    evaluate: async () => {
      const captured: BranchDetails = {
        conditions: [],
        onCleanup: (event) =>
          journal?.addCleanup({ ...event, assertionName, branchIndex: index }),
        onRedactor: (redact) => journal?.redactors.push(redact),
      };
      details.set(index, captured);
      return evaluateBranch(branch, position, criteria, options, captured);
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
    criteria,
    options,
    details,
    journal,
    identity.assertionName,
  );
  const result = await evaluateFirstOf(branches, (event) => {
    composition = compositionSnapshot(identity, event, details);
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
/** 装配 scope 局部组合；共享函数而不共享分支裁定或缓存。 */
export function createRecallFirstOfCriteria(
  options: AssembleRecallCriteriaOptions,
  criteria: readonly Criterion[],
): Criterion[] {
  const keys = new Map<string, "turn" | "session">();
  for (const spec of options.scenarios) {
    for (const key of Object.keys(spec.expect ?? {}).filter(isFirstOfKey))
      keys.set("session:" + key, "session");
    for (const turn of spec.turns)
      for (const key of Object.keys(turn.expect ?? {}).filter(isFirstOfKey))
        keys.set("turn:" + key, "turn");
  }
  return [...keys].map(([fullKey, scope]): Criterion => {
    const key = fullKey.slice(scope.length + 1);
    return scope === "turn"
      ? {
          name: key,
          scope,
          evaluate: (turn, context) =>
            evaluateComposition(
              {
                key,
                scope,
                turn,
                session: context.session,
                branches: context.expect as readonly RecallFirstOfBranch[],
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
                scope,
                session,
                branches: context.expect as readonly RecallFirstOfBranch[],
              },
              criteria,
              options,
            ),
        };
  });
}
