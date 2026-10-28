/**
 * @module harness/tests/pi-recall-guard
 * 守卫扩展真实行为回归：直接执行驱动实际下发的那份源码，用 fake pi.on 收集 handler 后逐项调用。
 * 不变量：零真实网络、零 provider 调用；断言只看 handler 的真实返回与 abort 调用。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { probeOf, withDriver } from "./fixtures/pi-recall-fake.ts";

/** 守卫扩展注册的两个 handler。 */
interface GuardHandlers {
  readonly toolCall: (
    event: Record<string, unknown>,
  ) => { block?: boolean; reason?: string } | undefined;
  readonly turnEnd: (
    event: Record<string, unknown>,
    ctx: { abort(): Promise<void> },
  ) => Promise<void>;
}

/** 直接执行驱动实际下发的那份守卫源码：用 fake pi.on 收集 handler，验证真实拦截行为。 */
async function loadGuard(source: string): Promise<GuardHandlers> {
  const dir = await mkdtemp(join(tmpdir(), "xas-pi-recall-guard-"));
  const file = join(dir, "guard.mjs");
  await writeFile(file, source);
  try {
    const module = (await import(pathToFileURL(file).href)) as {
      default: (pi: { on(name: string, handler: unknown): void }) => void;
    };
    const handlers = new Map<string, unknown>();
    module.default({ on: (name, handler) => handlers.set(name, handler) });
    const toolCall = handlers.get("tool_call");
    const turnEnd = handlers.get("turn_end");
    assert.ok(typeof toolCall === "function", "守卫必须注册 tool_call");
    assert.ok(typeof turnEnd === "function", "守卫必须注册 turn_end");
    return {
      toolCall: toolCall as GuardHandlers["toolCall"],
      turnEnd: turnEnd as GuardHandlers["turnEnd"],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("守卫真实行为：根内（相对/绝对）放行，../ 与绝对路径/符号链接越界阻断，未允许工具阻断，预算中断", async () => {
  await withDriver({ maxSteps: 2 }, async (driver) => {
    const probe = probeOf(await driver.sendPrompt("hello"));
    const guard = await loadGuard(probe.guard ?? "");
    const outsideDir = join(probe.cwd, "..");
    await writeFile(join(probe.cwd, "inside.txt"), "inside");
    await writeFile(join(outsideDir, "escape.txt"), "outside");
    const check = (toolName: string, path: string) =>
      guard.toolCall({ toolName, input: { path } });

    assert.equal(check("read", "inside.txt"), undefined, "根内文件必须放行");
    assert.equal(
      check("read", join(probe.cwd, "inside.txt")),
      undefined,
      "根内绝对路径必须放行",
    );
    const absoluteEscape = check("read", join(outsideDir, "escape.txt"));
    assert.equal(absoluteEscape?.block, true, "根外绝对路径必须阻断");
    assert.match(absoluteEscape?.reason ?? "", /隔离工作区/);
    const escaped = check("read", "../escape.txt");
    assert.equal(escaped?.block, true, "../ 越界必须阻断");
    assert.match(escaped?.reason ?? "", /隔离工作区/);
    const deniedTool = check("bash", ".");
    assert.equal(deniedTool?.block, true, "未允许工具必须阻断");
    assert.match(deniedTool?.reason ?? "", /白名单/);
    if (process.platform !== "win32") {
      await symlink(
        join(outsideDir, "escape.txt"),
        join(probe.cwd, "link.txt"),
      );
      const linked = check("read", "link.txt");
      assert.equal(linked?.block, true, "符号链接越界必须阻断");
      assert.match(linked?.reason ?? "", /隔离工作区/);
    }

    let aborts = 0;
    const ctx = {
      abort: async () => {
        aborts += 1;
      },
    };
    await guard.turnEnd({ turnIndex: 0 }, ctx);
    assert.equal(aborts, 0, "未到预算上限不得中断");
    await guard.turnEnd({ turnIndex: 1 }, ctx);
    assert.equal(aborts, 1, "达到 maxSteps 必须中断");
  });
});
