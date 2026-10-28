/**
 * @module @x-agent-suite/recall/driver
 * Recall registry CLI/临时 Client 接线与执行归因；不内建执行器，不跨实现 fallback。
 * 不变量：只消费 ScenarioSpec.provision；无执行级 provision 合并；每次执行独立 backend。
 */
import type {
  AgentDriver,
  DriverEvent,
  Observation,
  ScenarioSpec,
} from "@x-agent-suite/contracts";
import {
  LiveBackend,
  type LiveConfigOptions,
} from "@x-agent-suite/llm-fixture";
import type { RecallEffects } from "./effects.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import type { RecallRegistry } from "./registry.ts";
import { copyExecutionParams } from "./execution-params.ts";

function provisionAttribution(spec: ScenarioSpec): string {
  const recall = spec.metadata?.recall as { provision?: string } | undefined;
  return recall?.provision ?? "none";
}

function withExecutionMetadata(
  observation: Observation,
  spec: ScenarioSpec,
  execution: RecallResolvedExecution,
  effects: RecallEffects,
): Observation {
  const { target, mode, cliRef, clientRef } = execution;
  const provider = target.channel.provider!;
  return {
    ...observation,
    carrier: target.carrier,
    metadata: {
      ...observation.metadata,
      provider,
      model: target.channel.model,
      recallExecution: {
        target: {
          carrier: target.carrier,
          provider,
          model: target.channel.model,
        },
        mode,
        ...(target.kind === "ephemeral-client" ? { kind: target.kind } : {}),
        ...(clientRef ? { clientRef } : {}),
        ...(target.channelCarrier
          ? { channelCarrier: target.channelCarrier }
          : {}),
        ...(cliRef ? { cliRef } : {}),
        provision: provisionAttribution(spec),
        effects: effects.attribution,
      },
    },
  };
}

class AttributedRecallDriver implements AgentDriver {
  readonly redactor: AgentDriver["redactor"];

  constructor(
    private readonly driver: AgentDriver,
    private readonly spec: ScenarioSpec,
    private readonly execution: RecallResolvedExecution,
    private readonly effects: RecallEffects,
  ) {
    this.redactor = driver.redactor;
  }

  start(): Promise<void> {
    return this.driver.start();
  }

  async sendPrompt(text: string): Promise<Observation> {
    return withExecutionMetadata(
      await this.driver.sendPrompt(text),
      this.spec,
      this.execution,
      this.effects,
    );
  }

  events(): AsyncIterable<DriverEvent> {
    return this.driver.events();
  }

  close(reason?: string): Promise<void> {
    return this.driver.close(reason);
  }
}

function assertAgentDriver(driver: AgentDriver): void {
  if (
    !driver ||
    typeof driver.start !== "function" ||
    typeof driver.sendPrompt !== "function" ||
    typeof driver.events !== "function" ||
    typeof driver.close !== "function"
  ) {
    throw new Error("Recall profile.createDriver 必须返回 AgentDriver");
  }
}

/** 创建当前 case/repeat 的 Driver；调用前必须已完成全部定义与候选校验。 */
export async function createRecallDriver(
  spec: ScenarioSpec,
  options: {
    readonly execution: RecallResolvedExecution;
    readonly effects: RecallEffects;
    readonly registry: RecallRegistry;
    readonly config: LiveConfigOptions;
    readonly executionParams?: Readonly<Record<string, unknown>>;
  },
): Promise<AgentDriver> {
  const { execution, effects, registry, config } = options;
  const { target } = execution;
  // channelsFrom 的借用渠道与凭据锚定来源 Carrier；执行归因仍使用 target.carrier。
  const backend = new LiveBackend({
    carrier: target.channelCarrier ?? target.carrier,
    channel: target.channel,
    config,
    ...(registry.transport ? { transport: registry.transport } : {}),
  });
  const reference = execution.cliRef ?? execution.clientRef;
  if (!execution.profile || !reference) {
    throw new Error("Recall 注册执行实现缺失");
  }
  const driver = await execution.profile.createDriver({
    spec,
    executionParams: copyExecutionParams(options.executionParams ?? {}),
    backend,
    target,
    ...(execution.cliRef ? { cliRef: execution.cliRef } : {}),
    ...(execution.clientRef ? { clientRef: execution.clientRef } : {}),
    effects,
  });
  assertAgentDriver(driver);
  return new AttributedRecallDriver(driver, spec, execution, effects);
}
