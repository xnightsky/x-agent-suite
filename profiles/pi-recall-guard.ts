/**
 * @module profiles/pi-recall-guard
 * 消费者侧只读工具与工作区路径守卫；仅拆分既有实现，不改变执行策略。
 * 不变量：不构成 OS 级沙箱，不开放命令执行。
 */
import type { RecallEffects } from "@x-agent-suite/recall";

/** 默认原生只读工具集。 */
export const PI_RECALL_READ_TOOLS = ["read", "grep", "find", "ls"] as const;

/** 守卫扩展源码：只兑现当前策略——工具白名单、工作区路径容器校验与轮次预算中断。 */
export function createPiRecallGuardSource(
  workspace: string,
  effects: RecallEffects,
): string {
  const maxSteps = effects.maxSteps;
  return [
    "import { realpathSync } from 'node:fs';",
    "import { isAbsolute, relative, resolve, sep } from 'node:path';",
    "",
    "export default function (pi) {",
    "  const workspace = " + JSON.stringify(workspace) + ";",
    "  const allowedTools = " + JSON.stringify([...PI_RECALL_READ_TOOLS]) + ";",
    "  pi.on('tool_call', (event) => {",
    "    if (!allowedTools.includes(event.toolName)) {",
    "      return { block: true, reason: 'Pi Recall Driver：工具不在只读白名单内' };",
    "    }",
    "    try {",
    "      const target = realpathSync(resolve(workspace, event.input?.path ?? '.'));",
    "      const nested = relative(workspace, target);",
    "      if (nested === '..' || nested.startsWith('..' + sep) || isAbsolute(nested)) {",
    "        return { block: true, reason: 'Pi Recall Driver：路径越出隔离工作区' };",
    "      }",
    "    } catch (error) {",
    "      return { block: true, reason: 'Pi Recall Driver：路径不可用 ' + (error?.code ?? 'unknown') };",
    "    }",
    "    return undefined;",
    "  });",
    "  pi.on('turn_end', async (event, ctx) => {",
    "    if (event.turnIndex >= " +
      String(maxSteps - 1) +
      ") await ctx.abort();",
    "  });",
    "}",
    "",
  ].join("\n");
}
