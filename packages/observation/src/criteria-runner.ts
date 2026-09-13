/**
 * @module @x-agent-suite/observation/criteria-runner
 * 判据调度：把判据集按 expect 块分发到各轮/会话，产出具名判定结果。
 *
 * 不变量：
 * - 只跑被 expect 引用的判据；expect 键必须能解析到已注册判据（引用完整性）；
 * - 本模块不解释判据名与 expect 值的语义，调度即全部职责；
 * - 离线可用：不起 driver，已有 Observation 即可判分。
 */

import type {
  Criterion,
  CriterionOutcome,
  ExpectBlock,
  SessionObservation,
} from "@x-agent-suite/contracts";

/** runCriteria 入参。 */
export interface RunCriteriaOptions {
  /** 会话观测（各轮切片在 session.turns 上）。 */
  readonly session: SessionObservation;
  /** 已注册判据集。 */
  readonly criteria: readonly Criterion[];
  /** 每轮 expect 块（与 session.turns 对齐；缺省或 undefined 表示该轮不判）。 */
  readonly turnExpects?: readonly (ExpectBlock | undefined)[];
  /** 会话级 expect 块。 */
  readonly sessionExpect?: ExpectBlock;
}

/** 按 name + scope 建索引；重复注册显式抛错。 */
function indexCriteria(criteria: readonly Criterion[]): Map<string, Criterion> {
  const index = new Map<string, Criterion>();
  for (const criterion of criteria) {
    const key = `${criterion.scope}:${criterion.name}`;
    if (index.has(key)) {
      throw new Error(`判据重复注册：${criterion.name}（${criterion.scope}）`);
    }
    index.set(key, criterion);
  }
  return index;
}

/** 校验 expect 键都能解析到对应 scope 的判据。 */
function assertExpectIntegrity(
  block: ExpectBlock,
  scope: Criterion["scope"],
  index: Map<string, Criterion>,
): void {
  for (const key of Object.keys(block)) {
    if (!index.has(`${scope}:${key}`)) {
      throw new Error(`expect 引用了未注册的 ${scope} 判据：${key}`);
    }
  }
}

/**
 * 调度入口：分发判据并按序收集具名结果。
 * turn 判据逐轮跑声明了 expect 的轮次；session 判据跑会话级 expect。
 */
export async function runCriteria(
  options: RunCriteriaOptions,
): Promise<readonly CriterionOutcome[]> {
  const { session, criteria, turnExpects = [], sessionExpect } = options;
  const index = indexCriteria(criteria);
  const outcomes: CriterionOutcome[] = [];

  for (const turn of session.turns) {
    const block = turnExpects[turn.index];
    if (!block) continue;
    assertExpectIntegrity(block, "turn", index);
    for (const [name, expect] of Object.entries(block)) {
      const criterion = index.get(`turn:${name}`)!;
      if (criterion.scope !== "turn") continue; // 索引键已保证，仅供类型收窄
      const result = await criterion.evaluate(turn, {
        turnIndex: turn.index,
        session,
        expect,
      });
      outcomes.push({ name, scope: "turn", turnIndex: turn.index, ...result });
    }
  }

  if (sessionExpect) {
    assertExpectIntegrity(sessionExpect, "session", index);
    for (const [name, expect] of Object.entries(sessionExpect)) {
      const criterion = index.get(`session:${name}`)!;
      if (criterion.scope !== "session") continue; // 索引键已保证，仅供类型收窄
      const result = await criterion.evaluate(session, { expect });
      outcomes.push({ name, scope: "session", ...result });
    }
  }

  return outcomes;
}
