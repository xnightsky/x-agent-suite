/**
 * @module @x-agent-suite/contracts/registry
 * 注册表函数类型：driver / criterion / scenario / profile 均通过注册进入框架。
 *
 * 不变量：
 * - 注册表只声明函数类型，不持有任何运行时状态；
 * - 具体 driver / profile / 判据 / 场景由消费者提供，框架内不枚举取值。
 */

import type {
  AgentDriver,
  HarnessProfile,
  InboundEvent,
  InjectMode,
} from "./driver.ts";
import type { Observation } from "./observation.ts";
import type { Criterion } from "./criterion.ts";
import type { Scenario } from "./scenario.ts";

/** 长驻会话注册扩展：声明 injectMode 时必须同时实现三件套。 */
export interface LongLivedDriverRegistration {
  /** 长驻驱动的注入语义；声明后必须同时实现 inject/inbound/waitInbound。 */
  readonly injectMode: InjectMode;
  /** 向存活会话注入一条 prompt。 */
  inject(text: string): Promise<Observation>;
  /** 按序暴露入站事件流。 */
  inbound(): AsyncIterable<InboundEvent>;
  /** 等待满足条件的入站事件，超时显式抛错。 */
  waitInbound(
    match: (event: InboundEvent) => boolean,
    timeoutMs: number,
  ): Promise<InboundEvent>;
}

/**
 * 驱动注册项。
 *
 * 在 `AgentDriver` 基础上增加 `id`；长驻三件套
 * （injectMode/inject/inbound/waitInbound）要么齐全要么全无，
 * 由判别联合在编译期强制，不再依赖运行时校验。
 */
export type DriverRegistration = AgentDriver & { readonly id: string } & (
    LongLivedDriverRegistration | { readonly injectMode?: never }
  );

/** 注册一个 driver。 */
export type RegisterDriver = (driver: DriverRegistration) => void;

/** 注册一个 profile。 */
export type RegisterProfile = (profile: HarnessProfile) => void;

/** 注册一个判据。 */
export type RegisterCriterion = (criterion: Criterion) => void;

/** 注册一个场景。 */
export type RegisterScenario = <Deps, Result>(
  scenario: Scenario<Deps, Result>,
) => void;

/** 注册表统一接口。 */
export interface Registry {
  /** 注册 driver。 */
  readonly registerDriver: RegisterDriver;
  /** 注册 profile。 */
  readonly registerProfile: RegisterProfile;
  /** 注册判据。 */
  readonly registerCriterion: RegisterCriterion;
  /** 注册场景。 */
  readonly registerScenario: RegisterScenario;
}
