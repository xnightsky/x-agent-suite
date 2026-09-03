/**
 * @module @x-agent-suite/llm-fixture/redact
 * live secret 的文本与结构化值脱敏；覆盖 URL 编码和终端空白变体。
 */
import type { Redactor } from "@x-agent-suite/contracts";
import type { LiveChannel } from "./live-types.ts";

const REDACTED = "[REDACTED]";

/** 转义正则表达式字面量。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 收集同一秘密的常见 URL 归一形式。 */
function secretVariants(secret: string): string[] {
  const variants = new Set([secret]);
  try {
    variants.add(decodeURIComponent(secret));
  } catch {
    // 非 URL 编码文本无需解码。
  }
  for (const value of [...variants]) {
    const encoded = encodeURIComponent(value);
    variants.add(encoded);
    variants.add(encoded.replace(/%[0-9A-F]{2}/g, (hex) => hex.toLowerCase()));
    try {
      const url = new URL(value);
      variants.add(url.href);
      variants.add(url.href.replace(/\/$/, ""));
    } catch {
      // 非 URL 文本无需归一。
    }
  }
  return [...variants].filter(Boolean);
}

/** 构造允许终端在字符间插入任意空白的匹配式。 */
function wrappedPattern(secret: string): RegExp {
  const pattern = [...secret].map(escapeRegExp).join("\\s*");
  return new RegExp(pattern, "gu");
}

/** 根据秘密列表创建稳定的文本脱敏器。 */
export function createSecretRedactor(secrets: readonly string[]): Redactor {
  const variants = [...new Set(secrets.flatMap(secretVariants))].sort(
    (a, b) => b.length - a.length,
  );
  const patterns = variants.map(wrappedPattern);
  return (text) => {
    let output = text;
    for (const secret of variants) {
      output = output.split(secret).join(REDACTED);
    }
    for (const pattern of patterns) output = output.replace(pattern, REDACTED);
    return output;
  };
}

/** 递归克隆并脱敏字符串、Error、AggregateError、数组与循环对象。 */
export function redactValue<T>(value: T, redactor?: Redactor): T {
  if (!redactor) return value;
  return cloneRedacted(value, redactor, new WeakMap()) as T;
}

/** 脱敏未知异常并归一为 Error，同时保留原型和 cause/errors。 */
export function redactLiveError(error: unknown, redactor?: Redactor): Error {
  if (error instanceof Error) return redactValue(error, redactor);
  return new Error(redactor?.(String(error)) ?? String(error));
}

/** 复制 own properties，并包装 getter 的返回值与异常。 */
function copyOwnProperties(
  source: object,
  target: object,
  redactor: Redactor,
  seen: WeakMap<object, unknown>,
): void {
  const assignedKeys = new Set<PropertyKey>();
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      descriptor.value = cloneRedacted(descriptor.value, redactor, seen);
    } else if (descriptor.get) {
      const getter = descriptor.get;
      descriptor.get = () => {
        try {
          return cloneRedacted(getter.call(source), redactor, seen);
        } catch (error) {
          throw cloneRedacted(error, redactor, seen);
        }
      };
    }
    const safeKey = uniqueRedactedKey(key, redactor, assignedKeys);
    Object.defineProperty(target, safeKey, descriptor);
  }
}

/** 为脱敏后碰撞的字符串键生成稳定且不含原值的后缀。 */
function uniqueRedactedKey(
  key: PropertyKey,
  redactor: Redactor,
  assigned: Set<PropertyKey>,
): PropertyKey {
  if (typeof key !== "string") {
    assigned.add(key);
    return key;
  }
  const base = redactor(key);
  let candidate = base;
  let suffix = 2;
  while (assigned.has(candidate)) candidate = `${base}#${suffix++}`;
  assigned.add(candidate);
  return candidate;
}

/** 克隆依赖内部槽的常见内建对象。 */
function cloneBuiltin(
  value: object,
  redactor: Redactor,
  seen: WeakMap<object, unknown>,
): object | undefined {
  let clone: object | undefined;
  if (value instanceof DOMException) {
    clone = new DOMException(redactor(value.message), redactor(value.name));
  } else if (value instanceof Date) {
    clone = new Date(value.getTime());
  } else if (value instanceof RegExp) {
    const regexp = new RegExp(redactor(value.source), value.flags);
    regexp.lastIndex = value.lastIndex;
    clone = regexp;
  } else if (value instanceof URL) {
    const href = redactor(value.href);
    clone = new URL(href === value.href ? href : "about:blank");
  } else if (value instanceof URLSearchParams) {
    clone = new URLSearchParams(redactor(value.toString()));
  } else if (value instanceof ArrayBuffer) {
    clone = value.slice(0);
  } else if (ArrayBuffer.isView(value)) {
    clone = structuredClone(value);
  } else if (value instanceof WeakMap) {
    clone = new WeakMap();
  } else if (value instanceof WeakSet) {
    clone = new WeakSet();
  }
  if (!clone) return undefined;
  seen.set(value, clone);
  copyOwnProperties(value, clone, redactor, seen);
  return clone;
}

/** 递归克隆实现。 */
function cloneRedacted(
  value: unknown,
  redactor: Redactor,
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === "string") return redactor(value);
  if (value === null || typeof value !== "object") return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;

  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>();
    seen.set(value, clone);
    for (const [key, nested] of value) {
      clone.set(
        cloneRedacted(key, redactor, seen),
        cloneRedacted(nested, redactor, seen),
      );
    }
    copyOwnProperties(value, clone, redactor, seen);
    return clone;
  }
  if (value instanceof Set) {
    const clone = new Set<unknown>();
    seen.set(value, clone);
    for (const nested of value)
      clone.add(cloneRedacted(nested, redactor, seen));
    copyOwnProperties(value, clone, redactor, seen);
    return clone;
  }
  const builtin = cloneBuiltin(value, redactor, seen);
  if (builtin) return builtin;

  const clone = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  seen.set(value, clone);
  copyOwnProperties(value, clone, redactor, seen);
  return clone;
}

/** 脱敏渠道地址、字面量凭据和调用方已解析出的凭据。 */
export function redactLiveSecrets(
  text: string,
  channels: Iterable<LiveChannel>,
  resolvedSecrets: Iterable<string> = [],
): string {
  const secrets = [...resolvedSecrets];
  for (const channel of channels) {
    secrets.push(channel.baseUrl);
    if (channel.apiKey) secrets.push(channel.apiKey);
    try {
      const origin = new URL(channel.baseUrl).origin;
      if (origin && origin !== "null") secrets.push(origin);
    } catch {
      // 非 URL 形态按整串处理即可。
    }
  }
  return createSecretRedactor(secrets)(text);
}
