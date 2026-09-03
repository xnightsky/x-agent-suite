/**
 * @module @x-agent-suite/contracts/scenario
 * 场景统一接口：id + run。
 *
 * 不变量：
 * - deps/result 由各场景自定义泛型；
 * - 场景编排不直接 new driver，一律由调用方注入。
 */

/**
 * 一个可运行场景：固定 id + 一次 run。
 *
 * @typeParam Deps 场景注入依赖（driver、artifact 采集器、超时等）。
 * @typeParam Result 场景运行结果（含 ScenarioResult 或等价的结构化证据）。
 */
export interface Scenario<Deps, Result> {
  /** 场景 id（与 fixtures/prompts/<id>/ 目录同名，供 matrix 发现变体）。 */
  readonly id: string;
  /** 执行场景；基础设施失败显式抛错，评分不达标由 Result 中的 pass 标记表达（不抛错）。 */
  run(deps: Deps): Promise<Result>;
}
