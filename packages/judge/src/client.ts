/**
 * @module @x-agent-suite/judge/client
 * Judge 客户端创建、TargetTags 候选选择与 direct/borrowed 生命周期。
 * 不变量：仅唯一候选可创建；不按工厂字段猜选，不跨 mode fallback；
 * live 未放行、read-only 非 borrowed 与遗留 allowedModes 均在执行前拒绝。
 */
import type { AgentDriver } from "@x-agent-suite/contracts";
import {
  decideLiveTarget,
  LiveBackend,
  LiveHttpError,
  LiveNotConfiguredError,
  TargetTagDefinitionError,
  type TargetAccessDecisionOptions,
  type TargetModeEvaluation,
  type TargetTagRequirement,
} from "@x-agent-suite/llm-fixture";
import {
  JudgeDefinitionError,
  JudgeModelError,
  type BorrowedJudgeClientOptions,
  type CreateJudgeClientOptions,
  type DirectJudgeClientOptions,
  type JudgeClient,
  type JudgeModelRequest,
  type JudgeModelResponse,
  type JudgeMode,
  type JudgeToolPolicy,
} from "./types.ts";

const DIRECT_REQUIREMENTS: TargetTagRequirement = {
  allOf: ["provider-model.api.complete", "model.inference.chat"],
  anyOf: [
    [
      "provider-model.usage.api-payg",
      "provider-model.usage.api-credit",
      "provider-model.usage.api-free",
    ],
  ],
};

function judgeRequirements(
  toolPolicy: JudgeToolPolicy,
): TargetAccessDecisionOptions["requirements"] {
  return {
    direct: DIRECT_REQUIREMENTS,
    borrowed: {
      allOf: [
        "cli.execution.one-shot",
        "cli.execution.unattended",
        "cli.session.ephemeral",
        "cli.context.context-files.off",
        "cli.context.extensions.off",
        "cli.context.skills.off",
        "model.inference.chat",
        ...(toolPolicy === "none"
          ? ["cli.tools.none"]
          : ["cli.tools.allowlist", "cli.tools.read-only"]),
      ],
      anyOf: [
        [
          "provider-model.usage.cli-subscription",
          "provider-model.usage.ci-subscription",
          "provider-model.usage.third-party-subscription",
          "provider-model.usage.cli-free",
        ],
        ["cli.io.text", "cli.io.jsonl"],
      ],
    },
  };
}

function validateOptions(options: CreateJudgeClientOptions): JudgeToolPolicy {
  if (!options || !options.target) {
    throw new JudgeDefinitionError("Judge target 必填");
  }
  if ("allowedModes" in options) {
    throw new JudgeDefinitionError(
      "allowedModes 已移除，请使用 TargetTags 决策",
    );
  }
  if (!options.tags) {
    throw new JudgeDefinitionError("Judge TargetTagCatalog 必填");
  }
  if (
    options.mode !== undefined &&
    options.mode !== "direct" &&
    options.mode !== "borrowed"
  ) {
    throw new JudgeDefinitionError("Judge mode 必须是 direct 或 borrowed");
  }
  const toolPolicy = options.toolPolicy ?? "none";
  if (toolPolicy !== "none" && toolPolicy !== "read-only") {
    throw new JudgeDefinitionError("Judge toolPolicy 必须是 none 或 read-only");
  }
  if (options.cliRef !== undefined && options.cliRef.trim() === "") {
    throw new JudgeDefinitionError("Judge cliRef 不得为空");
  }
  return toolPolicy;
}

function selectCandidate(
  options: CreateJudgeClientOptions,
  toolPolicy: JudgeToolPolicy,
): TargetModeEvaluation {
  let decision: ReturnType<typeof decideLiveTarget>;
  try {
    decision = decideLiveTarget(options.target, options.tags, {
      requirements: judgeRequirements(toolPolicy),
      live: true,
      liveReviewApproved: options.liveReviewApproved ?? false,
    });
  } catch (error) {
    if (error instanceof TargetTagDefinitionError) {
      throw new JudgeDefinitionError(error.message);
    }
    throw error;
  }
  const candidates = decision.candidates.filter(
    (candidate) =>
      (toolPolicy === "none" || candidate.mode === "borrowed") &&
      (!options.mode || candidate.mode === options.mode) &&
      (!options.cliRef || candidate.cliRef === options.cliRef),
  );
  if (candidates.length === 0) {
    const details = JSON.stringify({
      live: decision.live.status,
      evaluations: decision.evaluations.map((evaluation) => ({
        mode: evaluation.mode,
        cliRef: evaluation.cliRef,
        missingGroups: evaluation.missingGroups,
        issues: evaluation.issues,
      })),
    });
    throw new JudgeDefinitionError(
      "Judge 无满足 TargetTags/toolPolicy/live/mode/cliRef 的候选：" + details,
    );
  }
  if (candidates.length > 1) {
    throw new JudgeDefinitionError("Judge 候选不唯一，请显式指定 mode/cliRef");
  }
  return candidates[0]!;
}

/** 每个 attempt 创建独立 backend，避免复用失败会话状态。 */
function createBackend(options: JudgeClientBaseOptionsForFactory): LiveBackend {
  return new LiveBackend({
    carrier: options.target.carrier,
    channel: options.target.channel,
    config: options.config,
    ...("transport" in options ? { transport: options.transport } : {}),
  });
}

type JudgeClientBaseOptionsForFactory = CreateJudgeClientOptions;

/** 将 live 生命周期异常映射到 Judge 失败类别。 */
function asModelError(error: unknown): JudgeModelError {
  if (error instanceof JudgeModelError) return error;
  if (error instanceof LiveNotConfiguredError) {
    return new JudgeModelError("not-configured", error.message, {
      cause: error,
    });
  }
  if (error instanceof LiveHttpError) {
    const kind =
      error.status === 429
        ? "rate-limited"
        : error.status >= 500
          ? "transport"
          : "client";
    return new JudgeModelError(kind, error.message, { cause: error });
  }
  if (error instanceof TypeError) {
    return new JudgeModelError("transport", error.message, { cause: error });
  }
  const message =
    error instanceof Error ? error.message : "Judge 客户端调用失败";
  return new JudgeModelError("client", message, { cause: error });
}

/** direct：单 user message、无 tools、signal 直达 LiveBackend。 */
async function completeDirect(
  options: DirectJudgeClientOptions,
  request: JudgeModelRequest,
): Promise<JudgeModelResponse> {
  const backend = createBackend(options);
  try {
    await backend.start();
    const completion = await backend.complete({
      messages: [{ role: "user", text: request.prompt }],
      signal: request.signal,
    });
    if (completion.toolCalls.length > 0) {
      throw new JudgeModelError("protocol", "direct Judge 不得返回工具调用");
    }
    return { text: completion.text };
  } catch (error) {
    throw asModelError(error);
  } finally {
    try {
      await backend.stop();
    } catch (error) {
      throw new JudgeModelError("cleanup", "direct Judge 清理失败", {
        cause: error,
      });
    }
  }
}

/** 构造 abort 竞争 Promise，并返回监听器清理函数。 */
function abortRace(signal: AbortSignal): {
  promise: Promise<never>;
  dispose: () => void;
} {
  let listener: () => void;
  const promise = new Promise<never>((_resolve, reject) => {
    listener = () =>
      reject(new JudgeModelError("transport", "borrowed Judge 已中止"));
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  return {
    promise,
    dispose: () => signal.removeEventListener("abort", listener),
  };
}

/** borrowed：单次 sendPrompt，任何路径都 close；none 拒绝工具，read-only 保留证据。 */
async function completeBorrowed(
  options: BorrowedJudgeClientOptions,
  request: JudgeModelRequest,
): Promise<JudgeModelResponse> {
  const backend = createBackend(options);
  const driver: AgentDriver = options.createDriver({
    target: options.target,
    backend,
    cliRef: options.cliRef,
    toolPolicy: options.toolPolicy ?? "none",
  });
  const aborted = abortRace(request.signal);
  try {
    const operation = (async () => {
      await driver.start();
      const observation = await driver.sendPrompt(request.prompt);
      if (
        (options.toolPolicy ?? "none") === "none" &&
        (observation.toolCallsCount > 0 || observation.toolCalls.length > 0)
      ) {
        throw new JudgeModelError(
          "protocol",
          "borrowed Judge 不得返回工具调用",
        );
      }
      return { text: observation.text };
    })();
    return await Promise.race([operation, aborted.promise]);
  } catch (error) {
    throw asModelError(error);
  } finally {
    aborted.dispose();
    try {
      await driver.close("judge attempt complete");
    } catch (error) {
      throw new JudgeModelError("cleanup", "borrowed Judge 清理失败", {
        cause: error,
      });
    }
  }
}

/** 以 TargetTags 唯一候选创建客户端；任何失败都不跨 mode fallback。 */
export function createJudgeClient(
  options: CreateJudgeClientOptions,
): JudgeClient {
  const toolPolicy = validateOptions(options);
  const selected = selectCandidate(options, toolPolicy);
  if (
    selected.mode === "borrowed" &&
    (!("createDriver" in options) || typeof options.createDriver !== "function")
  ) {
    throw new JudgeDefinitionError("borrowed Judge 必须提供 createDriver");
  }
  const mode: JudgeMode = selected.mode;
  const selectedOptions = {
    ...options,
    cliRef: selected.cliRef,
  } as CreateJudgeClientOptions;
  return {
    mode,
    target: options.target,
    cliRef: selected.cliRef,
    complete: (request) =>
      mode === "direct"
        ? completeDirect(selectedOptions as DirectJudgeClientOptions, request)
        : completeBorrowed(
            selectedOptions as BorrowedJudgeClientOptions,
            request,
          ),
  };
}
