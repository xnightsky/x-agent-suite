/**
 * @module @x-agent-suite/recall
 * 原生 Recall：显式 target、独立 registry、effects-only Plan、场景 DSL 与单 Runner。
 */
export {
  loadRecall,
  type LoadedRecall,
  type LoadRecallOptions,
  type RecallExecutionPlan,
} from "./load.ts";
export {
  runRecall,
  type RecallCaseRun,
  type RecallInfraFailure,
  type RecallRunResult,
} from "./run.ts";
export { main } from "./cli.ts";
export {
  emptyRecallRegistry,
  loadRecallRegistry,
  type RecallCriterionDescriptor,
  type RecallCriterionFactory,
  type RecallCriterionFactoryContext,
  type RecallCriterionRegistration,
  type RecallExecutionProfile,
  type RecallProfileDriverContext,
  type RecallRegistry,
} from "./registry.ts";
export {
  assembleRecallCriteria,
  type AssembleRecallCriteriaOptions,
} from "./criterion-assembly.ts";
export {
  isRecallCommandAllowed,
  loadRecallEffectsPlan,
  type RecallCommandsPolicy,
  type RecallEffects,
  type RecallEffectsProfile,
  type RecallToolsPolicy,
} from "./effects.ts";
export {
  materializeRecallProvision,
  readRecallResources,
  type RecallCompiledResource,
} from "./resources.ts";
