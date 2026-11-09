/** @module @x-agent-suite/recall/composition-reporter
 * 同源事件的分级文本视图；不求值、不重新选择档位。
 */
import type { RecallReporterOutput, RecallVerbosity } from "./reporter.ts";
import type { RecallCompositionEvent } from "./first-of-records.ts";
/** 渲染一个择档事件；0 级依旧只使用 case 结论。 */
export function writeCompositionEvent(
  context: { verbosity: RecallVerbosity; output: RecallReporterOutput },
  event: RecallCompositionEvent,
): void {
  if (context.verbosity < 1) return;
  const label = `COMPOSITION repeat=${event.repeatIndex + 1}/${event.repeatCount} ${event.composition.assertionName}`;
  if (event.phase === "composition-completed") {
    context.output.stdout(
      `${label} ${event.composition.status} accepted=${event.composition.accepted ?? "null"} contribution=${event.assertion!.score}`,
    );
    return;
  }
  const branch =
    event.branchIndex === undefined
      ? undefined
      : event.composition.branches[event.branchIndex];
  if (event.phase === "composition-error") {
    context.output.stderr(`${label} ERROR branch=${branch?.name ?? "unknown"}`);
    return;
  }
  if (context.verbosity < 2) return;
  context.output.stdout(
    `${label} ${event.phase} branch=${branch?.name ?? "unknown"} status=${branch?.status} ${branch?.skipReason ?? ""}`,
  );
  if (event.phase === "branch-completed" && branch) {
    for (const condition of branch.conditions ?? [])
      context.output.stdout(
        `  ${condition.name} pass=${condition.pass} rawScore=${condition.score} reason=${JSON.stringify(condition.reason)}`,
      );
    if (branch.status === "failed")
      context.output.stdout("  内容未通过，按序尝试后档（如有）");
  }
  if (context.verbosity >= 3)
    context.output.stdout(JSON.stringify(event, null, 2));
}
