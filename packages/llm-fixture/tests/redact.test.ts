/**
 * @module @x-agent-suite/llm-fixture/tests/redact
 * live secret 脱敏的归一变体与结构化异常回归测试。
 */
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "node:test";
import {
  createSecretRedactor,
  redactLiveError,
  redactValue,
} from "../src/redact.ts";

const SECRET = "synthetic-secret-value";
const PRIVATE_URL = "https://private.example.com/v1";

/** 收集对象图全部可达字符串值，避免只检查顶层 message。 */
function collectStrings(value: unknown): string[] {
  const output: string[] = [];
  const seen = new WeakSet<object>();
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      output.push(item);
      return;
    }
    if (item === null || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key === "string") output.push(key);
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor && "value" in descriptor) visit(descriptor.value);
    }
  };
  visit(value);
  return output;
}

test("createSecretRedactor：覆盖直接值、URL 编码值与跨终端换行值", () => {
  const redact = createSecretRedactor([SECRET, PRIVATE_URL]);
  const wrapped = [...SECRET].join("\r\n  ");
  const encoded = encodeURIComponent(PRIVATE_URL).replace(
    /%[0-9A-F]{2}/g,
    (hex) => hex.toLowerCase(),
  );
  const output = redact(`${SECRET}\n${encoded}\n${wrapped}`);

  assert.doesNotMatch(output, /synthetic|private\.example|https%3A/i);
  assert.match(output, /\[REDACTED\]/);
});

test("createSecretRedactor：短秘密的跨终端空白形式同样脱敏", () => {
  const secret = "abc";
  const output = createSecretRedactor([secret])("a\r\n b\t c");
  assert.doesNotMatch(output.replace(/\s/g, ""), new RegExp(secret));
  assert.match(output, /\[REDACTED\]/);
});

test("redactValue/redactLiveError：递归覆盖 Error cause、AggregateError、stack 与循环对象", () => {
  const redact = createSecretRedactor([SECRET]);
  const cause = new Error(`cause=${SECRET}`);
  cause.stack = `Error: cause=${SECRET}\n at ${SECRET}`;
  Object.assign(cause, { detail: { secret: SECRET } });
  Object.defineProperty(cause, "computed", {
    enumerable: true,
    get: () => ({ secret: SECRET }),
  });
  const aggregate = new AggregateError(
    [new Error(`nested=${SECRET}`), { token: SECRET }],
    `aggregate=${SECRET}`,
    { cause },
  );
  const cyclic: { secret: string; self?: unknown; error: Error } & Record<
    string,
    unknown
  > = {
    secret: SECRET,
    error: aggregate,
    [SECRET]: "custom-key",
  };
  cyclic.self = cyclic;

  const safe = redactValue(cyclic, redact);
  const safeError = redactLiveError(aggregate, redact);
  const computed = (safeError.cause as Error & { computed: unknown }).computed;
  assert.equal(safe.self, safe);
  assert.doesNotMatch(inspect(computed, { depth: 5 }), new RegExp(SECRET));
  assert.ok(safeError instanceof AggregateError);
  for (const text of [...collectStrings(safe), ...collectStrings(safeError)]) {
    assert.doesNotMatch(text, new RegExp(SECRET));
    assert.doesNotMatch(text.replace(/\s/g, ""), new RegExp(SECRET));
  }
  assert.match(inspect(safeError, { depth: 10 }), /\[REDACTED\]/);
});

test("redactValue：脱敏键碰撞时保留全部属性且不受不可配置属性阻断", () => {
  const redact = createSecretRedactor([SECRET]);
  const source: Record<string, string> = {};
  Object.defineProperty(source, SECRET, {
    value: "secret-key-value",
    enumerable: true,
    configurable: false,
  });
  source["[REDACTED]"] = "existing-redacted-key";

  const safe = redactValue(source, redact);
  assert.equal(Object.keys(safe).length, 2);
  assert.deepEqual(
    new Set(Object.values(safe)),
    new Set(["secret-key-value", "existing-redacted-key"]),
  );
  assert.doesNotMatch(Object.keys(safe).join("\n"), new RegExp(SECRET));
});

test("redactValue：保留 DOMException、Map 与 Set 的可用 API 并脱敏", () => {
  const redact = createSecretRedactor([SECRET]);
  const source = {
    dom: new DOMException(`dom=${SECRET}`, "OperationError"),
    map: new Map([[SECRET, new Set([SECRET])]]),
  };

  const safe = redactValue(source, redact);
  assert.ok(safe.dom instanceof DOMException);
  assert.doesNotMatch(safe.dom.message, new RegExp(SECRET));
  assert.ok(safe.map instanceof Map);
  const entries = [...safe.map.entries()];
  assert.equal(entries.length, 1);
  assert.ok(entries[0]?.[1] instanceof Set);
  assert.doesNotMatch(inspect(entries, { depth: 5 }), new RegExp(SECRET));
});
