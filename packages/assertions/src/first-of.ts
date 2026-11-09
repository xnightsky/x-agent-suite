/** @module @x-agent-suite/assertions/first-of
 * 通用有序择档：仅合法内容失败进入下一档，不启动任务或选择客户端。
 * 不变量：score 为原始 0/1，contribution 只生成一次；异常始终向上传播。
 */
import type { CriterionResult } from "@x-agent-suite/contracts";
import {
  assertionContribution,
  parseAssertionScore,
  type AssertionScoreConfig,
} from "./score.ts";
import { assertCriterionResult } from "./result.ts";
import { cloneJsonValue } from "./json-safe.ts";
/** 已准备的懒执行档位；调用方负责同档全部子结果的完整性。 */
export interface FirstOfBranch {
  readonly name: string;
  readonly score?: AssertionScoreConfig;
  readonly evaluate: () => Promise<CriterionResult>;
}
/** 档位诊断；跳过分支不虚构裁定与分值。 */
export interface FirstOfBranchTrace {
  readonly index: number;
  readonly name: string;
  readonly status:
    "pending" | "running" | "passed" | "failed" | "error" | "skipped";
  readonly result?: CriterionResult;
  readonly skipReason?: "accepted-earlier" | "error";
}
/** 一次择档的不可变阶段快照。 */
export interface FirstOfEvent {
  readonly phase:
    | "branch-started"
    | "branch-completed"
    | "branch-skipped"
    | "composition-completed"
    | "composition-error";
  readonly branchIndex?: number;
  readonly accepted: string | null;
  readonly branches: readonly FirstOfBranchTrace[];
  readonly result?: FirstOfResult;
}
/** 完成的组合结果，贡献与标准分分离。 */
export interface FirstOfResult extends CriterionResult {
  readonly accepted: string | null;
  readonly branches: readonly FirstOfBranchTrace[];
  readonly contribution: number;
}
function validateBranches(branches: readonly FirstOfBranch[]): void {
  if (branches.length < 2) throw new Error("firstOf 至少需要两个档位");
  const names = new Set<string>();
  const miss = branches[0]!.score?.miss ?? -1;
  for (const branch of branches) {
    if (
      typeof branch.name !== "string" ||
      !branch.name.trim() ||
      names.has(branch.name)
    )
      throw new Error("firstOf 档名无效或重复");
    if (typeof branch.evaluate !== "function")
      throw new Error("firstOf 档位缺少 evaluate");
    names.add(branch.name);
    parseAssertionScore(branch.score === undefined ? {} : branch.score);
    if ((branch.score?.miss ?? -1) !== miss)
      throw new Error("firstOf 各档 miss 必须一致");
  }
}
class FirstOfEvaluation {
  readonly traces: FirstOfBranchTrace[];
  private accepted: string | null = null;
  constructor(
    private readonly branches: readonly FirstOfBranch[],
    private readonly onEvent?: (event: FirstOfEvent) => void,
  ) {
    this.traces = branches.map((branch, index) => ({
      index,
      name: branch.name,
      status: "pending",
    }));
  }
  private emit(
    phase: FirstOfEvent["phase"],
    branchIndex?: number,
    result?: FirstOfResult,
  ): void {
    if (!this.onEvent) return;
    const event: FirstOfEvent = {
      phase,
      ...(branchIndex === undefined ? {} : { branchIndex }),
      ...(result ? { result } : {}),
      accepted: this.accepted,
      branches: this.traces,
    };
    this.onEvent(cloneJsonValue(event) as unknown as FirstOfEvent);
  }
  async tryBranch(index: number): Promise<boolean> {
    const branch = this.branches[index]!;
    this.traces[index] = { index, name: branch.name, status: "running" };
    this.emit("branch-started", index);
    const raw = await branch.evaluate();
    assertCriterionResult(raw, branch.name);
    const result = { pass: raw.pass, score: raw.score, reason: raw.reason };
    this.traces[index] = {
      index,
      name: branch.name,
      status: result.pass ? "passed" : "failed",
      result,
    };
    this.emit("branch-completed", index);
    return result.pass;
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
  finish(index?: number): FirstOfResult {
    const pass = index !== undefined;
    this.accepted = pass ? this.branches[index]!.name : null;
    if (pass)
      for (const skipped of this.skip(index + 1, "accepted-earlier"))
        this.emit("branch-skipped", skipped);
    const result: FirstOfResult = {
      pass,
      score: pass ? 1 : 0,
      reason: pass ? "接受档位：" + this.accepted : "所有档位内容未通过",
      accepted: this.accepted,
      branches: this.traces,
      contribution: assertionContribution(
        pass,
        this.branches[index ?? 0]!.score,
      ),
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
      throw new AggregateError(errors, "择档执行及诊断通知失败");
    throw cause;
  }
}
/** 按顺序接受首个通过档；错误不产生贡献、不执行后档。 */
export async function evaluateFirstOf(
  branches: readonly FirstOfBranch[],
  onEvent?: (event: FirstOfEvent) => void,
): Promise<FirstOfResult> {
  validateBranches(branches);
  const evaluation = new FirstOfEvaluation(branches, onEvent);
  for (let index = 0; index < branches.length; index++) {
    try {
      if (await evaluation.tryBranch(index)) return evaluation.finish(index);
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
