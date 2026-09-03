/**
 * @module @x-agent-suite/harness/tests/harness-driver
 * 一次性 harness driver 的启动失败与清理聚合回归测试。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { inspect } from "node:util";
import type {
  HarnessProfile,
  LlmBackend,
  SandboxContext,
} from "@x-agent-suite/contracts";
import { createHarnessDriver } from "../src/driver.ts";

function makeBackend(stop: () => Promise<void>): LlmBackend {
  return {
    mode: "fixture",
    start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop,
  };
}

function makeProfile(
  writeConfig: (sandbox: SandboxContext) => Promise<void>,
): HarnessProfile {
  return {
    name: "generic",
    command: process.execPath,
    wire: "openai-chat",
    headlessArgs: () => [],
    baseUrlEnv: "",
    stripEnv: [],
    toolName: (_server, tool) => tool,
    writeConfig,
    createParser: () => () => null,
    supportsFixture: true,
  };
}

test("HarnessDriver：writeConfig 失败时清理已创建沙箱并停止 backend", async () => {
  let sandboxPath = "";
  let stopCalls = 0;
  const driver = createHarnessDriver(
    makeProfile(async (sandbox) => {
      sandboxPath = sandbox.homeDir;
      throw new Error("config boom");
    }),
    makeBackend(async () => {
      stopCalls += 1;
    }),
    {
      serverEntry: process.execPath,
      commandOverride: { command: process.execPath, argsPrefix: [] },
    },
  );

  await assert.rejects(driver.start(), /config boom/);
  assert.equal(stopCalls, 1);
  assert.ok(sandboxPath);
  assert.equal(existsSync(sandboxPath), false);
});

test("HarnessDriver：异常、cause、事件、Observation 与 stderr 均应用 backend redactor", async () => {
  const secret = "synthetic-driver-secret";
  const redactor = (text: string) => text.replaceAll(secret, "[REDACTED]");
  const backend: LlmBackend = {
    mode: "fixture",
    redactor,
    start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
    stop: async () => {},
  };
  const failing = createHarnessDriver(
    makeProfile(async () => {
      throw new AggregateError(
        [new Error(`nested=${secret}`)],
        `config=${secret}`,
        { cause: new Error(`cause=${secret}`) },
      );
    }),
    backend,
    {
      serverEntry: process.execPath,
      commandOverride: { command: process.execPath, argsPrefix: [] },
    },
  );
  await assert.rejects(failing.start(), (error: unknown) => {
    const diagnostic = inspect(error, { depth: 10 });
    assert.doesNotMatch(diagnostic, new RegExp(secret));
    assert.match(diagnostic, /\[REDACTED\]/);
    return true;
  });

  let parserInput: unknown;
  const profile: HarnessProfile = {
    ...makeProfile(async () => {}),
    headlessArgs: () => [
      "-e",
      `process.stderr.write('${secret}'); process.stdout.write(${JSON.stringify(`${JSON.stringify({ secret })}\n`)})`,
    ],
    createParser: () => (line) => {
      parserInput = line;
      return {
        type: "text",
        payload: { text: secret, nested: { secret } },
      };
    },
  };
  const driver = createHarnessDriver(profile, backend, {
    serverEntry: process.execPath,
    commandOverride: { command: process.execPath, argsPrefix: [] },
  });
  await driver.start();
  try {
    const observation = await driver.sendPrompt("ignored");
    const events: unknown[] = [];
    for await (const event of driver.events()) events.push(event);
    const diagnostic = JSON.stringify({ observation, events, parserInput });
    assert.doesNotMatch(diagnostic, new RegExp(secret));
    assert.doesNotMatch(driver.stderrTail(), new RegExp(secret));
  } finally {
    await driver.close();
  }
});

test("HarnessDriver：backend.stop 失败时仍清理 sandbox，并脱敏关闭错误", async () => {
  const secret = "synthetic-close-secret";
  const backend: LlmBackend = {
    ...makeBackend(async () => {
      throw new Error(`stop=${secret}`);
    }),
    redactor: (text) => text.replaceAll(secret, "[REDACTED]"),
  };
  const driver = createHarnessDriver(
    makeProfile(async () => {}),
    backend,
    {
      serverEntry: process.execPath,
      commandOverride: { command: process.execPath, argsPrefix: [] },
    },
  );
  await driver.start();
  const sandboxPath = driver.sandbox.homeDir;
  await assert.rejects(driver.close(), (error: unknown) => {
    const diagnostic = inspect(error, { depth: 10 });
    assert.doesNotMatch(diagnostic, new RegExp(secret));
    assert.match(diagnostic, /\[REDACTED\]/);
    return true;
  });
  assert.equal(existsSync(sandboxPath), false);
});

test("HarnessDriver：parser 单行产出的多个事件全部进入 Observation", async () => {
  const profile: HarnessProfile = {
    ...makeProfile(async () => {}),
    headlessArgs: () => ["-e", "process.stdout.write('{}\\n')"],
    createParser: () => () => [
      {
        type: "tool_call",
        payload: { name: "one", input: {}, status: "completed" },
      },
      {
        type: "tool_call",
        payload: { name: "two", input: {}, status: "failed" },
      },
    ],
  };
  const driver = createHarnessDriver(
    profile,
    makeBackend(async () => {}),
    {
      serverEntry: process.execPath,
      commandOverride: { command: process.execPath, argsPrefix: [] },
    },
  );
  await driver.start();
  try {
    const observation = await driver.sendPrompt("ignored");
    assert.deepEqual(
      observation.toolCalls.map((call) => call.name),
      ["one", "two"],
    );
    assert.equal(observation.toolCallsCount, 2);
  } finally {
    await driver.close();
  }
});
