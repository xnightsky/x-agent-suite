/**
 * @module packaging/entries/driver
 * 聚合分发包的零原生 driver 入口；PTY 能力由独立制品承载。
 */
export {
  JsonlProcess,
  type SpawnJsonlOptions,
} from "../../packages/driver/src/proc.ts";
export {
  LfFramer,
  type LfFramerOptions,
} from "../../packages/driver/src/jsonl-framing.ts";
export { AsyncQueue } from "../../packages/driver/src/queue.ts";
export { MockDriver } from "../../packages/driver/src/mock.ts";
export type {
  AgentDriver,
  LongLivedAgentDriver,
  InboundEvent,
  InjectMode,
  ParsedEvent,
  ServerSpawnSpec,
  HarnessArgsContext,
  HarnessSandboxOptions,
  PtyArgsContext,
  WriteConfigContext,
  HarnessProfile,
  HarnessDriver,
  DriverEvent,
  Observation,
  ToolCall,
} from "../../packages/contracts/src/index.ts";
