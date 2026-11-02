/**
 * @module @x-agent-suite/assertions/tests/workspace-path
 * workspace 词法路径归一与边界匹配的公开契约测试。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWorkspacePath } from "../src/index.ts";

test("workspace 路径：相对、点相对和内部绝对路径归一到同一资源", () => {
  for (const input of [
    "docs/a.md",
    "./docs/a.md",
    "/sandbox/root/docs/a.md",
    "docs\\a.md",
    "docs/../docs/a.md",
  ]) {
    assert.equal(
      normalizeWorkspacePath("/sandbox/root", input),
      "docs/a.md",
      input,
    );
  }
  assert.equal(normalizeWorkspacePath("/sandbox/root", "/sandbox/root"), ".");
});

test("workspace 路径：外部同名与路径逃逸在边界外，伪造前缀保留不同逻辑身份", () => {
  assert.equal(
    normalizeWorkspacePath("/sandbox/root", "forged/docs/a.md"),
    "forged/docs/a.md",
  );
  for (const input of [
    "/outside/docs/a.md",
    "../outside/a.md",
    "/sandbox/root-other/docs/a.md",
  ]) {
    assert.equal(
      normalizeWorkspacePath("/sandbox/root", input),
      undefined,
      input,
    );
  }
});

test("workspace 路径：Windows 分隔符、盘符和内部绝对路径按同一逻辑路径处理", () => {
  const workspace = "C:\\sandbox\\root";
  for (const input of [
    "docs/a.md",
    "docs\\a.md",
    ".\\docs\\a.md",
    "C:/sandbox/root/docs/a.md",
    "C:\\sandbox\\root\\docs\\a.md",
  ]) {
    assert.equal(normalizeWorkspacePath(workspace, input), "docs/a.md", input);
  }
  assert.equal(
    normalizeWorkspacePath(workspace, "D:\\sandbox\\root\\docs\\a.md"),
    undefined,
  );
  assert.equal(
    normalizeWorkspacePath(workspace, "..\\outside\\a.md"),
    undefined,
  );
});

test("workspace 路径：正斜杠 UNC 按 Windows 边界处理", () => {
  const workspace = "//server/share/root";
  for (const input of [
    "docs/a.md",
    "//server/share/root/docs/a.md",
    "\\\\server\\share\\root\\docs\\a.md",
  ]) {
    assert.equal(normalizeWorkspacePath(workspace, input), "docs/a.md", input);
  }
  assert.equal(
    normalizeWorkspacePath(workspace, "C:\\..\\docs\\a.md"),
    undefined,
  );
});

test("workspace 路径：边界或输入无法可信归一时显式拒绝", () => {
  const illegal: readonly (readonly [string, string])[] = [
    ["", "docs/a.md"],
    ["relative/workspace", "docs/a.md"],
    ["/sandbox/root", ""],
  ];
  for (const [workspace, input] of illegal) {
    assert.throws(() => normalizeWorkspacePath(workspace, input), TypeError);
  }
});
