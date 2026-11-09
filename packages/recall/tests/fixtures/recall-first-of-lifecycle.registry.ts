/** 可控 lifecycle 夹具：无真实宿主、无网络，gate 验证取消后迟到清理。 */
import type { AgentDriver } from "@x-agent-suite/contracts";
import type { RecallRegistry } from "../../src/registry.ts";
import base from "./recall-first-of.registry.ts";
let release!: () => void;
let gate = Promise.resolve();
let mode = "";
let mainCount = 0;
/** 当前 case 的原始生命周期顺序。 */
export const lifecycle: string[] = [];
/** 重置脚本与 gate，每个测试独立。 */
export function resetLifecycle(value: string): void {
  mode = value;
  mainCount = 0;
  lifecycle.length = 0;
  gate = new Promise((resolve) => {
    release = resolve;
  });
}
/** 放开挂起的 factory/start/send。 */
export function releaseLifecycle(): void {
  release();
}
const registry: RecallRegistry = {
  ...base,
  profiles: {
    ...base.profiles,
    "fixture-direct": {
      carrier: "fixture-carrier",
      async createDriver(context): Promise<AgentDriver> {
        const judge = context.spec.id === "recall/judge";
        if (!judge) mainCount++;
        const label = judge ? "judge" : "main";
        lifecycle.push(label + ":factory");
        if (judge && mode === "factory-late") await gate;
        const driver =
          await base.profiles!["fixture-direct"]!.createDriver(context);
        return {
          ...(driver.redactor ? { redactor: driver.redactor } : {}),
          async start() {
            lifecycle.push(label + ":start");
            if (judge && mode === "start-hang") await gate;
            await driver.start();
          },
          async sendPrompt(prompt) {
            lifecycle.push(label + ":send");
            if (judge && mode === "send-hang") await gate;
            const result = await driver.sendPrompt(prompt);
            return judge && mode === "repeat-error" && mainCount === 2
              ? { ...result, text: "not-json" }
              : result;
          },
          events: () => driver.events(),
          async close(reason) {
            lifecycle.push(label + ":close");
            await driver.close(reason);
            if (mode === "close-error" && judge)
              throw new Error("cleanup marker secret");
            if (mode === "main-close-error" && !judge)
              throw new Error("main cleanup failed");
          },
        };
      },
    },
  },
};
export default registry;
