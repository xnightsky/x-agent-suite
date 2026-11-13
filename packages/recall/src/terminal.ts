/**
 * @module @x-agent-suite/recall/terminal
 * TTY 展示层：运行状态、图标、颜色与汇总框；不参与执行和计分。
 * 不变量：仅在显式 TTY 输出上启用；非 TTY 不创建本模块实例。
 */
import type { RecallCaseProgress, RecallRunEvent } from "./run.ts";
import type { RecallReporterOutput } from "./reporter.ts";

interface ActiveCase {
  readonly progress: RecallCaseProgress;
  readonly startedAt: number;
  readonly timer: ReturnType<typeof setInterval>;
}

/** TTY 事件处理结果与装饰后的行出口。 */
export interface RecallTerminal {
  readonly output: RecallReporterOutput;
  /** 返回 true 表示该事件已由 TTY 展示层完整处理。 */
  handle(event: RecallRunEvent): boolean;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** 按输出配置着色；NO_COLOR 的判定由默认出口负责。 */
function paint(
  output: RecallReporterOutput,
  text: string,
  code: string,
): string {
  return output.color ? `\u001B[${code}m${text}\u001B[0m` : text;
}

/** 将现有结构化行映射为图标行，不改变其中的结果和分数文本。 */
function formatLine(output: RecallReporterOutput, line: string): string {
  if (line.startsWith("RECALL ")) return paint(output, "◆ " + line, "1;36");
  if (line.startsWith("RUN ")) return paint(output, "▶ " + line, "36");
  if (line.startsWith("PASS ")) return paint(output, "✓ " + line, "32");
  if (line.startsWith("FAIL ")) return paint(output, "✗ " + line, "31");
  if (line.startsWith("ERROR ")) return paint(output, "✗ " + line, "31");
  if (line.startsWith("REPEAT ")) return paint(output, "  ↳ " + line, "2");
  if (line.startsWith("TURN ")) return paint(output, "    · " + line, "2");
  if (line.startsWith("ASSERT PASS "))
    return paint(output, "    ✓ " + line, "32");
  if (line.startsWith("ASSERT FAIL "))
    return paint(output, "    ✗ " + line, "31");
  if (line.startsWith("REASON ")) return paint(output, "  ↳ " + line, "33");
  if (line.startsWith("REPORT ")) return paint(output, "  ↳ " + line, "2");
  if (line.startsWith("STACK ")) return paint(output, "  ↳ " + line, "31");
  if (
    line.startsWith("PROMPT ") ||
    line.startsWith("OBSERVATION ") ||
    line.startsWith("RESULT ")
  ) {
    return paint(output, "    ▸ " + line, "36");
  }
  return line;
}

/** 汇总耗时使用毫秒或两位小数的秒数。 */
function durationText(durationMs: number): string {
  return durationMs < 1000
    ? `${durationMs}ms`
    : `${(durationMs / 1000).toFixed(2)}s`;
}

/** 为 TTY 创建展示层；调用方只在 output.isTTY=true 时调用。 */
export function createRecallTerminal(
  output: RecallReporterOutput,
): RecallTerminal {
  let active: ActiveCase | undefined;
  let frame = 0;

  const clearActiveLine = (): void => {
    if (active) output.writeStdout?.("\r\u001B[2K");
  };

  const decorated: RecallReporterOutput = {
    ...output,
    stdout: (message) => {
      clearActiveLine();
      output.stdout(formatLine(output, message));
    },
    stderr: (message) => {
      clearActiveLine();
      output.stderr(formatLine(output, message));
    },
  };

  const clearActive = (): void => {
    if (!active) return;
    clearInterval(active.timer);
    output.writeStdout?.("\r\u001B[2K");
    active = undefined;
  };

  const renderActive = (): void => {
    if (!active || !output.writeStdout) return;
    const elapsed = ((Date.now() - active.startedAt) / 1000).toFixed(1);
    const symbol = SPINNER[frame++ % SPINNER.length];
    const text =
      `${symbol} ${active.progress.index}/${active.progress.total} ` +
      `${active.progress.scenarioId} ${elapsed}s`;
    output.writeStdout("\r\u001B[2K" + paint(output, text, "36"));
  };

  const startCase = (progress: RecallCaseProgress): boolean => {
    if (!output.writeStdout) return false;
    clearActive();
    const timer = setInterval(renderActive, 100);
    timer.unref();
    active = { progress, startedAt: Date.now(), timer };
    renderActive();
    return true;
  };

  const writeSummary = (
    event: Extract<RecallRunEvent, { type: "run-completed" }>,
  ): void => {
    const passed = event.result.runs.filter((run) => run.hardPass).length;
    const failed = event.result.runs.length - passed;
    const errors = event.result.failures.length;
    const total = event.result.runs.length + errors;
    const status = `✓ ${passed} passed  ✗ ${failed} failed  ⚠ ${errors} errors`;
    const meta = `${total} cases · ${durationText(event.durationMs)}`;
    const summary = event.result.summary;
    const scoring = `coverage=${summary.coverage} passRate=${summary.passRate} rawScore=${summary.rawScore} pass@k=${summary.passAtK} pass^k=${summary.passAllK}`;
    const innerWidth = Math.max(status.length, meta.length, scoring.length) + 2;
    const border = "─".repeat(innerWidth + 2);
    output.stdout(paint(output, `╭${border}╮`, "2"));
    output.stdout(
      paint(
        output,
        `│ ${status.padEnd(innerWidth)} │`,
        failed + errors > 0 ? "31" : "32",
      ),
    );
    output.stdout(paint(output, `│ ${meta.padEnd(innerWidth)} │`, "2"));
    output.stdout(paint(output, `│ ${scoring.padEnd(innerWidth)} │`, "2"));
    output.stdout(paint(output, `╰${border}╯`, "2"));
  };

  return {
    output: decorated,
    handle(event) {
      if (event.type === "case-started") return startCase(event.case);
      if (event.type === "case-completed" || event.type === "case-failed") {
        clearActive();
        return false;
      }
      if (event.type === "run-completed") {
        clearActive();
        writeSummary(event);
        return true;
      }
      return false;
    },
  };
}
