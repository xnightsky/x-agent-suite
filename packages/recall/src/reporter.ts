/**
 * @module @x-agent-suite/recall/reporter
 * Recall 行式流式 reporter：verbosity 只控制展示，不反向影响执行。
 * 不变量：高级别包含低级别；所有内容输入均已在事件出口脱敏。
 */
import { writeCompositionEvent } from "./composition-reporter.ts";
import { inspect } from "node:util";
import type { ScenarioResult } from "@x-agent-suite/contracts";
import type {
  ScenarioRepeatEvent,
  RunnerArtifact,
  ScenarioRunEvent,
  ScenarioTurnCompletedEvent,
  ScenarioTurnStartedEvent,
} from "@x-agent-suite/runner";
import type {
  RecallCaseProgress,
  RecallRunEvent,
  RecallRunListener,
} from "./run.ts";
import type { RecallAssertionArtifact } from "./assertion-results.ts";
import { createRecallTerminal } from "./terminal.ts";

/** Recall 支持的详细级别；数值越高，严格包含越多诊断事件。 */
export type RecallVerbosity = 0 | 1 | 2 | 3;

/** CLI 文本出口；测试与程序调用方可注入，不绑定全局 console。 */
export interface RecallReporterOutput {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
  /** 是否为交互终端；仅 true 时启用美化与运行状态。 */
  readonly isTTY?: boolean;
  /** 是否启用 ANSI 颜色；默认遵循 TTY、TERM 与 NO_COLOR。 */
  readonly color?: boolean;
  /** TTY 状态行的原始写入出口，用于清行和即时重绘。 */
  readonly writeStdout?: (chunk: string) => void;
}

interface ReporterContext {
  readonly verbosity: RecallVerbosity;
  readonly output: RecallReporterOutput;
}

type RepeatPosition = Pick<ScenarioRepeatEvent, "repeatIndex" | "repeatCount">;
type CaseCompletedEvent = Extract<RecallRunEvent, { type: "case-completed" }>;
type CaseFailedEvent = Extract<RecallRunEvent, { type: "case-failed" }>;
type RunCompletedEvent = Extract<RecallRunEvent, { type: "run-completed" }>;
type RecallBoundaryEvent = Exclude<RecallRunEvent, { type: "runner" }>;
type RunnerRecallEvent = Extract<RecallRunEvent, { type: "runner" }>;

/** 当前 target × case 的人类可读身份。 */
function caseLabel(progress: RecallCaseProgress): string {
  const reference = progress.cliRef ?? progress.clientRef;
  const implementation = reference
    ? progress.mode + "/" + reference
    : progress.mode;
  return (
    progress.scenarioId + " [" + progress.carrier + "/" + implementation + "]"
  );
}

/** repeat 归因只在 repeat 事件上追加，不改变既有 case 行前缀。 */
function repeatLabel(index: number, count: number): string {
  return "repeat=" + (index + 1) + "/" + count;
}

/** 完整渲染诊断值；不可 JSON 序列化的领域值以 util.inspect 显式保留。 */
function renderValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return inspect(value, {
      colors: false,
      compact: false,
      depth: null,
      maxArrayLength: null,
      maxStringLength: null,
    });
  }
}

/** 输出带统一缩进的完整诊断块。 */
function writeBlock(
  context: ReporterContext,
  channel: "stdout" | "stderr",
  prefix: string,
  value: unknown,
): void {
  const rendered = renderValue(value).replaceAll("\n", "\n  ");
  context.output[channel](prefix + "\n  " + rendered);
}

/** 从 Recall 报告投影生成 case/repeat 分数后缀；无断言时不虚构总分。 */
function scoreSuffix(result: ScenarioResult<RunnerArtifact>): string {
  const artifact = result.artifact as RecallAssertionArtifact;
  if (artifact.rawScore === undefined || !artifact.assertions) return "";
  const passed = artifact.assertions.filter((item) => item.pass).length;
  return (
    " rawScore=" +
    artifact.rawScore +
    " assertions=" +
    passed +
    "/" +
    artifact.assertions.length
  );
}

/** 渲染 case 的行为结果、失败原因和报告路径。 */
function writeCaseCompleted(
  context: ReporterContext,
  event: CaseCompletedEvent,
): void {
  const label = caseLabel(event.case);
  context.output.stdout(
    (event.run.hardPass ? "PASS " : "FAIL ") +
      label +
      " durationMs=" +
      event.durationMs +
      scoreSuffix(event.result),
  );
  if (!event.run.hardPass && event.result.error) {
    context.output.stdout(
      "REASON " + label + " " + renderValue(event.result.error),
    );
  }
  if (context.verbosity >= 1) {
    context.output.stdout(
      "REPORT md=" +
        event.run.reports.mdPath +
        " json=" +
        event.run.reports.jsonPath,
    );
  }
}

/** 渲染基础设施错误及级别 3 的完整堆栈。 */
function writeCaseFailed(
  context: ReporterContext,
  event: CaseFailedEvent,
): void {
  const label = caseLabel(event.case);
  context.output.stderr(
    "ERROR " +
      label +
      "：" +
      event.failure.error.message +
      " durationMs=" +
      event.durationMs,
  );
  if (context.verbosity >= 1 && event.failure.reports)
    context.output.stderr(
      "DIAGNOSTIC md=" +
        event.failure.reports.mdPath +
        " json=" +
        event.failure.reports.jsonPath,
    );
  if (context.verbosity >= 3) {
    writeBlock(
      context,
      "stderr",
      "STACK " + label,
      event.failure.error.stack ?? event.failure.error.message,
    );
  }
}

/** 渲染全量计数汇总；行为失败与基础设施错误分别计数。 */
function writeRunCompleted(
  context: ReporterContext,
  event: RunCompletedEvent,
): void {
  const passed = event.result.runs.filter((run) => run.hardPass).length;
  const failed = event.result.runs.length - passed;
  const errors = event.result.failures.length;
  const summary = event.result.summary;
  context.output.stdout(
    "SUMMARY total=" +
      (event.result.runs.length + errors) +
      " passed=" +
      passed +
      " failed=" +
      failed +
      " errors=" +
      errors +
      " durationMs=" +
      event.durationMs +
      " coverage=" +
      summary.coverage +
      " invalidRate=" +
      summary.invalidRate +
      " passRate=" +
      summary.passRate +
      " rawScore=" +
      summary.rawScore +
      " pass@k=" +
      summary.passAtK +
      " pass^k=" +
      summary.passAllK,
  );
}

/** 渲染 run/case 边界事件。 */
function writeBoundaryEvent(
  context: ReporterContext,
  event: RecallBoundaryEvent,
): void {
  switch (event.type) {
    case "run-started":
      context.output.stdout(
        "RECALL cases=" +
          event.caseTotal +
          " targets=" +
          event.targetCount +
          " repeat=" +
          event.repeat,
      );
      return;
    case "case-started":
      if (context.verbosity >= 1) {
        context.output.stdout(
          "RUN " +
            event.case.index +
            "/" +
            event.case.total +
            " " +
            caseLabel(event.case) +
            " target=" +
            event.case.provider +
            "/" +
            event.case.model,
        );
      }
      return;
    case "case-completed":
      writeCaseCompleted(context, event);
      return;
    case "case-failed":
      writeCaseFailed(context, event);
      return;
    case "run-completed":
      writeRunCompleted(context, event);
  }
}

/** 渲染 repeat 单次结果及级别 3 的完整 ScenarioResult。 */
function writeRepeatCompleted(
  context: ReporterContext,
  progress: RecallCaseProgress,
  event: Extract<ScenarioRepeatEvent, { type: "repeat-completed" }>,
): void {
  const label = caseLabel(progress);
  if (context.verbosity >= 1) {
    context.output.stdout(
      "REPEAT " +
        (event.repeatIndex + 1) +
        "/" +
        event.repeatCount +
        " " +
        (event.result.hardPass ? "PASS " : "FAIL ") +
        label +
        " durationMs=" +
        event.result.latencyMs +
        scoreSuffix(event.result),
    );
  }
  if (context.verbosity >= 3) {
    writeBlock(
      context,
      "stdout",
      "RESULT " +
        label +
        " " +
        repeatLabel(event.repeatIndex, event.repeatCount),
      event.result,
    );
  }
}

/** 渲染 turn 开始及级别 3 的原始 prompt。 */
function writeTurnStarted(
  context: ReporterContext,
  progress: RecallCaseProgress,
  repeated: RepeatPosition,
  event: ScenarioTurnStartedEvent,
): void {
  const label = caseLabel(progress);
  if (context.verbosity >= 2) {
    context.output.stdout(
      "TURN " +
        (event.turnIndex + 1) +
        "/" +
        event.turnCount +
        " START " +
        label +
        " " +
        repeatLabel(repeated.repeatIndex, repeated.repeatCount),
    );
  }
  if (context.verbosity >= 3) {
    context.output.stdout(
      "PROMPT " +
        label +
        " " +
        renderValue(event.prompt) +
        " " +
        repeatLabel(repeated.repeatIndex, repeated.repeatCount),
    );
  }
}

/** 渲染 turn 结果及级别 3 的完整 Observation。 */
function writeTurnCompleted(
  context: ReporterContext,
  progress: RecallCaseProgress,
  repeated: RepeatPosition,
  event: ScenarioTurnCompletedEvent,
): void {
  const label = caseLabel(progress);
  if (context.verbosity >= 2) {
    context.output.stdout(
      "TURN " +
        (event.turnIndex + 1) +
        "/" +
        event.turnCount +
        " DONE " +
        label +
        " durationMs=" +
        event.durationMs +
        " steps=" +
        (event.observation.steps ?? "-") +
        " toolCalls=" +
        event.observation.toolCallsCount,
    );
  }
  if (context.verbosity >= 3) {
    writeBlock(
      context,
      "stdout",
      "OBSERVATION " +
        label +
        " turn=" +
        (event.turnIndex + 1) +
        "/" +
        event.turnCount +
        " " +
        repeatLabel(repeated.repeatIndex, repeated.repeatCount),
      event.observation,
    );
  }
}

/** 渲染一批具名判据结果及 Recall 实际贡献。 */
function writeCriteriaCompleted(
  context: ReporterContext,
  event: Extract<ScenarioRunEvent, { type: "criteria-completed" }>,
  contributions: readonly number[] | undefined,
): void {
  if (context.verbosity < 2) return;
  for (const [index, outcome] of event.outcomes.entries()) {
    const turn =
      outcome.scope === "turn" ? " turn=" + (outcome.turnIndex + 1) : "";
    const contribution = contributions?.[index];
    const contributionText =
      contribution === undefined ? "" : " contribution=" + contribution;
    context.output.stdout(
      "ASSERT " +
        (outcome.pass ? "PASS " : "FAIL ") +
        outcome.name +
        " scope=" +
        outcome.scope +
        turn +
        " score=" +
        outcome.score +
        contributionText +
        " reason=" +
        renderValue(outcome.reason),
    );
  }
}

/** 分派嵌套 Scenario 事件。 */
function writeScenarioEvent(
  context: ReporterContext,
  progress: RecallCaseProgress,
  repeated: RepeatPosition,
  event: ScenarioRunEvent,
  contributions: readonly number[] | undefined,
): void {
  if (event.type === "turn-started") {
    writeTurnStarted(context, progress, repeated, event);
  } else if (event.type === "turn-completed") {
    writeTurnCompleted(context, progress, repeated, event);
  } else {
    writeCriteriaCompleted(context, event, contributions);
  }
}

/** 分派 repeat 与嵌套 Scenario 事件。 */
function writeRunnerEvent(
  context: ReporterContext,
  recallEvent: RunnerRecallEvent,
): void {
  const progress = recallEvent.case;
  const event = recallEvent.event;
  if (event.type === "repeat-started") {
    if (context.verbosity >= 1) {
      context.output.stdout(
        "REPEAT " +
          (event.repeatIndex + 1) +
          "/" +
          event.repeatCount +
          " START " +
          caseLabel(progress),
      );
    }
    return;
  }
  if (event.type === "repeat-completed") {
    writeRepeatCompleted(context, progress, event);
    return;
  }
  writeScenarioEvent(
    context,
    progress,
    event,
    event.event,
    recallEvent.contributions,
  );
}

/** 创建 Recall CLI 事件监听器；默认动态调用 console，便于嵌入与测试。 */
export function createRecallReporter(
  verbosity: RecallVerbosity,
  output: RecallReporterOutput = {
    stdout: (message) => console.log(message),
    stderr: (message) => console.error(message),
    isTTY: process.stdout.isTTY === true,
    color:
      process.stdout.isTTY === true &&
      process.env.NO_COLOR === undefined &&
      process.env.TERM !== "dumb",
    writeStdout: (chunk) => process.stdout.write(chunk),
  },
): RecallRunListener {
  const terminal = output.isTTY ? createRecallTerminal(output) : undefined;
  const context = { verbosity, output: terminal?.output ?? output };
  return (event) => {
    if (terminal?.handle(event)) return;
    if (event.type === "composition") {
      writeCompositionEvent(context, event.event);
      return;
    }
    if (event.type === "runner") {
      writeRunnerEvent(context, event);
    } else {
      writeBoundaryEvent(context, event);
    }
  };
}
