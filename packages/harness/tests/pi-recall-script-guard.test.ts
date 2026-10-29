/**
 * @module harness/tests/pi-recall-script-guard
 * 直接执行实际下发的守卫源码，验证命令白名单和路径限制；不启动模型。
 */
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createPiRecallGuardSource } from "../../../profiles/pi-recall-guard.ts";
import { driverContext } from "./fixtures/pi-recall-fake.ts";

const command =
  "node scripts/task.mjs --input fixtures/input.json --output out/report.json";

test("真实守卫放行白名单 Node 命令，阻断组合命令、替代脚本与路径逃逸", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "xas-script-guard-")),
  );
  try {
    for (const dir of ["scripts", "fixtures"]) await mkdir(join(root, dir));
    await writeFile(join(root, "scripts/task.mjs"), "console.log('ok');");
    await writeFile(join(root, "fixtures/input.json"), "{}");
    const effects = driverContext({
      tools: "allowlist",
      commands: { allow: [command], deny: [] },
    }).effects;
    const path = join(root, "guard.mjs");
    await writeFile(path, createPiRecallGuardSource(root, effects));
    const handlers = new Map<string, (event: unknown) => unknown>();
    const module = await import(pathToFileURL(path).href);
    module.default({
      on: (name: string, handler: (event: unknown) => unknown) =>
        handlers.set(name, handler),
    });
    const check = (command: string) =>
      handlers.get("tool_call")!({ toolName: "bash", input: { command } }) as
        { block?: boolean } | undefined;
    assert.equal(check(command), undefined);
    assert.equal(
      check(
        `node "${root}/scripts/task.mjs" --input "${root}/fixtures/input.json" --output "${root}/out/report.json"`,
      )?.block,
      true,
      "路径等价也不放宽完整字符串白名单",
    );
    for (const invalid of [
      command + "; echo forged",
      command + " && echo forged",
      "node --eval 'process.exit()'",
      "node scripts/other.mjs",
      command.replace("out/report.json", "../escape.json"),
    ]) {
      assert.equal(check(invalid)?.block, true, invalid);
    }
    if (process.platform !== "win32") {
      await symlink(tmpdir(), join(root, "out"), "dir");
      assert.equal(check(command)?.block, true, "输出祖先链接越界必须阻断");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("真实守卫的 deny 优先，路径表示变化不能绕过 deny", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "xas-script-deny-")),
  );
  try {
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "fixtures"));
    await writeFile(join(root, "scripts/task.mjs"), "");
    await writeFile(join(root, "fixtures/input.json"), "{}");
    const effects = driverContext({
      tools: "allowlist",
      commands: { allow: [command], deny: [command] },
    }).effects;
    const file = join(root, "guard.mjs");
    await writeFile(file, createPiRecallGuardSource(root, effects));
    let handler: (event: unknown) => { block?: boolean };
    (await import(pathToFileURL(file).href)).default({
      on: (name: string, callback: typeof handler) => {
        if (name === "tool_call") handler = callback;
      },
    });
    assert.equal(
      handler!({ toolName: "bash", input: { command } })?.block,
      true,
    );
    const absolute = command.replace(
      "scripts/task.mjs",
      join(root, "scripts/task.mjs"),
    );
    assert.equal(
      handler!({ toolName: "bash", input: { command: absolute } })?.block,
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
