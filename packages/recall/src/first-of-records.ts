import type { Redactor, ReportPaths } from "@x-agent-suite/contracts";
import type { RecallJudgeCleanup } from "./judge-driver.ts";
/** @module @x-agent-suite/recall/first-of-records
 * Recall 本地择档账本；先记录后通知，不修改被测 Observation。
 * 不变量：账本按 execution/spec 隔离；阶段事件是深拷贝快照，不受后续清理影响。
 */
import {
  cloneJsonValue,
  type FirstOfEvent,
  type FirstOfBranchTrace,
  type FirstOfResult,
} from "@x-agent-suite/assertions";
import type { CriterionOutcome, ScenarioSpec } from "@x-agent-suite/contracts";
import type { JudgeOutcome } from "@x-agent-suite/judge";
import type { RecallResolvedExecution } from "./execution.ts";
import {
  FIRST_OF_PREFIX,
  isFirstOfKey,
  type RecallFirstOfBranch,
} from "./first-of-dsl.ts";
/** 档内原始诊断，没有独立有效贡献。 */
export interface RecallFirstOfBranchTrace extends FirstOfBranchTrace {
  readonly conditions?: readonly CriterionOutcome[];
  readonly judge?: JudgeOutcome;
}
/** 一个评价点的完整诊断；通过 assertionName 引用唯一有效明细。 */
export interface RecallComposition {
  readonly assertionName: string;
  readonly scope: "turn" | "session";
  readonly turnIndex?: number;
  readonly status:
    "pending" | "running" | "passed" | "failed" | "error" | "skipped";
  readonly accepted: string | null;
  readonly branches: readonly RecallFirstOfBranchTrace[];
}
/** Recall 本地阶段事件，不扩 Runner 公共事件。 */
export interface RecallCompositionEvent {
  readonly sequence: number;
  readonly repeatIndex: number;
  readonly repeatCount: number;
  readonly phase: FirstOfEvent["phase"];
  readonly branchIndex?: number;
  readonly composition: RecallComposition;
  readonly assertion?: RecallCompositeAssertion;
}
/** 组合唯一有效贡献；source 不污染通用 AssertionDetail 联合。 */
export interface RecallCompositeAssertion {
  readonly name: string;
  readonly source: "composite";
  readonly pass: boolean;
  readonly reason: string;
  readonly score: number;
}
/** 结果私有载荷，投影时剥离，Runner 不解释。 */
export interface RecallCompositePayload {
  readonly __recallComposition: {
    readonly composition: RecallComposition;
    readonly assertion: RecallCompositeAssertion;
  };
}
/** 完整 repeat 快照，不递归包含 repeats。 */
export interface RecallRepeatSnapshot {
  readonly index: number;
  readonly hardPass: boolean;
  readonly outcomes: readonly CriterionOutcome[];
  readonly assertions: readonly {
    readonly name: string;
    readonly source: string;
    readonly pass: boolean;
    readonly score: number;
    readonly reason: string;
  }[];
  readonly rawScore: number;
  readonly compositions: readonly RecallComposition[];
}
/** 从同一次原语结果创建明细，不重做档位选择。 */
export function compositeAssertion(
  name: string,
  result: FirstOfResult,
): RecallCompositeAssertion {
  return {
    name,
    source: "composite",
    pass: result.pass,
    reason: result.reason,
    score: result.contribution,
  };
}
/** 作者视图名称与 scope 位置。 */
export function compositionIdentity(
  key: string,
  scope: "turn" | "session",
  turnIndex?: number,
): Pick<RecallComposition, "assertionName" | "scope" | "turnIndex"> {
  const name = "firstOf." + key.slice(FIRST_OF_PREFIX.length);
  return scope === "turn"
    ? {
        assertionName: `turn.${turnIndex}.${name}`,
        scope,
        turnIndex: turnIndex!,
      }
    : { assertionName: name, scope };
}
function initialCompositions(spec: ScenarioSpec): RecallComposition[] {
  return [
    { scope: "session" as const, block: spec.expect },
    ...spec.turns.map((turn, turnIndex) => ({
      scope: "turn" as const,
      block: turn.expect,
      turnIndex,
    })),
  ].flatMap((location) =>
    Object.entries(location.block ?? {})
      .filter(([key]) => isFirstOfKey(key))
      .map(([key, value]) => ({
        ...compositionIdentity(
          key,
          location.scope,
          "turnIndex" in location ? location.turnIndex : undefined,
        ),
        status: "pending" as const,
        accepted: null,
        branches: (value as readonly RecallFirstOfBranch[]).map(
          (branch, index) => ({
            index,
            name: branch.name,
            status: "pending" as const,
          }),
        ),
      })),
  );
}
/** 每个 case 的无 listener 依赖账本。 */
export class RecallCompositionJournal {
  repeatIndex = 0;
  readonly repeatCount: number;
  readonly repeats: RecallRepeatSnapshot[] = [];
  readonly cleanup: (RecallJudgeCleanup & {
    readonly assertionName: string;
    readonly branchIndex: number;
  })[] = [];
  readonly redactors: Redactor[] = [];
  private diagnosticWriter?: () => Promise<ReportPaths>;
  private pendingWrite?: Promise<ReportPaths>;
  private sequence = 0;
  private compositions: RecallComposition[];
  constructor(
    private readonly spec: ScenarioSpec,
    count = 1,
    private readonly notify?: (event: RecallCompositionEvent) => void,
  ) {
    this.repeatCount = count;
    this.compositions = initialCompositions(spec);
  }
  /** 开始 repeat 时重置当前树，不抹除已完成历史。 */
  start(index: number): void {
    this.repeatIndex = index;
    this.compositions = initialCompositions(this.spec);
  }
  /** 记录当前阶段并发布不可变副本。 */
  record(
    event: FirstOfEvent,
    composition: RecallComposition,
    result?: FirstOfResult,
  ): void {
    const snapshot = cloneJsonValue(
      composition,
    ) as unknown as RecallComposition;
    const index = this.compositions.findIndex(
      (item) => item.assertionName === composition.assertionName,
    );
    if (index < 0) throw new Error("Recall 组合账本缺少声明");
    this.compositions[index] = snapshot;
    const payload: RecallCompositionEvent = {
      sequence: ++this.sequence,
      repeatIndex: this.repeatIndex,
      repeatCount: this.repeatCount,
      phase: event.phase,
      ...(event.branchIndex === undefined
        ? {}
        : { branchIndex: event.branchIndex }),
      composition: snapshot,
      ...(result
        ? { assertion: compositeAssertion(composition.assertionName, result) }
        : {}),
    };
    this.notify?.(cloneJsonValue(payload) as unknown as RecallCompositionEvent);
  }
  /** 清理完成后更新同一份诊断；迟到更新失败显式输出固定安全错误。 */
  addCleanup(
    event: RecallJudgeCleanup & {
      readonly assertionName: string;
      readonly branchIndex: number;
    },
  ): void {
    this.cleanup.push(event);
    if (this.diagnosticWriter)
      void this.queueWrite().catch(() =>
        console.error("Recall 迟到清理诊断写盘失败"),
      );
  }
  /** 绑定安全写盘器并串行提交首份诊断。 */
  persistDiagnostic(writer: () => Promise<ReportPaths>): Promise<ReportPaths> {
    this.diagnosticWriter = writer;
    return this.queueWrite();
  }
  private queueWrite(): Promise<ReportPaths> {
    const writer = this.diagnosticWriter!;
    this.pendingWrite = (this.pendingWrite ?? Promise.resolve()).then(writer);
    return this.pendingWrite;
  }
  /** 读取深拷贝诊断，调用方不可回写内部状态。 */
  snapshot(): readonly RecallComposition[] {
    return cloneJsonValue(this.compositions) as unknown as RecallComposition[];
  }
  /** 错误发生后标明未开始部分；已完成组合仅保留局部结论。 */
  fail(): void {
    this.compositions = this.compositions.map((item) =>
      item.status !== "pending"
        ? item
        : {
            ...item,
            status: "skipped",
            branches: item.branches.map((branch) => ({
              ...branch,
              status: "skipped",
              skipReason: "error",
            })),
          },
    );
  }
}
const JOURNALS = new WeakMap<
  RecallResolvedExecution,
  WeakMap<ScenarioSpec, RecallCompositionJournal>
>();
/** 绑定单个 case 的记录出口；由 Recall 执行层在 repeat 开始前调用。 */
export function bindCompositionJournal(
  execution: RecallResolvedExecution,
  spec: ScenarioSpec,
  journal: RecallCompositionJournal,
): void {
  let cases = JOURNALS.get(execution);
  if (!cases) {
    cases = new WeakMap();
    JOURNALS.set(execution, cases);
  }
  cases.set(spec, journal);
}
/** 查找当前 case 的账本；独立装配使用者可不绑定进度。 */
export function compositionJournal(
  execution: RecallResolvedExecution,
  spec: ScenarioSpec,
): RecallCompositionJournal | undefined {
  return JOURNALS.get(execution)?.get(spec);
}
