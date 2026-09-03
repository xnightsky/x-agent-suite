/**
 * @module packaging/entries/harness
 * 聚合分发包的零原生 harness 入口；长驻 PTY 能力由独立制品承载。
 */
export {
  resolveHarnessChannel,
  type HarnessChannelInfo,
  type HarnessChannelResult,
  type HarnessChannelOptions,
} from "../../packages/harness/src/harness-config.ts";
export {
  resolveHarnessCredential,
  type HarnessCredential,
  type HarnessCredentialOptions,
} from "../../packages/harness/src/harness-credentials.ts";
export { createHarnessLiveConfigHooks } from "../../packages/harness/src/live-config-hooks.ts";
export {
  createHarnessDriver,
  type HarnessDriverOptions,
} from "../../packages/harness/src/driver.ts";
export {
  buildMcpServerSpec,
  writeJsonFile,
  tomlString,
} from "../../packages/harness/src/mcp-config.ts";
export {
  installKimiPlugins,
  type PluginInstallSpec,
  type InstalledPlugin,
} from "../../packages/harness/src/plugin-install.ts";
export {
  resolveHarnessCommand,
  HarnessUnavailableError,
  type HarnessCommandSpec,
  type ResolvedCommand,
} from "../../packages/harness/src/resolve-command.ts";
