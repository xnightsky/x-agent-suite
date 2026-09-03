/**
 * @module @x-agent-suite/harness/backend-context
 * backend 启动后写入 harness sandbox 的共享上下文构造。
 */
import type { HarnessProfile, LlmBackend } from "@x-agent-suite/contracts";
import { LiveBackend } from "@x-agent-suite/llm-fixture";
import type { HarnessLiveChannel } from "./types";

/** backend 启动后供 sandbox 与宿主配置使用的上下文。 */
export interface StartedHarnessBackend {
  /** endpoint 地址。 */
  readonly baseUrl: string;
  /** fixture 或 live 凭据。 */
  readonly apiKey: string;
  /** 仅写入 sandbox 子进程的环境变量。 */
  readonly env: Record<string, string>;
  /** live 模式下解析出的渠道。 */
  readonly liveChannel?: HarnessLiveChannel;
}

/** 启动 backend，并构造只供 sandbox 使用的环境变量。 */
export async function startHarnessBackend(
  backend: LlmBackend,
  profile: HarnessProfile,
): Promise<StartedHarnessBackend> {
  const live = backend.mode === "live";
  const { baseUrl, apiKey } = await backend.start();
  const liveChannel =
    live && backend instanceof LiveBackend
      ? (backend.channel as HarnessLiveChannel)
      : undefined;
  const env: Record<string, string> = live ? {} : { ...profile.extraEnv };
  if (!live) {
    if (profile.baseUrlEnv) env[profile.baseUrlEnv] = baseUrl;
    if (profile.apiKeyEnv) env[profile.apiKeyEnv] = apiKey;
  } else if (liveChannel) {
    if (profile.apiKeyEnv && apiKey) env[profile.apiKeyEnv] = apiKey;
    for (const [key, value] of Object.entries(
      profile.liveEnv?.({ channel: liveChannel, apiKey }) ?? {},
    )) {
      if (value !== "") env[key] = value;
    }
  }
  return { baseUrl, apiKey, env, ...(liveChannel ? { liveChannel } : {}) };
}
