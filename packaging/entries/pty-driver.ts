/**
 * @module packaging/entries/pty-driver
 * 独立 PTY 制品入口：承载原生终端进程、屏幕观察与长驻会话驱动。
 */
export {
  PtyProcess,
  type PtyProcessOptions,
} from "../../packages/driver/src/pty.ts";
export {
  createPtyScreen,
  type PtyScreenOptions,
  type PtyScreen,
  type CursorPosition,
} from "../../packages/driver/src/pty-screen.ts";
export {
  createPtyAgentDriver,
  type PtyAgentDriver,
  type PtyAgentDriverOptions,
} from "../../packages/harness/src/pty-driver.ts";
export {
  createPtyScreenWatcher,
  type PtyScreenWatcherOptions,
  type PtyIdleResult,
} from "../../packages/harness/src/pty-watcher.ts";
export {
  cleanupPtyDriverResources,
  type PtyCleanupOptions,
} from "../../packages/harness/src/pty-cleanup.ts";
export {
  startHarnessBackend,
  type StartedHarnessBackend,
} from "../../packages/harness/src/backend-context.ts";
