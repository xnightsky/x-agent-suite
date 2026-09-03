/**
 * @module @x-agent-suite/contracts/criterion
 * 判据插件协议：kit 与领域之间唯一的行为面。
 *
 * 不变量：
 * - 本库不预置任何判据；具体 metric 一律由消费者注册；
 * - kit 只提供协议、调度与聚合，不解释判据名与 expect 值的语义。
 */

import type { TurnObservation, SessionObservation } from "./observation.ts";

/** 单个判据的判定结果。 */
export interface CriterionResult {
  /** 是否通过。 */
  readonly pass: boolean;
  /** 0..1；布尔判据用 0/1。 */
  readonly score: number;
  /** 人类可读的判定理由。失败时应说清「期望什么、实际什么」。 */
  readonly reason: string;
}

/** 失败类别：让报告能区分「被测系统没做对」与「这次跑根本不算数」。 */
export interface FailureCategory {
  /** 出现在 reason 前缀里的短标识，如 `payload` → `[payload] ...`。 */
  readonly prefix: string;
  readonly description: string;
  readonly owner: "kit" | "domain";
}

/** turn scope 判据上下文。 */
export interface TurnCriterionContext {
  /** 当前轮次序号。 */
  readonly turnIndex: number;
  /** 跨轮上下文；衰减类判据需要它来回看更早的轮次。 */
  readonly session: SessionObservation;
  /** 该轮 `expect` 中本判据对应的值，原样透传。 */
  readonly expect: unknown;
}

/** session scope 判据上下文。 */
export interface SessionCriterionContext {
  /** 会话级 `expect` 中本判据对应的值，原样透传。 */
  readonly expect: unknown;
}

/** turn scope 判据。 */
export interface TurnCriterion {
  /** metric 名。同名判据可同时存在 turn 与 session 两个 scope。 */
  readonly name: string;
  readonly scope: "turn";
  evaluate(
    turn: TurnObservation,
    context: TurnCriterionContext,
  ): CriterionResult | Promise<CriterionResult>;
}

/** session scope 判据。 */
export interface SessionCriterion {
  readonly name: string;
  readonly scope: "session";
  evaluate(
    session: SessionObservation,
    context: SessionCriterionContext,
  ): CriterionResult | Promise<CriterionResult>;
}

/** 判据联合类型。 */
export type Criterion = TurnCriterion | SessionCriterion;

/** 逐轮判定结果。 */
export interface TurnCriterionOutcome extends CriterionResult {
  readonly name: string;
  readonly scope: "turn";
  readonly turnIndex: number;
}

/** 会话级判定结果。 */
export interface SessionCriterionOutcome extends CriterionResult {
  readonly name: string;
  readonly scope: "session";
}

/** 判据结果联合类型。 */
export type CriterionOutcome = TurnCriterionOutcome | SessionCriterionOutcome;
