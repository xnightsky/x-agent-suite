/**
 * @module @x-agent-suite/judge/types
 * Judge 公共输入、结果、客户端配置与错误类型。
 * 不变量：AI 不出分；Judge 不建立独立渠道注册表，TargetTags 由通用层提供。
 */
import type { AgentDriver } from "@x-agent-suite/contracts";
import type {
  LiveBackend,
  LiveConfigOptions,
  LiveTransport,
  ResolvedLiveTarget,
  TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";

/** Judge 的模型访问模式；每次调用固定一种，不自动切换。 */
export type JudgeMode = "borrowed" | "direct";

/** Judge 的工具策略；none 禁工具，read-only 仅允许只读证据。 */
export type JudgeToolPolicy = "none" | "read-only";

/** 一项独立判断依据。 */
export interface JudgeRubric {
  /** 清单内唯一的稳定关联名。 */
  readonly name: string;
  /** 交给裁判模型的自然语言判断标准。 */
  readonly rubric: string;
}

/** 一次批量 Judge 调用的输入。 */
export interface JudgeInput {
  /** 被评判的完整答案文本。 */
  readonly output: string;
  /** 非空 rubric 清单；每次 attempt 全部进入同一调用。 */
  readonly rubrics: readonly JudgeRubric[];
}

/** 一个具名布尔裁定；不包含分数或整体通过结论。 */
export interface JudgeVerdict {
  /** 对应输入 rubric 的名称。 */
  readonly name: string;
  /** 模型明确给出的布尔裁定。 */
  readonly pass: boolean;
  /** 模型给出的理由；缺省为空串。 */
  readonly reason: string;
}

/** 整体不可评测的失败类别。 */
export type JudgeFailureKind =
  | "not-configured"
  | "timeout"
  | "rate-limited"
  | "transport"
  | "empty-response"
  | "parse"
  | "protocol"
  | "cleanup"
  | "client";

/** 整体不可评测的脱敏诊断。 */
export interface JudgeFailure {
  /** 失败类别，用于重试预算与调用方分层。 */
  readonly kind: JudgeFailureKind;
  /** 不包含完整 prompt、响应或凭据的诊断。 */
  readonly message: string;
}

/** Judge 结果；completed 只表示执行完成，不表示内容通过。 */
export type JudgeOutcome =
  | {
      /** 调用与整体解析完成；单项仍可能 absent。 */
      readonly status: "completed";
      /** 按 rubric 输入顺序排列的明确裁定。 */
      readonly verdicts: readonly JudgeVerdict[];
      /** 响应缺失或无法识别的 rubric 名称。 */
      readonly absent: readonly string[];
      /** 实际模型调用次数。 */
      readonly attempts: number;
    }
  | {
      /** 整体未能评测；不得转换为内容失败或零分。 */
      readonly status: "not-evaluated";
      /** 整体失败类别与脱敏诊断。 */
      readonly failure: JudgeFailure;
      /** 实际模型调用次数。 */
      readonly attempts: number;
    };

/** 单次模型调用的最小输入。 */
export interface JudgeModelRequest {
  /** 核心生成的完整 judge-v1 prompt。 */
  readonly prompt: string;
  /** 当前 attempt 的取消信号。 */
  readonly signal: AbortSignal;
}

/** 单次模型调用的未解析文本结果。 */
export interface JudgeModelResponse {
  /** 原始响应文本，由 Judge 核心统一解析。 */
  readonly text: string;
}

/** Judge 核心依赖的模型调用接缝。 */
export interface JudgeModelClient {
  /** 执行一次调用；实现必须响应 signal 并完成自身清理。 */
  complete(request: JudgeModelRequest): Promise<JudgeModelResponse>;
}

/** judge() 的执行选项。 */
export interface JudgeOptions {
  /** 必填模型客户端；核心不创建默认客户端。 */
  readonly client: JudgeModelClient;
  /** 场景 prompt 配置；省略时使用完整 judge-v1。 */
  readonly prompt?: {
    /** 在默认协议之后追加的场景约束；不替换 verdict 协议。 */
    readonly instructions?: string;
  };
  /** 每次 attempt 的超时，缺省 30 秒。 */
  readonly timeoutMs?: number;
  /** 首次调用后的最大重试次数，缺省 2，另受类别预算约束。 */
  readonly maxRetries?: number;
}

/** 输入或组合配置非法；在模型调用前抛出。 */
export class JudgeDefinitionError extends Error {
  /** 创建定义错误。 */
  constructor(message: string) {
    super(message);
    this.name = "JudgeDefinitionError";
  }
}

/** 已分类的模型执行错误；judge() 将其转为 not-evaluated。 */
export class JudgeModelError extends Error {
  /** 执行失败类别。 */
  readonly kind: JudgeFailureKind;

  /** 创建已分类执行错误。 */
  constructor(kind: JudgeFailureKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JudgeModelError";
    this.kind = kind;
  }
}

/** 两种客户端工厂共用的目标、标签与审批配置。 */
export interface JudgeClientBaseOptions {
  /** 现有 resolver 产出的完整目标。 */
  readonly target: ResolvedLiveTarget;
  /** 通用四层能力目录，不建立 Judge 专用渠道注册表。 */
  readonly tags: TargetTagCatalog;
  /** 工具策略；缺省 none，read-only 只允许 borrowed。 */
  readonly toolPolicy?: JudgeToolPolicy;
  /** 仅表示本次已获显式 live 审批，不是永久授权。 */
  readonly liveReviewApproved?: boolean;
  /** 多候选时显式选择 CLI 能力目录/profile。 */
  readonly cliRef?: string;
  /** 现有 live 配置与借用 hooks。 */
  readonly config?: LiveConfigOptions;
}

/** direct 客户端工厂配置。 */
export interface DirectJudgeClientOptions extends JudgeClientBaseOptions {
  /** 显式指定 direct；省略时仅在唯一候选为 direct 时自动选择。 */
  readonly mode?: "direct";
  /** 测试或自定义传输接缝。 */
  readonly transport?: LiveTransport;
}

/** borrowed 客户端工厂配置。 */
export interface BorrowedJudgeClientOptions extends JudgeClientBaseOptions {
  /** 显式指定 borrowed；省略时仅在唯一候选为 borrowed 时自动选择。 */
  readonly mode?: "borrowed";
  /** 每次 attempt 创建符合 toolPolicy 的全新隔离 driver。 */
  readonly createDriver: (context: {
    /** 当前完整目标。 */
    readonly target: ResolvedLiveTarget;
    /** 当前 attempt 的新 backend，由 driver 生命周期管理。 */
    readonly backend: LiveBackend;
    /** 本次唯一选定的 CLI 能力目录/profile。 */
    readonly cliRef?: string;
    /** 本次工具策略；read-only 的实际只读约束由工厂兑现。 */
    readonly toolPolicy: JudgeToolPolicy;
  }) => AgentDriver;
}

/** createJudgeClient 的判别联合配置。 */
export type CreateJudgeClientOptions =
  DirectJudgeClientOptions | BorrowedJudgeClientOptions;

/** 带目标归因信息的 Judge 模型客户端。 */
export interface JudgeClient extends JudgeModelClient {
  /** 当前客户端固定访问模式。 */
  readonly mode: JudgeMode;
  /** 当前客户端固定完整目标。 */
  readonly target: ResolvedLiveTarget;
  /** borrowed 唯一确定的 CLI 能力目录/profile；direct 缺省。 */
  readonly cliRef?: string;
}
