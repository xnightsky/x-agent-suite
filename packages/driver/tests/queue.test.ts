/**
 * @module @x-agent-suite/driver/tests/queue
 * AsyncQueue 对合法 undefined 元素的回归测试。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AsyncQueue } from "../src/queue.ts";

test("AsyncQueue：undefined 是合法队列元素，不是空队列哨兵", async () => {
  const queue = new AsyncQueue<undefined>();
  queue.push(undefined);
  queue.end();

  const values: undefined[] = [];
  for await (const value of queue) values.push(value);
  assert.deepEqual(values, [undefined]);
});
