/**
 * @module @x-agent-suite/driver
 * x-agent-suite driver 层：AgentDriver / LongLivedAgentDriver 接口、子进程基座与协议无关 JSON-RPC wire 层。
 * 不变量：本包只定义“怎么把话送进被测系统”，不解释被测系统是谁。
 */

export { JsonlProcess, type SpawnJsonlOptions } from "./proc.ts";
export { PtyProcess, type PtyProcessOptions } from "./pty.ts";
export {
  createPtyScreen,
  type PtyScreenOptions,
  type PtyScreen,
  type CursorPosition,
} from "./pty-screen.ts";
export { LfFramer, type LfFramerOptions } from "./jsonl-framing.ts";
export { AsyncQueue } from "./queue.ts";
export { MockDriver } from "./mock.ts";
export {
  JsonRpcPeer,
  type JsonRpcPeerOptions,
  type JsonRpcIncomingRequest,
  type JsonRpcNotification,
  type JsonRpcReverseAnswer,
} from "./jsonrpc-peer.ts";
export {
  LongLivedJsonRpcDriver,
  type LongLivedJsonRpcDriverOptions,
  type JsonRpcLongLivedAdapter,
  type JsonRpcRequestSpec,
  type NotificationMapping,
} from "./long-lived-jsonrpc.ts";

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
} from "@x-agent-suite/contracts";
