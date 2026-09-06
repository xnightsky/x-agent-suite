/**
 * @module @x-agent-suite/driver/tests/pty
 * PTY 驱动层最小回归：验证 PtyProcess 能分配 TTY、捕获屏幕文本、
 * 等待目标内容出现，并幂等关闭。
 * 不变量：本测试只驱动 node 子进程，不依赖任何外部宿主 CLI；
 * 断言落在 screen() 与 waitForScreen 行为上，不依赖退出码。
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { PtyProcess } from "../src/pty.ts";

test("PtyProcess：能等到子进程输出并在屏幕快照中呈现", async () => {
  const proc = new PtyProcess({
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write('hello pty\\n'); setTimeout(() => {}, 5000)",
    ],
  });
  await proc.start();
  try {
    await proc.waitForScreen(/hello pty/, 3_000);
    assert.match(proc.screen(), /hello pty/);
  } finally {
    await proc.close();
  }
});

test("PtyProcess：显式环境不会重新继承父进程变量", async () => {
  const name = "XAS_PTY_PARENT_SECRET";
  const saved = process.env[name];
  process.env[name] = "synthetic-parent-secret";
  const childEnv = { ...process.env };
  delete childEnv[name];
  const proc = new PtyProcess({
    command: process.execPath,
    args: [
      "-e",
      `process.stdout.write('parent-secret=' + (process.env.${name} ?? 'missing') + '\\n'); setTimeout(() => {}, 5000)`,
    ],
    env: childEnv,
  });
  try {
    await proc.start();
    await proc.waitForScreen(/parent-secret=/, 3_000);
    assert.match(proc.screen(), /parent-secret=missing/);
    assert.doesNotMatch(proc.screen(), /synthetic-parent-secret/);
  } finally {
    await proc.close();
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
});

test("PtyProcess：write 写入文本后能在屏幕上看到回显", async () => {
  const proc = new PtyProcess({
    command: process.execPath,
    args: ["-i"], // 交互式 REPL，保证 PTY 下会回显输入
  });
  await proc.start();
  try {
    // 等待 REPL 提示符就绪
    await proc.waitForScreen(/>/, 3_000);
    const marker = `pty-marker-${Date.now()}`;
    proc.write(`console.log('${marker}')\r`);
    await proc.waitForScreen(new RegExp(marker), 3_000);
  } finally {
    await proc.close();
  }
});

test("PtyProcess：关闭幂等，重复 close 不抛错", async () => {
  const proc = new PtyProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 100)"],
  });
  await proc.start();
  await proc.close("第一次关闭");
  await proc.close("第二次关闭应忽略");
});

test("PtyProcess：等待超时显式抛错并附最后一屏", async () => {
  const proc = new PtyProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 100)"],
  });
  await proc.start();
  try {
    await assert.rejects(
      proc.waitForScreen(/不可能出现的字符串/, 200),
      /等待屏幕内容超时/,
    );
  } finally {
    await proc.close();
  }
});

test(
  "PtyProcess：Windows ConPTY 辅助进程失败时安静回退 shell PID",
  { skip: process.platform !== "win32", timeout: 10_000 },
  async () => {
    const require = createRequire(import.meta.url);
    const helperPath = join(
      dirname(require.resolve("node-pty")),
      "conpty_console_list_agent.js",
    );
    const deadPid = 0x7fffffff;
    const child = fork(helperPath, [String(deadPid)], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    const messages: unknown[] = [];
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("message", (message) => messages.push(message));

    const killTimer = setTimeout(() => child.kill(), 5_000);
    const [code, signal] = (await once(child, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    clearTimeout(killTimer);
    assert.equal(
      code,
      0,
      `ConPTY 辅助进程异常退出（signal=${signal ?? "none"}）：\n${stderr}`,
    );
    assert.doesNotMatch(
      stderr,
      /AttachConsole failed|conpty_console_list_agent/,
    );
    assert.deepEqual(messages, [{ consoleProcessList: [deadPid] }]);
  },
);
