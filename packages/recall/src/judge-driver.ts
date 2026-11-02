/**
 * @module @x-agent-suite/recall/judge-driver
 * Recall 内置 Judge 的同源独立 Driver 适配；每次 attempt 新会话并 finally 清理。
 */
import type { AgentDriver, ScenarioSpec } from "@x-agent-suite/contracts";
import {
  JudgeModelError,
  type JudgeModelClient,
  type JudgeModelRequest,
  type JudgeModelResponse,
} from "@x-agent-suite/judge";
import type { LiveConfigOptions } from "@x-agent-suite/llm-fixture";
import { createRecallDriver } from "./driver.ts";
import type { RecallEffects } from "./effects.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import type { RecallRegistry } from "./registry.ts";

const JUDGE_EFFECTS: RecallEffects = {
  kind: "none",
  attribution: "none",
  tools: "none",
  commands: { allow: [], deny: [] },
  maxSteps: 1,
  timeoutMs: 30_000,
  workspace: "isolated",
  cleanup: "required",
};

/** 创建同源 Judge model client 所需选项；创建本身不启动资源。 */
export interface CreateRecallJudgeModelClientOptions {
  readonly execution: RecallResolvedExecution;
  readonly registry: RecallRegistry;
  readonly config: LiveConfigOptions;
}

function judgeSpec(prompt: string): ScenarioSpec {
  return {
    id: "recall/judge",
    turns: [{ send: prompt }],
    metadata: {},
  };
}

function abortError(): JudgeModelError {
  return new JudgeModelError("transport", "Recall Judge 已中止");
}

function abortRace(signal: AbortSignal, onAbort: () => void) {
  let listener!: () => void;
  const promise = new Promise<never>((_resolve, reject) => {
    listener = () => {
      onAbort();
      reject(abortError());
    };
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  return {
    promise,
    dispose: () => signal.removeEventListener("abort", listener),
  };
}

function closeLateDriver(driver: AgentDriver): void {
  void driver.close("recall judge cancelled late driver").catch(() => {
    console.error("Recall Judge 迟到 Driver 清理失败");
  });
}

async function runDriver(
  driver: AgentDriver,
  request: JudgeModelRequest,
): Promise<JudgeModelResponse> {
  await driver.start();
  if (request.signal.aborted) throw abortError();
  const observation = await driver.sendPrompt(request.prompt);
  if (observation.toolCallsCount > 0 || observation.toolCalls.length > 0) {
    throw new JudgeModelError("protocol", "Recall Judge 不得返回工具调用");
  }
  return { text: observation.text };
}

async function complete(
  options: CreateRecallJudgeModelClientOptions,
  request: JudgeModelRequest,
): Promise<JudgeModelResponse> {
  if (request.signal.aborted) throw abortError();
  let driver: AgentDriver | undefined;
  let cancelled = false;
  const aborted = abortRace(request.signal, () => {
    cancelled = true;
  });
  try {
    const creating = createRecallDriver(judgeSpec(request.prompt), {
      execution: options.execution,
      effects: JUDGE_EFFECTS,
      registry: options.registry,
      config: options.config,
      executionParams: {},
    });
    const tracked = creating.then((created) => {
      if (cancelled) closeLateDriver(created);
      else driver = created;
      return created;
    });
    driver = await Promise.race([tracked, aborted.promise]);
    return await Promise.race([runDriver(driver, request), aborted.promise]);
  } catch (cause) {
    if (cause instanceof JudgeModelError) throw cause;
    throw new JudgeModelError("client", "Recall Judge 客户端调用失败", {
      cause,
    });
  } finally {
    aborted.dispose();
    if (driver) {
      try {
        await driver.close("recall judge attempt complete");
      } catch (cause) {
        throw new JudgeModelError("cleanup", "Recall Judge 清理失败", {
          cause,
        });
      }
    }
  }
}

/** 创建 Recall 私有 Judge client；不建立第二套裁定、解析或重试协议。 */
export function createRecallJudgeModelClient(
  options: CreateRecallJudgeModelClientOptions,
): JudgeModelClient {
  return { complete: (request) => complete(options, request) };
}
