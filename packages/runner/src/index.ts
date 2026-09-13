/**
 * @module @x-agent-suite/runner
 * 场景运行器公共入口：Registry 运行时、ScenarioSpec 执行与 CLI。
 */
export { createRegistry, type RuntimeRegistry } from "./registry.ts";
export {
  runScenarioSpec,
  type RunScenarioSpecDeps,
  type RunnerArtifact,
} from "./run-scenario.ts";
export {
  runScenarioRepeat,
  summarizeRepeat,
  type RepeatRun,
} from "./repeat.ts";
export { main, loadRunConfig, type RunConfig } from "./cli.ts";
