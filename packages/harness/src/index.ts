/**
 * @module @x-agent-suite/harness
 * x-agent-suite harness 层：HarnessProfile、一次性 driver 与长驻 driver 的通用执行机制。
 * 不变量：具体宿主 profile 由消费者注册，不在本包源码中内建或枚举。
 */

export {
  resolveHarnessChannel,
  type HarnessChannelInfo,
  type HarnessChannelResult,
  type HarnessChannelOptions,
} from "./harness-config.ts";
export {
  resolveHarnessCredential,
  type HarnessCredential,
  type HarnessCredentialOptions,
} from "./harness-credentials.ts";
export { createHarnessLiveConfigHooks } from "./live-config-hooks.ts";

export { createHarnessDriver, type HarnessDriverOptions } from "./driver.ts";
export {
  createPtyAgentDriver,
  type PtyAgentDriver,
  type PtyAgentDriverOptions,
} from "./pty-driver.ts";
export {
  createPtyScreenWatcher,
  type PtyScreenWatcherOptions,
  type PtyIdleResult,
} from "./pty-watcher.ts";
export { buildMcpServerSpec, writeJsonFile, tomlString } from "./mcp-config.ts";
export {
  installKimiPlugins,
  type PluginInstallSpec,
  type InstalledPlugin,
} from "./plugin-install.ts";
export {
  resolveHarnessCommand,
  HarnessUnavailableError,
  type HarnessCommandSpec,
  type ResolvedCommand,
} from "./resolve-command.ts";
export {
  cleanupPtyDriverResources,
  type PtyCleanupOptions,
} from "./pty-cleanup.ts";
