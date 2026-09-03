/**
 * @module @x-agent-suite/llm-fixture/factory
 * createLlmBackend 工厂：按模式选择 LlmBackend 实现。
 * 不变量：fixture（FakeProviderBackend）为默认；live 必须带 carrier 声明。
 */
import type {
  FixtureProviderOptions,
  LlmBackend,
} from "@x-agent-suite/contracts";
import { FakeProviderBackend } from "./fake-provider.ts";
import { LiveBackend, type LiveBackendOptions } from "./live.ts";

/** live 模式的工厂选项（即 LiveBackendOptions，carrier 必填）。 */
export type LiveFactoryOptions = LiveBackendOptions;

/**
 * 按模式创建 LlmBackend。
 *
 * @behavior create-llm-backend
 * Given: mode 来自运行配置（缺省 "fixture"）。
 * When: mode === "fixture"。
 * Then: 返回 FakeProviderBackend；mode === "live" 且带 carrier 时返回 LiveBackend。
 * Failure: 未知模式显式抛错；live 缺 carrier 显式抛错。
 */
export function createLlmBackend(
  mode: string,
  options: FixtureProviderOptions | LiveFactoryOptions,
): LlmBackend {
  if (mode === "live") {
    if (!("carrier" in options) || !options.carrier) {
      throw new Error("live 模式必须提供 carrier（私密配置区的声明主体）");
    }
    return new LiveBackend(options);
  }
  if (mode !== "fixture") {
    throw new Error(
      `不支持的 LlmBackend 模式 "${mode}"（可用: fixture / live）`,
    );
  }
  return new FakeProviderBackend(options as FixtureProviderOptions);
}
