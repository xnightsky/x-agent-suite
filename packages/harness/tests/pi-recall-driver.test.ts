/**
 * @module harness/tests/pi-recall-driver
 * Pi Recall Driver 回归：用合成子进程验证启动参数、思考投影、原生事件证据与清理。
 * 不变量：零真实网络、零 token、不读取也不写入真实宿主 HOME。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ScenarioSpec } from "@x-agent-suite/contracts";
import { createPiRecallDriver } from "../../../profiles/pi-recall.ts";
import {
  HOST_SETTINGS,
  driverContext,
  probeOf,
  withDriver,
} from "./fixtures/pi-recall-fake.ts";

test("read-only：干净启动参数、原生只读工具、路径与预算守卫、隔离配置投影", async () => {
  await withDriver({ tools: "read-only", maxSteps: 2 }, async (driver) => {
    const observation = await driver.sendPrompt("hello");
    const probe = probeOf(observation);

    for (const flag of [
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-extensions",
      "--no-mcp",
      "--no-prompt-templates",
    ]) {
      assert.ok(probe.argv.includes(flag), "缺少干净启动参数 " + flag);
    }
    assert.equal(
      probe.argv[probe.argv.indexOf("--tools") + 1],
      "read,grep,find,ls",
    );
    assert.ok(!probe.argv.includes("--no-tools"));
    assert.equal(probe.argv[probe.argv.length - 1], "hello");

    assert.ok(probe.home, "沙箱 HOME 必须存在");
    assert.ok(probe.guard, "必须写入只读守卫扩展");
    const guard = probe.guard ?? "";
    assert.match(guard, /只读白名单/);
    assert.match(guard, /隔离工作区/);
    assert.ok(
      guard.includes(JSON.stringify(probe.cwd)),
      "守卫根必须是隔离工作区",
    );
    assert.match(guard, /turnIndex >= 1/);
    assert.equal(
      probe.argv[probe.argv.indexOf("--extension") + 1],
      join(probe.home ?? "", "piHome", "pi-recall-guard.ts"),
    );

    assert.notEqual(probe.cwd, process.cwd());
    assert.notEqual(probe.home, homedir());
    assert.notEqual(probe.cwd, probe.home);
    assert.equal(probe.secret, null, "子进程不得继承未声明的环境变量");
    assert.equal(probe.hostMarker, null, "子进程不得继承宿主会话目录");

    assert.ok(probe.agentDirFiles.includes("settings.json"));
    assert.ok(
      !probe.agentDirFiles.includes("mcp.json"),
      "不得注入 reference MCP",
    );
    assert.equal(probe.settings?.packages, undefined);
    assert.equal(probe.settings?.secret, undefined);
    assert.equal(probe.settings?.defaultProvider, "native");
    assert.equal(probe.settings?.defaultModel, "native-model");
    assert.equal(probe.settings?.defaultThinkingLevel, "high");
    assert.deepEqual(probe.settings?.thinkingBudgets, { high: 4096 });

    assert.deepEqual(observation.usage, {
      promptTokens: 14,
      completionTokens: 5,
      totalTokens: 19,
    });
    assert.equal(observation.steps, 1);
    assert.equal(observation.toolCalls.length, 1);
    assert.equal(observation.toolCalls[0]?.status, "completed");
    assert.equal(observation.metadata?.nativeCompleted, true);
    assert.equal(observation.metadata?.workspaceCwd, probe.cwd);
    // 工具策略归因由外层 recallExecution.effects 提供，driver 不再重复记录。
    assert.equal(observation.metadata?.nativeToolPolicy, undefined);
  });
});

test("tools=none：只下发 --no-tools，不声明 --tools", async () => {
  await withDriver({ tools: "none" }, async (driver) => {
    const probe = probeOf(await driver.sendPrompt("hello"));
    assert.ok(probe.argv.includes("--no-tools"));
    assert.ok(!probe.argv.includes("--tools"));
    assert.ok(probe.guard);
  });
});

test("显式 thinkingLevel 只覆盖隔离配置，宿主配置保持原样", async () => {
  await withDriver(
    { executionParams: { thinkingLevel: "low" } },
    async (driver, setup) => {
      const probe = probeOf(await driver.sendPrompt("hello"));
      assert.equal(probe.settings?.defaultThinkingLevel, "low");
      const host = JSON.parse(
        await readFile(join(setup.hostDir, "settings.json"), "utf8"),
      ) as unknown;
      assert.deepEqual(host, HOST_SETTINGS);
    },
  );
});

test("tools=allowlist：落到本 Adapter 固定的原生只读工具集", async () => {
  await withDriver({ tools: "allowlist" }, async (driver) => {
    const probe = probeOf(await driver.sendPrompt("hello"));
    assert.equal(
      probe.argv[probe.argv.indexOf("--tools") + 1],
      "read,grep,find,ls",
    );
    assert.ok(!probe.argv.includes("--no-tools"));
    assert.match(probe.guard ?? "", /只读白名单/);
  });
});

test("多轮场景在工厂阶段就拒绝，不产生任何执行", () => {
  const multiTurn: ScenarioSpec = {
    id: "pi-recall/multi",
    turns: [{ send: "a" }, { send: "b" }],
  };
  assert.throws(
    () => createPiRecallDriver({ ...driverContext({}), spec: multiTurn }),
    /单轮|多轮/,
  );
});

test("appendSystemPrompt 只透传为 --append-system-prompt，prompt 前以 -- 终止选项解析", async () => {
  const appended = "consumer trusted rules";
  await withDriver({ appendSystemPrompt: appended }, async (driver) => {
    const probe = probeOf(await driver.sendPrompt("hello"));
    assert.equal(
      probe.argv[probe.argv.indexOf("--append-system-prompt") + 1],
      appended,
    );
    assert.equal(probe.argv[probe.argv.length - 2], "--");
    assert.equal(probe.argv[probe.argv.length - 1], "hello");
  });
  await withDriver({}, async (driver) => {
    const probe = probeOf(await driver.sendPrompt("hello"));
    assert.ok(!probe.argv.includes("--append-system-prompt"));
    assert.equal(probe.argv[probe.argv.length - 2], "--");
  });
  assert.throws(
    () => createPiRecallDriver(driverContext({}), { appendSystemPrompt: "" }),
    /appendSystemPrompt/,
  );
});

test("无法兑现的命令门禁与执行参数显式拒绝", () => {
  assert.throws(
    () =>
      createPiRecallDriver(
        driverContext({ commands: { allow: ["cat file"], deny: [] } }),
      ),
    /命令/,
  );
  assert.throws(
    () =>
      createPiRecallDriver(
        driverContext({ executionParams: { model: "other-model" } }),
      ),
    /thinkingLevel/,
  );
});

test("原生 provider 错误与截断显式拒绝，不以退出码冒充成功", async () => {
  await withDriver({}, async (driver) => {
    await assert.rejects(
      driver.sendPrompt("__PROVIDER_ERROR__"),
      /synthetic provider failure/,
    );
  });
  await withDriver({}, async (driver) => {
    await assert.rejects(driver.sendPrompt("__TRUNCATED__"), /截断/);
  });
});

test("缺原生完成信号与原生事件不闭合显式拒绝", async () => {
  await withDriver({}, async (driver) => {
    await assert.rejects(driver.sendPrompt("__NO_AGENT_END__"), /完成信号/);
  });
  await withDriver({}, async (driver) => {
    await assert.rejects(driver.sendPrompt("__TOOL_START_ONLY__"), /工具调用/);
  });
});

test("未上报 usage 时不编造用量", async () => {
  await withDriver({}, async (driver) => {
    const observation = await driver.sendPrompt("__NO_USAGE__");
    assert.equal(observation.usage, undefined);
    assert.deepEqual(observation.metadata?.nativeUsage, {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    });
  });
});

test("工具失败状态只认原生事件", async () => {
  await withDriver({}, async (driver) => {
    const observation = await driver.sendPrompt("__TOOL_FAILED__");
    assert.equal(observation.toolCalls[0]?.status, "failed");
  });
});

test("步数预算命中时保留原生中断证据", async () => {
  await withDriver({}, async (driver) => {
    const observation = await driver.sendPrompt("__BUDGET_ABORT__");
    assert.equal(observation.exhausted, true);
    // 预算中断只经 exhausted 表达，不再重复写 nativeAborted。
    assert.equal(observation.metadata?.nativeAborted, undefined);
  });
});

test("headless 一次性进程：第二次 sendPrompt 显式拒绝而不丢上下文", async () => {
  await withDriver({}, async (driver) => {
    await driver.sendPrompt("first");
    await assert.rejects(driver.sendPrompt("second"), /多轮|一次性/);
  });
});

test("close 清理隔离 HOME 与工作区，且重复调用幂等", async () => {
  let home = "";
  let cwd = "";
  await withDriver({}, async (driver) => {
    const probe = probeOf(await driver.sendPrompt("hello"));
    home = probe.home ?? "";
    cwd = probe.cwd;
    assert.equal(existsSync(home), true);
    assert.equal(existsSync(cwd), true);
    await driver.close("显式关闭");
    assert.equal(existsSync(home), false);
    assert.equal(existsSync(cwd), false);
    await driver.close("重复关闭");
  });
  assert.equal(existsSync(home), false);
});

test("清理失败必须冒泡使用例失败，且宿主 env 与临时目录仍恢复", async () => {
  const before = process.env.PI_CODING_AGENT_DIR;
  let hostDir = "";
  await assert.rejects(
    withDriver({}, async (driver, setup) => {
      hostDir = setup.hostDir;
      // 先真实收尾沙箱，再把 close 换成失败桩：收尾错误必须冒泡，不能静默吞掉。
      const close = driver.close.bind(driver);
      await close();
      driver.close = async () => {
        throw new Error("synthetic close failure");
      };
    }),
    /synthetic close failure/,
  );
  assert.equal(process.env.PI_CODING_AGENT_DIR, before);
  assert.equal(existsSync(hostDir), false);
});
