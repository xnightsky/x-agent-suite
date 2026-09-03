/**
 * @module @x-agent-suite/harness/live-config-hooks
 * 把宿主 CLI 配置/凭证借用能力注册为 llm-fixture 的 live-config 钩子。
 * 不变量：本模块是 harness 包与 llm-fixture 包之间的适配层，通用 live-config 不依赖本模块。
 */
import type {
  BorrowedChannelResult,
  BorrowedCredentialResult,
  LiveConfigOptions,
} from "@x-agent-suite/llm-fixture";
import {
  resolveHarnessChannel,
  type HarnessChannelResult,
} from "./harness-config.ts";
import {
  resolveHarnessCredential,
  type HarnessCredential,
} from "./harness-credentials.ts";

/** 构造 LiveConfigOptions 的 borrowChannel / borrowCredential 钩子（用于 from: harness / credential: harness）。 */
export function createHarnessLiveConfigHooks(
  homeDir?: string,
): Pick<LiveConfigOptions, "borrowChannel" | "borrowCredential"> {
  return {
    borrowChannel: async (
      carrier: string,
      home: string,
    ): Promise<BorrowedChannelResult> => {
      const result: HarnessChannelResult = await resolveHarnessChannel(
        carrier,
        { homeDir: homeDir ?? home },
      );
      if (result.kind !== "resolved") {
        return { kind: "missing", reason: result.reason };
      }
      const { channel } = result;
      return {
        kind: "resolved",
        wire: channel.wire,
        baseUrl: channel.baseUrl,
        ...(channel.model !== undefined ? { model: channel.model } : {}),
        ...(channel.provider !== undefined
          ? { provider: channel.provider }
          : {}),
        ...(channel.harnessBaseUrl !== undefined
          ? { harnessBaseUrl: channel.harnessBaseUrl }
          : {}),
        source: channel.source,
      };
    },
    borrowCredential: async (
      carrier: string,
      options: {
        readonly homeDir: string;
        readonly env: NodeJS.ProcessEnv;
        readonly now: number;
        readonly provider?: string;
      },
    ): Promise<BorrowedCredentialResult> => {
      const result: HarnessCredential = await resolveHarnessCredential(
        carrier,
        {
          homeDir: homeDir ?? options.homeDir,
          now: options.now,
          provider: options.provider,
        },
      );
      if (result.kind !== "resolved") {
        return { kind: "missing", reason: result.reason };
      }
      return {
        kind: "resolved",
        apiKey: result.apiKey,
        source: result.source,
        ...(result.expiresAt !== undefined
          ? { expiresAt: result.expiresAt }
          : {}),
      };
    },
  };
}
