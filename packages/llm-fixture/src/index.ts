/**
 * @module @x-agent-suite/llm-fixture
 * x-agent-suite LLM fixture 层：fake provider 与 live backend。
 * 不变量：wire 协议适配是通用的，不依赖被测系统的业务语义。
 */

export { FakeProviderBackend } from "./fake-provider.ts";
export {
  LiveBackend,
  LiveNotConfiguredError,
  estimateCostUsd,
  type LiveBackendOptions,
  type LiveCompleteInput,
} from "./live.ts";
export { createLlmBackend, type LiveFactoryOptions } from "./factory.ts";
export {
  sniffLiveChannel,
  type SniffOptions,
  type SniffResult,
  type SniffStage,
} from "./sniff-gate.ts";
export {
  loadLiveConfig,
  resolveLiveApiKey,
  resolveLiveChannel,
  resolveLiveTargets,
  resolveLiveCredential,
  LIVE_CONFIG_PATH_ENV,
  LIVE_CONFIG_FILE,
  type LiveChannel,
  type LiveCarrierKind,
  type LiveCarrierResolution,
  type LiveChannelPricing,
  type LiveChannelResult,
  type LiveConfigLoad,
  type LiveConfigOptions,
  type LiveConfigSource,
  type LiveConfigWarning,
  type LiveTargetRef,
  type LiveTargetSelection,
  type LiveTargetsResult,
  type ResolvedLiveTarget,
  type BorrowedChannelResult,
  type BorrowedCredentialResult,
} from "./live-config.ts";
export {
  LIVE_AUTH_CONFIG_FILE,
  LIVE_AUTH_CONFIG_PATH_ENV,
  LiveAuthConfigError,
  loadLiveAuthConfig,
  parseLiveAuthConfig,
  type LiveAuthConfig,
  type LiveAuthConfigLoad,
  type LiveAuthConfigOptions,
  type LiveAuthConfigSource,
  type LiveAuthEntry,
} from "./live-auth-config.ts";
export { decideLiveTarget, decideLiveTargets } from "./target-tag-decision.ts";
export {
  loadTargetTagCatalog,
  parseTargetTagDictionary,
  parseTargetTagInstances,
  TargetTagDefinitionError,
  TARGET_TAG_DICTIONARY_FILE,
  TARGET_TAG_INSTANCES_FILE,
} from "./target-tags.ts";
export type {
  CliTags,
  LivePolicyDecision,
  LivePolicyStatus,
  LiveTargetDecision,
  LiveTargetDecisionResult,
  LoadTargetTagCatalogOptions,
  ModelTags,
  ProviderModelTags,
  ProviderTags,
  TargetAccessMode,
  TargetAccessDecisionOptions,
  TargetDecisionOptions,
  TargetModeEvaluation,
  TargetTagCatalog,
  TargetTagDictionary,
  TargetTagInstances,
  TargetTagKey,
  TargetTagRequirement,
  TargetTagScope,
  TargetTagStatus,
} from "./target-tag-types.ts";
export {
  buildLiveRequest,
  createFetchTransport,
  type LiveCompletion,
  type LiveCompletionToolCall,
  type LiveMessage,
  type LiveRequest,
  type LiveRequestInput,
  type LiveResponse,
  type LiveToolCallReq,
  type LiveToolSpec,
  type LiveTransport,
  type LiveUsage,
} from "./live-wires.ts";
export { LiveHttpError, parseLiveResponse } from "./live-parse.ts";
export {
  createSecretRedactor,
  redactLiveError,
  redactLiveSecrets,
  redactValue,
} from "./redact.ts";
