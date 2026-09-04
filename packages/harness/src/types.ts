/**
 * @module @x-agent-suite/harness/types
 * harness 层本地类型：对 @x-agent-suite/contracts 中未知字段的细化。
 */
import type { LlmLiveChannel } from "@x-agent-suite/contracts";

/**
 * live 模式下 WriteConfigContext.live 的细化形状（contracts 的 WriteConfigContext 中为 unknown）。
 * 与契约品牌字段 LlmBackend.liveChannel 同一类型，保证两条消费路径形状一致。
 */
export type HarnessLiveChannel = LlmLiveChannel;
