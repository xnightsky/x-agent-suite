/**
 * @module @x-agent-suite/contracts/tests/contracts
 * 最小类型测试：验证核心泛型与注册表函数类型可正常编译/赋值。
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  AgentDriver,
  Criterion,
  DriverRegistration,
  InboundEvent,
  Observation,
  RegisterDriver,
  ScenarioResult,
  ScenarioSpec,
} from "../src/index.ts";

describe("@x-agent-suite/contracts", () => {
  it("ScenarioResult 接受自定义 artifact 类型", () => {
    type CustomArtifact = { readonly logs: readonly string[] };

    const observation: Observation = {
      text: "ok",
      toolCalls: [],
      toolCallsCount: 0,
      events: [],
    };

    const result: ScenarioResult<CustomArtifact> = {
      observation,
      artifact: { logs: ["x"] },
      dryPass: true,
      hardPass: true,
      fuzzyPass: true,
      latencyMs: 0,
    };

    assert.strictEqual(result.artifact.logs[0], "x");
  });

  it("注册表函数类型可赋值", () => {
    const registerDriver: RegisterDriver = (_driver) => {
      // 类型测试占位，无需真实注册逻辑。
    };
    assert.strictEqual(typeof registerDriver, "function");
  });

  it("AgentDriver 与 Criterion 的联合类型不冲突", () => {
    // 仅验证类型系统允许同时持有 driver 与 criterion。
    const driver: AgentDriver = {
      start: async () => {},
      sendPrompt: async () =>
        ({
          text: "hi",
          toolCalls: [],
          toolCallsCount: 0,
          events: [],
        }) as Observation,
      events: async function* () {},
      close: async () => {},
    };

    const criterion: Criterion = {
      name: "dummy",
      scope: "session",
      evaluate: async () => ({ pass: true, score: 1, reason: "ok" }),
    };

    assert.strictEqual(typeof driver.start, "function");
    assert.strictEqual(criterion.scope, "session");
  });

  it("DriverRegistration 判别联合：长驻三件套要么齐全要么全无", () => {
    const observation = {
      text: "ok",
      toolCalls: [],
      toolCallsCount: 0,
      events: [],
    } as Observation;
    const base = {
      id: "d1",
      start: async () => {},
      sendPrompt: async () => observation,
      events: async function* () {},
      close: async () => {},
    };

    // 一次性注册：不声明长驻三件套，合法。
    const oneShot: DriverRegistration = { ...base };
    assert.strictEqual(oneShot.id, "d1");

    // 长驻注册：injectMode + inject/inbound/waitInbound 齐全，合法。
    const longLived: DriverRegistration = {
      ...base,
      injectMode: "followUp",
      inject: async () => observation,
      inbound: async function* () {},
      waitInbound: async () =>
        ({ kind: "notification", timestamp: 0, payload: null }) as InboundEvent,
    };
    assert.strictEqual(longLived.injectMode, "followUp");

    // 半套声明：只声明 injectMode 缺三件套，类型层必须拒绝。
    // @ts-expect-error 声明 injectMode 必须同时实现 inject/inbound/waitInbound
    const broken: DriverRegistration = { ...base, injectMode: "followUp" };
    assert.strictEqual(broken.id, "d1");
  });

  it("ScenarioSpec 满足最小字段约束", () => {
    const spec: ScenarioSpec = {
      id: "demo/hello",
      turns: [{ send: "hello" }],
    };
    assert.strictEqual(spec.id, "demo/hello");
    assert.strictEqual(spec.turns.length, 1);
  });
});
