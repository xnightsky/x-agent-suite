/**
 * @module @x-agent-suite/assertions/judge-assertion
 * AI 断言的薄适配：judge() 的具名裁定 → turn 判据结果。
 * 不变量：
 * - rubric 清单来自该轮 expect（JudgeRubric[]），形状交 judge() 现有校验；
 * - 不复制 Judge 渠道体系：目标决策、transport 与审批留在 @x-agent-suite/judge；
 * - CriterionResult 没有「不可评测」状态：不可评测与 rubric 缺证据抛普通 Error，
 *   message 保留 [not-evaluated:<kind>] / [absent] 前缀；只有明确 false 才映射 0 分。
 */
import type { CriterionResult, TurnCriterion } from "@x-agent-suite/contracts";
import {
  createJudgeClient,
  judge,
  type CreateJudgeClientOptions,
  type JudgeModelClient,
  type JudgeRubric,
} from "@x-agent-suite/judge";

/** AI 断言的公共基础选项；不含渠道、目标或审批参数。 */
export interface JudgeAssertionBaseOptions {
  /** 判据名，由调用方给定。 */
  readonly name: string;
  /** 每次 attempt 超时；透传给 judge()，undefined 走其默认值。 */
  readonly timeoutMs?: number;
  /** 首次调用后的重试上限；透传给 judge()，undefined 走其默认值。 */
  readonly maxRetries?: number;
}

/**
 * AI 断言的调用方配置：client 与 clientOptions 必须恰有一个。
 * client 分支注入现成客户端（fake、自定义或零 token 测试）；
 * clientOptions 分支在创建判据时同步经原生 Judge 工厂创建客户端。
 */
export type JudgeAssertionOptions =
  | (JudgeAssertionBaseOptions & {
      /** 现成模型客户端；与 clientOptions 互斥。 */
      readonly client: JudgeModelClient;
      readonly clientOptions?: never;
    })
  | (JudgeAssertionBaseOptions & {
      readonly client?: never;
      /** 原生 Judge 工厂配置；与 client 互斥，创建期为纯决策。 */
      readonly clientOptions: CreateJudgeClientOptions;
    });

/** 解析模型客户端来源；互斥规则在运行时再次把关，不回显配置内容。 */
function resolveJudgeAssertionClient(
  options: JudgeAssertionOptions,
): JudgeModelClient {
  const hasClient = options.client !== undefined;
  const hasClientOptions = options.clientOptions !== undefined;
  if (hasClient === hasClientOptions) {
    throw new TypeError(
      "AI 断言的 client 与 clientOptions 必须恰有一个：注入现成 client，" +
        "或提供 clientOptions 由原生 Judge 工厂创建；二者互斥",
    );
  }
  return hasClient ? options.client : createJudgeClient(options.clientOptions);
}

/**
 * 创建 AI 断言判据（turn scope，可直接用于 Recall 的 turn.expect）。
 * @param options 判据名、模型客户端与透传给 judge() 的执行选项。
 * @returns turn 判据；不可评测抛 `[not-evaluated:<kind>]` Error，缺证据抛 `[absent]` Error。
 * @throws TypeError name 不是非空字符串时抛出。
 */
export function createJudgeAssertion(
  options: JudgeAssertionOptions,
): TurnCriterion {
  const { name, timeoutMs, maxRetries } = options;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("AI 断言判据名必须是非空字符串");
  }
  const client = resolveJudgeAssertionClient(options);
  return {
    name,
    scope: "turn",
    async evaluate(turn, context): Promise<CriterionResult> {
      const outcome = await judge(
        {
          output: turn.text,
          rubrics: context.expect as readonly JudgeRubric[],
        },
        { client, timeoutMs, maxRetries },
      );
      if (outcome.status === "not-evaluated") {
        const { kind, message } = outcome.failure;
        throw new Error(
          `[not-evaluated:${kind}] 判据 ${name} 本次不可评测：${message}`,
        );
      }
      if (outcome.absent.length > 0) {
        throw new Error(
          `[absent] 判据 ${name} 缺少 rubric 证据：${outcome.absent.join("、")}`,
        );
      }
      const failed = outcome.verdicts.filter((verdict) => !verdict.pass);
      if (failed.length === 0) {
        return {
          pass: true,
          score: 1,
          reason: `全部 ${outcome.verdicts.length} 项 rubric 通过`,
        };
      }
      return {
        pass: false,
        score: 0,
        reason:
          "未通过：" +
          failed
            .map((item) =>
              item.reason.length > 0
                ? `${item.name}(${item.reason})`
                : item.name,
            )
            .join("、"),
      };
    },
  };
}
