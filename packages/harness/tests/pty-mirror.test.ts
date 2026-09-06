/**
 * @module @x-agent-suite/harness/tests/pty-mirror
 * 屏幕镜像件的回归测试：宽度计算、布局、排版与订阅重绘。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachScreenMirror,
  composeMirrorFrame,
  computeMirrorLayout,
  displayWidth,
  fitToWidth,
  parseSttySize,
  type ScreenMirrorSource,
} from "../src/pty-mirror.ts";

test("displayWidth：ASCII 计 1 列，全角字符计 2 列", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("中文"), 4);
  assert.equal(displayWidth("a中b"), 4);
});

test("fitToWidth：超长按列截断且不截半全角字符，不足补空格", () => {
  assert.equal(fitToWidth("ab", 5), "ab   ");
  assert.equal(fitToWidth("中文", 4), "中文");
  assert.equal(fitToWidth("中a", 1), " ");
  assert.equal(fitToWidth("abcde", 3), "abc");
});

test("parseSttySize：解析 rows cols，乱码返回 null", () => {
  assert.deepEqual(parseSttySize("24 80\n"), { rows: 24, cols: 80 });
  assert.deepEqual(parseSttySize("  40 120 "), { rows: 40, cols: 120 });
  assert.equal(parseSttySize("garbage"), null);
  assert.equal(parseSttySize("0 80"), null);
});

test("computeMirrorLayout：双分屏在 80x24 下并列且窗格满足最小宽高", () => {
  const layout = computeMirrorLayout(2, 80, 24);
  assert.ok(layout);
  assert.equal(layout.columns, 2);
  assert.equal(layout.paneWidth, Math.floor((80 - 1) / 2));
  assert.ok(layout.paneHeight >= 6);
});

test("computeMirrorLayout：极端窄终端返回 null 以回退堆叠", () => {
  assert.equal(computeMirrorLayout(3, 30, 10), null);
});

test("composeMirrorFrame：网格布局每行等宽且不超终端列数", () => {
  const cols = 80;
  const rows = 24;
  const frame = composeMirrorFrame(
    [
      { label: "a", screen: "hello\nworld" },
      { label: "b", screen: "中文屏\n第二行" },
    ],
    cols,
    rows,
  );
  const lines = frame.split("\n");
  assert.ok(lines.length <= rows);
  const widths = lines.map(displayWidth);
  assert.ok(Math.max(...widths) <= cols);
  assert.equal(new Set(widths).size, 1);
});

test("composeMirrorFrame：布局不可读时回退带标签的纵向堆叠", () => {
  const frame = composeMirrorFrame(
    [
      { label: "a", screen: "s1" },
      { label: "b", screen: "s2" },
    ],
    30,
    10,
  );
  assert.match(frame, /──── a ────\ns1/);
  assert.match(frame, /──── b ────\ns2/);
});

/** 手工触发的假屏幕源。 */
function makeFakeSource(screen: string): {
  source: ScreenMirrorSource;
  emit: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    source: {
      screen: () => screen,
      onScreenChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

test("attachScreenMirror：挂载即绘一帧，变化经节流重绘，关闭后不再绘", async () => {
  const writes: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    const fake = makeFakeSource("screen-a");
    const close = attachScreenMirror([{ label: "a", source: fake.source }]);
    assert.equal(writes.length, 1);
    assert.match(writes[0]!, /screen-mirror/);
    assert.match(writes[0]!, /screen-a/);

    fake.emit();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.ok(writes.length >= 2);

    const before = writes.length;
    close();
    fake.emit();
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(writes.length, before);
  } finally {
    process.stderr.write = originalWrite;
  }
});
