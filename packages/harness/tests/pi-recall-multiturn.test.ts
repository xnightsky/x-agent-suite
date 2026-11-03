/**
 * @module harness/tests/pi-recall-multiturn
 * Pi Recall 原生多轮回归：真实恢复 fake CLI session，并验证逐轮证据与完整清理。
 * 不变量：零网络、零 token；历史只由 fake 宿主经 session-id/session-dir 落盘和恢复。
 */
import assert from "node:assert/strict";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { JsonlProcess } from "@x-agent-suite/driver";
import {
  probeOf,
  readProbes,
  type Probe,
  waitForProbes,
  withDriver,
} from "./fixtures/pi-recall-fake.ts";

function sessionFileOf(probe: Probe): string {
  assert.ok(probe.sessionId);
  assert.ok(probe.sessionDir);
  return join(probe.sessionDir, probe.sessionId + ".jsonl");
}

function assertSandboxRemoved(probe: Probe): void {
  assert.ok(probe.home);
  assert.ok(probe.sessionDir);
  for (const path of [probe.home, probe.cwd, probe.sessionDir]) {
    assert.equal(existsSync(path), false, "资源未清理：" + path);
  }
}

test("多轮：原生 session 恢复且逐轮 observation、tool evidence 与 usage 隔离", async () => {
  const firstPrompt = "第一轮记号 731942";
  await withDriver({ turns: [firstPrompt, "第二轮"] }, async (driver) => {
    const first = await driver.sendPrompt(firstPrompt);
    const second = await driver.sendPrompt("第二轮");
    const firstProbe = probeOf(first);
    const secondProbe = probeOf(second);

    assert.ok(firstProbe.sessionId);
    assert.equal(secondProbe.sessionId, firstProbe.sessionId);
    assert.equal(secondProbe.sessionDir, firstProbe.sessionDir);
    assert.equal(secondProbe.hostMarker, null);
    assert.ok(!secondProbe.argv.includes("--no-session"));
    assert.deepEqual(firstProbe.history, []);
    assert.deepEqual(secondProbe.history, [firstPrompt]);

    assert.notEqual(second.text, first.text);
    assert.equal(first.toolCalls.length, 1);
    assert.equal(second.toolCalls.length, 1);
    assert.equal(first.events.length, 3);
    assert.equal(second.events.length, 3);
    assert.equal(first.steps, 1);
    assert.equal(second.steps, 1);
    assert.equal(first.metadata?.nativeCompleted, true);
    assert.equal(second.metadata?.nativeCompleted, true);
    assert.equal(second.metadata?.workspaceCwd, first.metadata?.workspaceCwd);
    assert.deepEqual(first.usage, {
      promptTokens: 14,
      completionTokens: 5,
      totalTokens: 19,
    });
    assert.deepEqual(second.usage, {
      promptTokens: 15,
      completionTokens: 5,
      totalTokens: 20,
    });
    assert.deepEqual(second.metadata?.nativeUsage, {
      input: 12,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 20,
    });

    const sessionFile = sessionFileOf(secondProbe);
    assert.equal(existsSync(sessionFile), true);
    await driver.close("多轮成功收尾");
    assert.equal(existsSync(sessionFile), false);
    assertSandboxRemoved(secondProbe);
  });
});

test("多轮：不同 Driver/repeat 的 session-id、目录与历史互串", async () => {
  const sessionIds = new Set<string>();
  const sessionDirs = new Set<string>();
  const workspaces = new Set<string>();
  for (const repeat of [0, 1]) {
    const firstPrompt = "repeat-" + repeat + "-first";
    await withDriver(
      { turns: [firstPrompt, "repeat-" + repeat + "-second"] },
      async (driver) => {
        const first = probeOf(await driver.sendPrompt(firstPrompt));
        const second = probeOf(
          await driver.sendPrompt("repeat-" + repeat + "-second"),
        );
        assert.deepEqual(first.history, []);
        assert.deepEqual(second.history, [firstPrompt]);
        assert.ok(first.sessionId);
        assert.ok(first.sessionDir);
        sessionIds.add(first.sessionId);
        sessionDirs.add(first.sessionDir);
        workspaces.add(first.cwd);
      },
    );
  }
  assert.equal(sessionIds.size, 2);
  assert.equal(sessionDirs.size, 2);
  assert.equal(workspaces.size, 2);
});

test("多轮：首轮与次轮 provider 失败后 close 均清理 session/HOME/cwd", async () => {
  for (const failureTurn of [0, 1]) {
    const prompts =
      failureTurn === 0
        ? ["__PROVIDER_ERROR__", "second"]
        : ["first", "__PROVIDER_ERROR__"];
    await withDriver({ turns: prompts }, async (driver, setup) => {
      if (failureTurn === 1) await driver.sendPrompt("first");
      await assert.rejects(
        driver.sendPrompt(prompts[failureTurn]!),
        /synthetic provider failure/,
      );
      const probes = await readProbes(setup.probeFile);
      const probe = probes[failureTurn]!;
      assert.equal(probe.history.length, failureTurn);
      assert.equal(existsSync(sessionFileOf(probe)), true);
      await driver.close("失败收尾");
      assertSandboxRemoved(probe);
    });
  }
});

test("多轮：close 取消活动次轮，拒绝并发并清理全部资源", async () => {
  await withDriver({ turns: ["first", "__HANG__"] }, async (driver, setup) => {
    await driver.sendPrompt("first");
    const pending = driver.sendPrompt("__HANG__");
    const rejected = assert.rejects(pending);
    const probes = await waitForProbes(setup.probeFile, 2);
    await assert.rejects(driver.sendPrompt("concurrent"), /并发/);
    await driver.close("取消活动轮次");
    await rejected;
    assertSandboxRemoved(probes[1]!);
  });
});

test("多轮：次轮缺 agent_end 不得复用首轮完成状态", async () => {
  await withDriver(
    { turns: ["first", "__NO_AGENT_END__"] },
    async (driver, setup) => {
      await driver.sendPrompt("first");
      await assert.rejects(driver.sendPrompt("__NO_AGENT_END__"), /完成信号/);
      const probes = await readProbes(setup.probeFile);
      await driver.close("次轮完成信号缺失");
      assertSandboxRemoved(probes[1]!);
    },
  );
});

test("多轮：次轮缺少正数原生 usage 显式失败并清理", async () => {
  await withDriver(
    { turns: ["first", "__NO_USAGE__"] },
    async (driver, setup) => {
      await driver.sendPrompt("first");
      await assert.rejects(driver.sendPrompt("__NO_USAGE__"), /usage|用量/);
      const probes = await readProbes(setup.probeFile);
      await driver.close("次轮 usage 缺失");
      assertSandboxRemoved(probes[1]!);
    },
  );
});

test("多轮：close 取消 collect 后仍等待最终进程收尾的轮次", async (t) => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = JsonlProcess.prototype.close;
  t.mock.method(
    JsonlProcess.prototype,
    "close",
    async function (this: JsonlProcess) {
      await original.call(this);
      enter();
      await gate;
    },
  );
  await withDriver({ turns: ["first", "second"] }, async (driver, setup) => {
    const pending = driver.sendPrompt("first");
    try {
      await entered;
      const closing = driver.close("取消最终收尾窗口");
      release();
      await Promise.all([closing, assert.rejects(pending, /close|取消/)]);
      const [probe] = await readProbes(setup.probeFile);
      assertSandboxRemoved(probe!);
    } finally {
      release();
      await pending.catch(() => {});
    }
  });
});

test("多轮：close 取消文件证据采集的最终收尾窗口", async () => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalOpen = fsPromises.open;
  fsPromises.open = async (...args) => {
    const handle = await originalOpen(...args);
    const close = handle.close.bind(handle);
    handle.close = async () => {
      await close();
      enter();
      await gate;
    };
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await withDriver(
      {
        turns: ["__EVIDENCE__", "second"],
        evidence: { sample: "evidence.txt" },
      },
      async (driver, setup) => {
        const pending = driver.sendPrompt("__EVIDENCE__");
        try {
          await entered;
          const closing = driver.close("取消文件证据收尾窗口");
          release();
          await Promise.all([closing, assert.rejects(pending, /close|取消/)]);
          const [probe] = await readProbes(setup.probeFile);
          assertSandboxRemoved(probe!);
        } finally {
          release();
          await pending.catch(() => {});
        }
      },
    );
  } finally {
    release();
    fsPromises.open = originalOpen;
    syncBuiltinESMExports();
  }
});
