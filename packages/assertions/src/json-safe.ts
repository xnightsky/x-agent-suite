/**
 * @module @x-agent-suite/assertions/json-safe
 * JSON-safe 值校验、深克隆、深相等与 own-property 子集匹配。
 *
 * 不变量：
 * - 严格校验只接受可无损落入 JSON 的 null/boolean/string/finite number/array/普通对象；
 * - 克隆可为报告入口显式启用历史 JSON.stringify 兼容，省略对象字段中的 undefined/function/symbol；
 * - 错误信息只含逻辑路径与类别，不序列化输入值；
 * - 对象比较忽略键序，数组比较保留顺序，且只读取 own enumerable data property；
 * - 克隆结果与输入无共享可变引用，`__proto__` 等自有键通过 defineProperty 安全保留。
 */

/** JSON 对象值。 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** 可无损落入 JSON 的值。 */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | JsonObject;

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? path + "." + key
    : path + "[" + JSON.stringify(key) + "]";
}

function invalid(path: string, detail: string): never {
  throw new TypeError(path + " " + detail);
}

function isJsonStringifyOmitted(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  );
}

function assertOwnDataProperty(value: object, key: string, path: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable) {
    invalid(path, "只能包含 enumerable 自有字段");
  }
  if (!("value" in descriptor)) {
    invalid(path, "不得包含 accessor 字段");
  }
}

function assertNoSymbolKeys(value: object, path: string): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    invalid(path, "不得包含 symbol 字段");
  }
}

function assertArray(value: readonly unknown[], path: string): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalid(path, "数组必须是标准 Array");
  }
  assertNoSymbolKeys(value, path);
  for (const name of Object.getOwnPropertyNames(value)) {
    if (name === "length") continue;
    const index = Number(name);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= value.length ||
      String(index) !== name
    ) {
      invalid(childPath(path, name), "数组不得包含非索引自有字段");
    }
    assertOwnDataProperty(value, name, childPath(path, name));
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      invalid(childPath(path, String(index)), "数组不得包含空洞");
    }
  }
}

function assertObject(value: object, path: string): void {
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, "必须是普通对象或 null-prototype 对象");
  }
  assertNoSymbolKeys(value, path);
  for (const key of Object.getOwnPropertyNames(value)) {
    assertOwnDataProperty(value, key, childPath(path, key));
  }
}

function assertJsonValueInternal(
  value: unknown,
  path: string,
  stack: WeakSet<object>,
  omitUnsupportedObjectProperties: boolean,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(path, "必须是有限数");
    return;
  }
  if (typeof value !== "object") {
    invalid(path, "必须是 JSON 值");
  }
  if (stack.has(value)) invalid(path, "不得包含循环引用");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      assertArray(value, path);
      value.forEach((item, index) =>
        assertJsonValueInternal(
          item,
          childPath(path, String(index)),
          stack,
          omitUnsupportedObjectProperties,
        ),
      );
      return;
    }
    assertObject(value, path);
    for (const [key, item] of Object.entries(value)) {
      if (omitUnsupportedObjectProperties && isJsonStringifyOmitted(item)) {
        continue;
      }
      assertJsonValueInternal(
        item,
        childPath(path, key),
        stack,
        omitUnsupportedObjectProperties,
      );
    }
  } finally {
    stack.delete(value);
  }
}

/**
 * 校验一个值是否可无损表示为 JSON；失败时抛 TypeError。
 * @param value 待校验值。
 * @param path 错误诊断中的逻辑位置。
 */
export function assertJsonValue(
  value: unknown,
  path = "JSON 值",
): asserts value is JsonValue {
  assertJsonValueInternal(value, path, new WeakSet(), false);
}

/** 返回一个值是否为可无损 JSON 值。 */
export function isJsonValue(value: unknown): value is JsonValue {
  try {
    assertJsonValue(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * 判断值是否为普通 JSON 对象（非数组、原型为 Object.prototype 或 null）。
 * @param value 待判断值。
 */
export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function cloneValidated(
  value: JsonValue,
  omitUnsupportedObjectProperties: boolean,
): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) =>
      cloneValidated(item, omitUnsupportedObjectProperties),
    );
  }
  const output = Object.create(Object.getPrototypeOf(value)) as Record<
    string,
    JsonValue
  >;
  for (const [key, nested] of Object.entries(value)) {
    if (omitUnsupportedObjectProperties && isJsonStringifyOmitted(nested)) {
      continue;
    }
    Object.defineProperty(output, key, {
      value: cloneValidated(nested, omitUnsupportedObjectProperties),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output as JsonObject;
}

/**
 * 校验并深克隆 JSON-safe 值；结果与输入不共享可变引用。
 * @param value 待克隆值。
 * @param path 错误诊断中的逻辑位置。
 * @param options 可选兼容策略；仅报告入口可显式省略对象字段中的 undefined/function/symbol。
 */
export function cloneJsonValue<T = JsonValue>(
  value: unknown,
  path = "JSON 值",
  options: {
    readonly omitUnsupportedObjectProperties?: boolean;
  } = {},
): T {
  const omitUnsupportedObjectProperties =
    options.omitUnsupportedObjectProperties === true;
  assertJsonValueInternal(
    value,
    path,
    new WeakSet(),
    omitUnsupportedObjectProperties,
  );
  return cloneValidated(
    value as JsonValue,
    omitUnsupportedObjectProperties,
  ) as T;
}

/**
 * 判断两个已校验 JSON 值是否深相等；对象键序无关，数组顺序相关。
 * @param left 左值。
 * @param right 右值。
 */
export function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray !== rightArray) return false;
  if (leftArray && rightArray) {
    return (
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]!))
    );
  }
  const leftRecord = left as JsonObject;
  const rightRecord = right as JsonObject;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        jsonEqual(leftRecord[key]!, rightRecord[key]!),
    )
  );
}

function containsValidated(target: JsonObject, subset: JsonObject): boolean {
  for (const [key, expected] of Object.entries(subset)) {
    if (!Object.hasOwn(target, key)) return false;
    const actual = target[key]!;
    if (isJsonObject(expected)) {
      if (!isJsonObject(actual) || !containsValidated(actual, expected))
        return false;
    } else if (!jsonEqual(actual, expected)) {
      return false;
    }
  }
  return true;
}

/**
 * 判断 target 是否以 own-property 方式包含 subset；对象嵌套递归、数组严格相等。
 * @param target 实际值。
 * @param subset 已校验的期望普通对象。
 */
export function jsonContains(target: unknown, subset: JsonObject): boolean {
  if (
    !isJsonValue(target) ||
    !isJsonValue(subset) ||
    !isJsonObject(target) ||
    !isJsonObject(subset)
  ) {
    return false;
  }
  return containsValidated(target, subset);
}
