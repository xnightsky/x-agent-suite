/**
 * @module @x-agent-suite/sandbox
 * x-agent-suite sandbox 层：临时 HOME / cwd / env 隔离。
 *
 * 不变量：隔离是通用的，不依赖任何被测系统的配置格式。
 */

export { createSandbox } from "./create.ts";
export { cleanupSandbox } from "./cleanup.ts";
export type {
  CreateSandboxOptions,
  SandboxContext,
} from "@x-agent-suite/contracts";
