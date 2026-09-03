/**
 * @module @x-agent-suite/harness/types
 * harness 层本地类型：对 @x-agent-suite/contracts 中未知字段的细化。
 */

/** live 模式下 WriteConfigContext.live 的细化形状（contracts 中为 unknown）。 */
export interface HarnessLiveChannel {
  /** wire 协议标识。 */
  readonly wire: string;
  /** 模型标识。 */
  readonly model: string;
  /** 归一 baseUrl（含版本前缀），给我方 wire builder 使用。 */
  readonly baseUrl: string;
  /** 宿主 CLI 期望的 baseUrl 原值形态。 */
  readonly harnessBaseUrl?: string;
  /** 凭证模式；"harness" 表示 OAuth 等特殊借用路径。 */
  readonly credential?: string;
}
