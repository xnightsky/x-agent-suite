/** @module @x-agent-suite/assertions/first-of
 * 通用组合断言：实际贡献与原始 boolean 分离，异常始终向上传播。
 * 不变量：score 为原始 0/1；任何 ERROR 都不发布正常 contribution。
 */
import type { CriterionResult } from "@x-agent-suite/contracts";
import {
  assertionContribution,
  parseAssertionScore,
  type AssertionScoreConfig,
} from "./score.ts";
import { assertCriterionResult } from "./result.ts";
import { cloneJsonValue } from "./json-safe.ts";

/** 三种通用组合求值策略。 */
export type CompositionKind = "allOf" | "anyOf" | "firstOf";

/** 分支原始结果；省略分支 score 时可携带内部叶子的实际贡献之和。 */
export interface CompositionBranchResult extends CriterionResult {
  readonly contribution?: number;
}

/** 已准备的懒执行分支；miss 用于内部叶子计分时声明共同失败贡献。 */
export interface CompositionBranch {
  readonly name: string;
  readonly score?: AssertionScoreConfig;
  readonly miss?: number;
  readonly evaluate: () => Promise<CompositionBranchResult>;
}

/** 分支诊断；跳过分支不虚构裁定、标准分或贡献。 */
export interface CompositionBranchTrace {
  readonly index: number;
  readonly name: string;
  readonly status:
    "pending" | "running" | "passed" | "failed" | "error" | "skipped";
  readonly result?: CriterionResult;
  readonly contribution?: number;
  readonly scoreSource?: "branch" | "leaves";
  readonly skipReason?: "accepted-earlier" | "error";
}

/** 一次组合求值的不可变阶段快照。 */
export interface CompositionEvent {
  readonly phase:
    | "branch-started"
    | "branch-completed"
    | "branch-skipped"
    | "composition-completed"
    | "composition-error";
  readonly branchIndex?: number;
  readonly accepted: string | null;
  readonly branches: readonly CompositionBranchTrace[];
  readonly result?: CompositionResult;
}

/** 完成的组合结果，贡献与标准分分离。 */
export interface CompositionResult extends CriterionResult {
  readonly kind: CompositionKind;
  readonly accepted: string | null;
  readonly commonMiss?: number;
  readonly branches: readonly CompositionBranchTrace[];
  readonly contribution: number;
}

/** 兼容既有有序择档分支类型。 */
export type FirstOfBranch = CompositionBranch;
/** 兼容既有有序择档分支诊断类型。 */
export type FirstOfBranchTrace = CompositionBranchTrace;
/** 兼容既有有序择档事件类型。 */
export type FirstOfEvent = CompositionEvent;
/** 兼容既有有序择档结果类型。 */
export type FirstOfResult = CompositionResult;

function commonMiss(branch: CompositionBranch): number {
  return branch.miss ?? branch.score?.miss ?? -1;
}

function validateBranches(
  kind: CompositionKind,
  branches: readonly CompositionBranch[],
): void {
  const minimum = kind === "allOf" ? 1 : 2;
  if (branches.length < minimum)
    throw new Error(kind + " 至少需要 " + minimum + " 个分支");
  const names = new Set<string>();
  for (const branch of branches) {
    if (
      typeof branch.name !== "string" ||
      !branch.name.trim() ||
      branch.name.includes(".") ||
      names.has(branch.name)
    )
      throw new Error(kind + " 分支名无效或重复");
    if (typeof branch.evaluate !== "function")
      throw new Error(kind + " 分支缺少 evaluate");
    names.add(branch.name);
    if (branch.score !== undefined) parseAssertionScore(branch.score);
    if (branch.miss !== undefined && !Number.isFinite(branch.miss))
      throw new Error(kind + " 分支 miss 必须是有限数");
    if (kind !== "allOf" && commonMiss(branch) !== commonMiss(branches[0]!))
      throw new Error(kind + " 各分支 miss 必须一致");
  }
}

function branchContribution(
  branch: CompositionBranch,
  raw: CompositionBranchResult,
): { contribution: number; scoreSource: "branch" | "leaves" } {
  const hasContribution = Object.hasOwn(raw, "contribution");
  if (hasContribution && branch.score !== undefined)
    throw new Error("分支显式 score 与内部叶子贡献互斥：" + branch.name);
  if (hasContribution) {
    if (
      typeof raw.contribution !== "number" ||
      !Number.isFinite(raw.contribution)
    )
      throw new Error("分支 contribution 必须是有限数：" + branch.name);
    return { contribution: raw.contribution, scoreSource: "leaves" };
  }
  return {
    contribution: assertionContribution(raw.pass, branch.score),
    scoreSource: branch.score === undefined ? "leaves" : "branch",
  };
}

class CompositionEvaluation {
  readonly traces: CompositionBranchTrace[];
  private accepted: string | null = null;

  constructor(
    private readonly kind: CompositionKind,
    private readonly branches: readonly CompositionBranch[],
    private readonly onEvent?: (event: CompositionEvent) => void,
  ) {
    this.traces = branches.map((branch, index) => ({
      index,
      name: branch.name,
      status: "pending",
    }));
  }

  private emit(
    phase: CompositionEvent["phase"],
    branchIndex?: number,
    result?: CompositionResult,
  ): void {
    if (!this.onEvent) return;
    const event: CompositionEvent = {
      phase,
      ...(branchIndex === undefined ? {} : { branchIndex }),
      ...(result ? { result } : {}),
      accepted: this.accepted,
      branches: this.traces,
    };
    this.onEvent(cloneJsonValue(event) as unknown as CompositionEvent);
  }

  async tryBranch(index: number): Promise<number> {
    const branch = this.branches[index]!;
    this.traces[index] = { index, name: branch.name, status: "running" };
    this.emit("branch-started", index);
    const raw = await branch.evaluate();
    assertCriterionResult(raw, branch.name);
    const result = { pass: raw.pass, score: raw.score, reason: raw.reason };
    const actual = branchContribution(branch, raw);
    this.traces[index] = {
      index,
      name: branch.name,
      status: result.pass ? "passed" : "failed",
      result,
      ...actual,
    };
    this.emit("branch-completed", index);
    return actual.contribution;
  }

  private skip(start: number, reason: "accepted-earlier" | "error"): number[] {
    const skipped: number[] = [];
    for (let index = start; index < this.branches.length; index++) {
      this.traces[index] = {
        index,
        name: this.branches[index]!.name,
        status: "skipped",
        skipReason: reason,
      };
      skipped.push(index);
    }
    return skipped;
  }

  private acceptedIndex(index?: number): number | undefined {
    if (this.kind === "firstOf") return index;
    if (this.kind === "allOf") return undefined;
    let selected: number | undefined;
    for (const trace of this.traces) {
      if (!trace.result?.pass) continue;
      if (
        selected === undefined ||
        trace.contribution! > this.traces[selected]!.contribution!
      )
        selected = trace.index;
    }
    return selected;
  }

  finish(index?: number): CompositionResult {
    const acceptedIndex = this.acceptedIndex(index);
    const accepted = acceptedIndex === undefined ? null : acceptedIndex;
    const pass =
      this.kind === "allOf"
        ? this.traces.every((branch) => branch.result?.pass === true)
        : accepted !== null;
    this.accepted = accepted === null ? null : this.branches[accepted]!.name;
    if (this.kind === "firstOf" && accepted !== null)
      for (const skipped of this.skip(accepted + 1, "accepted-earlier"))
        this.emit("branch-skipped", skipped);
    const contribution =
      this.kind === "allOf"
        ? this.traces.reduce((sum, branch) => sum + branch.contribution!, 0)
        : accepted === null
          ? commonMiss(this.branches[0]!)
          : this.traces[accepted]!.contribution!;
    const result: CompositionResult = {
      kind: this.kind,
      pass,
      score: pass ? 1 : 0,
      reason: pass
        ? this.kind === "allOf"
          ? "全部分支通过"
          : "接受分支：" + this.accepted
        : this.kind === "allOf"
          ? "存在未通过分支"
          : this.kind === "anyOf"
            ? "所有候选内容未通过"
            : "所有档位实际贡献均未大于 0",
      accepted: this.accepted,
      ...(this.kind === "allOf"
        ? {}
        : { commonMiss: commonMiss(this.branches[0]!) }),
      branches: this.traces,
      contribution,
    };
    this.emit("composition-completed", undefined, result);
    return result;
  }

  fail(index: number, cause: unknown): never {
    this.accepted = null;
    this.traces[index] = { ...this.traces[index]!, status: "error" };
    const skipped = this.skip(index + 1, "error");
    const errors: unknown[] = [cause];
    for (const branchIndex of [...skipped, undefined]) {
      try {
        this.emit(
          branchIndex === undefined ? "composition-error" : "branch-skipped",
          branchIndex ?? index,
        );
      } catch (notifyError) {
        errors.push(notifyError);
      }
    }
    if (errors.length > 1)
      throw new AggregateError(errors, "组合执行及诊断通知失败");
    throw cause;
  }
}

async function evaluateComposition(
  kind: CompositionKind,
  branches: readonly CompositionBranch[],
  onEvent?: (event: CompositionEvent) => void,
): Promise<CompositionResult> {
  validateBranches(kind, branches);
  const evaluation = new CompositionEvaluation(kind, branches, onEvent);
  for (let index = 0; index < branches.length; index++) {
    try {
      const contribution = await evaluation.tryBranch(index);
      if (kind === "firstOf" && contribution > 0)
        return evaluation.finish(index);
    } catch (cause) {
      evaluation.fail(index, cause);
    }
  }
  try {
    return evaluation.finish();
  } catch (cause) {
    return evaluation.fail(branches.length - 1, cause);
  }
}

/** 逐项执行全部条件，组合 boolean 为 AND，实际贡献逐项求和。 */
export function evaluateAllOf(
  branches: readonly CompositionBranch[],
  onEvent?: (event: CompositionEvent) => void,
): Promise<CompositionResult> {
  return evaluateComposition("allOf", branches, onEvent);
}

/** 执行全部候选，通过项取最高实际贡献，全失败只取一次共同 miss。 */
export function evaluateAnyOf(
  branches: readonly CompositionBranch[],
  onEvent?: (event: CompositionEvent) => void,
): Promise<CompositionResult> {
  return evaluateComposition("anyOf", branches, onEvent);
}

/** 按声明顺序接受首个实际贡献大于零的分支；ERROR 不降级。 */
export function evaluateFirstOf(
  branches: readonly FirstOfBranch[],
  onEvent?: (event: FirstOfEvent) => void,
): Promise<FirstOfResult> {
  return evaluateComposition("firstOf", branches, onEvent);
}
