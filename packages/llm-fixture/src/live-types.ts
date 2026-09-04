/**
 * @module @x-agent-suite/llm-fixture/live-types
 * live 配置、借用渠道与借用凭据的公开类型契约。
 */
import type { WireProtocol } from "@x-agent-suite/contracts";

/** 渠道声明的来源（"home-dot" 为 ~/.env.e2e.yaml，"user-home" 为历史路径 ~/.config/x-agent-suite/.env.e2e.yaml）。 */
export type LiveConfigSource =
  "env" | "explicit-path" | "repo-local" | "home-dot" | "user-home";

/** 成本估算单价（美元 / 百万 token）；缺省时 costUsd 不估算。 */
export interface LiveChannelPricing {
  /** 输入单价（USD / 1M prompt tokens）。 */
  readonly inputPerMTokUsd: number;
  /** 输出单价（USD / 1M completion tokens）。 */
  readonly outputPerMTokUsd: number;
}

/** 借用渠道配置的结果（由 harness 包等消费者注入）。 */
export type BorrowedChannelResult =
  | {
      readonly kind: "resolved";
      readonly wire: WireProtocol;
      readonly baseUrl: string;
      readonly model?: string;
      readonly provider?: string;
      readonly harnessBaseUrl?: string;
      readonly source: string;
    }
  | { readonly kind: "missing"; readonly reason: string };

/** 借用凭证的结果（由 harness 包等消费者注入）。 */
export type BorrowedCredentialResult =
  | {
      readonly kind: "resolved";
      readonly apiKey: string;
      readonly source: string;
      readonly expiresAt?: number;
    }
  | { readonly kind: "missing"; readonly reason: string };

/** 一个 carrier 的渠道声明（baseUrl 含版本前缀，如 "https://host/v1"）。 */
export interface LiveChannel {
  /** wire 协议类型。 */
  readonly wire: WireProtocol;
  /** API base URL（私密，输出必须脱敏）。 */
  readonly baseUrl: string;
  /** 模型标识。 */
  readonly model: string;
  /** API key 字面量（私密；与 apiKeyEnv 恰居其一或均缺省）。 */
  readonly apiKey?: string;
  /** 存放 API key 的环境变量名。 */
  readonly apiKeyEnv?: string;
  /** 凭证模式：声明 "harness" 时仅在 borrowChannel 验证端点归属后借用宿主 CLI 登录态。 */
  readonly credential?: "harness";
  /** 渠道来源："harness" 表示 baseUrl/wire/model 经 borrowChannel 借用了宿主 CLI 自己的配置（load 阶段合并）。 */
  readonly from?: "harness";
  /** 宿主 CLI 自己期望的 baseUrl 形态（仅借用路径有意义）。 */
  readonly harnessBaseUrl?: string;
  /** 宿主侧 provider 键名（仅多 provider 宿主的借用路径使用）。 */
  readonly provider?: string;
  /** 借用源宿主名；缺省用 carrier 名索引宿主配置。 */
  readonly harness?: string;
  /** 成本估算单价（可选）。 */
  readonly pricing?: LiveChannelPricing;
}

/** 配置区加载结果：命中文件或显式「未配置」。 */
export type LiveConfigLoad =
  | {
      readonly kind: "loaded";
      /** 文件来源（env 覆盖在 resolveLiveChannel 阶段叠加，不在此体现）。 */
      readonly source: Exclude<LiveConfigSource, "env">;
      /** 命中的文件路径。 */
      readonly path: string;
      /** 按 carrier 索引的合法渠道声明。 */
      readonly channels: Readonly<Record<string, LiveChannel>>;
      /** 非法声明的 carrier → 校验原因。 */
      readonly invalid: Readonly<Record<string, string>>;
    }
  | { readonly kind: "not-configured"; readonly reason: string };

/** 单 carrier 解析结果。 */
export type LiveChannelResult =
  | {
      readonly kind: "configured";
      readonly carrier: string;
      readonly channel: LiveChannel;
      /** 生效来源（任一字段来自 env 覆盖即为 "env"）。 */
      readonly source: LiveConfigSource;
    }
  | {
      readonly kind: "not-configured";
      readonly carrier: string;
      readonly reason: string;
    };

/** loadLiveConfig 的可选项（测试注入用；缺省取真实环境）。 */
export interface LiveConfigOptions {
  /** 环境变量表；缺省 process.env。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 仓库根目录（repo-local 文件查找基点）；缺省按本文件位置推导。 */
  readonly repoRoot?: string;
  /** 用户 home 目录；缺省 os.homedir()。 */
  readonly homeDir?: string;
  /** 渠道借用钩子；声明 from: harness 时调用，未提供则借用失败。options.provider 为借用目标选择器（仅多 provider 宿主消费，单渠道宿主可忽略）。 */
  readonly borrowChannel?: (
    carrier: string,
    homeDir: string,
    options?: { readonly provider?: string },
  ) => Promise<BorrowedChannelResult>;
  /** 凭证借用钩子；与 borrowChannel 成对提供，声明 credential: harness 时调用。 */
  readonly borrowCredential?: (
    carrier: string,
    options: {
      readonly homeDir: string;
      readonly env: NodeJS.ProcessEnv;
      readonly now: number;
      readonly provider?: string;
    },
  ) => Promise<BorrowedCredentialResult>;
}
