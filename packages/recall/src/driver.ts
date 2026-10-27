/**
 * @module @x-agent-suite/recall/driver
 * Recall direct 纯文本 Driver、registry borrowed 接线与执行归因。
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
  type LiveMessage,
} from "@x-agent-suite/llm-fixture";
import type { RecallEffects } from "./effects.ts";
import type { RecallResolvedExecution } from "./execution.ts";
import type { RecallRegistry } from "./registry.ts";

class DirectRecallDriver implements AgentDriver {
  readonly redactor: AgentDriver["redactor"];

  private readonly messages: LiveMessage[] = [];
  private readonly log: DriverEvent[] = [];
  private started = false;
  private closed = false;

  constructor(private readonly backend: LiveBackend) {
    this.redactor = backend.redactor;
  }

  async start(): Promise<void> {
    if (this.started || this.closed)
      throw new Error("direct Recall Driver: 重复 start");
    await this.backend.start();
    this.started = true;
  }

  async sendPrompt(text: string): Promise<Observation> {
    if (!this.started || this.closed) {
      throw new Error("direct Recall Driver: 未 start 或已 close");
    }
    this.messages.push({ role: "user", text });
    const completion = await this.backend.complete({ messages: this.messages });
    if (completion.toolCalls.length > 0) {
      throw new Error("direct Recall 纯文本 Driver 不得返回工具调用");
    }
    this.messages.push({ role: "assistant", text: completion.text });
    const events: DriverEvent[] = [
      { type: "prompt", timestamp: Date.now(), payload: { text } },
      {
        type: "text",
        timestamp: Date.now(),
        payload: { text: completion.text },
      },
    ];
    this.log.push(...events);
    return {
      text: completion.text,
      toolCalls: [],
      toolCallsCount: 0,
      steps: 1,
      events,
    };
  }

  async *events(): AsyncIterable<DriverEvent> {
    for (const event of this.log) yield event;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.backend.stop();
  }
}

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
  const { target, mode, cliRef } = execution;
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
  },
): Promise<AgentDriver> {
  const { execution, effects, registry, config } = options;
  const { target } = execution;
  const backend = new LiveBackend({
    carrier: target.carrier,
    channel: target.channel,
    config,
    ...(registry.transport ? { transport: registry.transport } : {}),
  });
  let driver: AgentDriver;
  if (execution.mode === "direct") {
    if (effects.kind !== "none" || spec.provision !== undefined) {
      throw new Error(
        "direct Recall 纯文本只支持 effects:none 且无场景 provision",
      );
    }
    driver = new DirectRecallDriver(backend);
  } else {
    if (!execution.profile || !execution.cliRef) {
      throw new Error("borrowed Recall 缺唯一注册 profile");
    }
    driver = await execution.profile.createDriver({
      spec,
      backend,
      target,
      cliRef: execution.cliRef,
      effects,
    });
  }
  assertAgentDriver(driver);
  return new AttributedRecallDriver(driver, spec, execution, effects);
}
