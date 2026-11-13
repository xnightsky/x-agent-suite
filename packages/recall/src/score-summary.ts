/** @module @x-agent-suite/recall/score-summary
 * Recall repeat 与 target×case suite 的纯计分统计；不执行场景、不推断 ERROR。
 * 不变量：内容 FAIL 是有效 repeat；无有效行为或分数时使用 null，不虚构零分。
 */

/** 一个正常完成 repeat 的计分输入；无断言时 rawScore 为 null。 */
export interface RecallRepeatScoreInput {
  readonly hardPass: boolean;
  readonly rawScore: number | null;
}

/** 单 case 的 repeat 计分汇总。 */
export interface RecallRepeatScoreSummary {
  readonly planned: number;
  readonly valid: number;
  readonly invalid: number;
  readonly skipped: number;
  readonly coverage: number;
  readonly invalidRate: number;
  readonly passRate: number | null;
  readonly rawScore: {
    readonly mean: number;
    readonly min: number;
    readonly max: number;
  } | null;
  readonly passAtK: boolean | null;
  readonly passAllK: boolean | null;
}

/** target×case 的 suite 宏平均；passAtK/passAllK 为 case 布尔值的比例。 */
export interface RecallSuiteScoreSummary {
  readonly planned: number;
  readonly valid: number;
  readonly invalid: number;
  readonly skipped: number;
  readonly coverage: number;
  readonly invalidRate: number;
  readonly passRate: number | null;
  readonly rawScore: number | null;
  readonly passAtK: number | null;
  readonly passAllK: number | null;
}

/** 未执行或无效数量的显式计数；调用方不得把内容 FAIL 放入 invalid。 */
export interface RecallScoreCountOptions {
  readonly invalid?: number;
  readonly skipped?: number;
}

function counts(
  planned: number,
  valid: number,
  options: RecallScoreCountOptions | undefined,
): Required<RecallScoreCountOptions> {
  const invalid = options?.invalid ?? 0;
  const skipped = options?.skipped ?? 0;
  if (
    !Number.isInteger(planned) ||
    planned < 1 ||
    ![valid, invalid, skipped].every(
      (value) => Number.isInteger(value) && value >= 0,
    ) ||
    valid + invalid + skipped !== planned
  )
    throw new Error(
      "Recall 计分统计计数必须满足 valid+invalid+skipped=planned",
    );
  return { invalid, skipped };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 汇总单 case 的独立 repeat；rawScore 仅统计实际声明断言的有效轮次。 */
export function summarizeRecallRepeatScores(
  planned: number,
  repeats: readonly RecallRepeatScoreInput[],
  options?: RecallScoreCountOptions,
): RecallRepeatScoreSummary {
  const { invalid, skipped } = counts(planned, repeats.length, options);
  const scores = repeats
    .map((repeat) => {
      if (typeof repeat.hardPass !== "boolean")
        throw new Error("Recall repeat hardPass 必须是 boolean");
      if (repeat.rawScore !== null && !Number.isFinite(repeat.rawScore))
        throw new Error("Recall repeat rawScore 必须是有限数或 null");
      return repeat.rawScore;
    })
    .filter((score): score is number => score !== null);
  const valid = repeats.length;
  const passed = repeats.filter((repeat) => repeat.hardPass).length;
  return {
    planned,
    valid,
    invalid,
    skipped,
    coverage: valid / planned,
    invalidRate: invalid / planned,
    passRate: valid === 0 ? null : passed / valid,
    rawScore:
      scores.length === 0
        ? null
        : {
            mean: mean(scores),
            min: Math.min(...scores),
            max: Math.max(...scores),
          },
    passAtK: valid === 0 ? null : passed > 0,
    passAllK: valid > 0 && valid === planned && passed === planned,
  };
}

/** 对有效 target×case 的 repeat 汇总做宏平均；无效 case 不参与行为均值。 */
export function summarizeRecallSuiteScores(
  planned: number,
  cases: readonly RecallRepeatScoreSummary[],
  options?: RecallScoreCountOptions,
): RecallSuiteScoreSummary {
  const { invalid, skipped } = counts(planned, cases.length, options);
  if (cases.some((item) => item.valid === 0))
    throw new Error("Recall suite 行为宏平均只接受有效 case");
  const passRates = cases.flatMap((item) =>
    item.passRate === null ? [] : [item.passRate],
  );
  const scores = cases.flatMap((item) =>
    item.rawScore === null ? [] : [item.rawScore.mean],
  );
  const passAtK = cases.flatMap((item) =>
    item.passAtK === null ? [] : [Number(item.passAtK)],
  );
  const passAllK = cases.flatMap((item) =>
    item.passAllK === null ? [] : [Number(item.passAllK)],
  );
  return {
    planned,
    valid: cases.length,
    invalid,
    skipped,
    coverage: cases.length / planned,
    invalidRate: invalid / planned,
    passRate: passRates.length === 0 ? null : mean(passRates),
    rawScore: scores.length === 0 ? null : mean(scores),
    passAtK: passAtK.length === 0 ? null : mean(passAtK),
    passAllK: passAllK.length === 0 ? null : mean(passAllK),
  };
}
