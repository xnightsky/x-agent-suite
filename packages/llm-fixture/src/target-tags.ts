/**
 * @module @x-agent-suite/llm-fixture/target-tags
 * TargetTags 词典与四层实例 YAML 的加载、校验和引用归一。
 * 不变量：只读包元数据、标签及显式传入的私密覆盖，不发现凭据、不发起网络请求。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { TargetTagDefinitionError } from "./target-tag-error.ts";
import { defaultTagRoot } from "./target-tag-root.ts";
import type {
  LoadTargetTagCatalogOptions,
  ModelTags,
  ProviderModelTags,
  ProviderTags,
  CliTags,
  TargetTagCatalog,
  TargetTagDictionary,
  TargetTagInstances,
  TargetTagKey,
  TargetTagScope,
  TargetTagStatus,
} from "./target-tag-types.ts";

/** 默认词典相对路径。 */
export const TARGET_TAG_DICTIONARY_FILE = "config/target-tags/keys.yaml";

/** 默认真实实例相对路径。 */
export const TARGET_TAG_INSTANCES_FILE = "config/target-tags/instances.yaml";

/** home 级私有全局实例文件名。 */
export const TARGET_TAG_GLOBAL_INSTANCES_FILE =
  ".env.target-tags.instances.yaml";

export { TargetTagDefinitionError } from "./target-tag-error.ts";

function fail(message: string): never {
  throw new TargetTagDefinitionError(message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path + " 必须是对象");
  }
  return value as Record<string, unknown>;
}

function parseRoot(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    throw new TargetTagDefinitionError("TargetTags YAML 解析失败");
  }
  return asRecord(parsed, "TargetTags 文档");
}

function assertKnownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(path + " 含未知字段：" + unknown.join(", "));
  }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path + " 必须是非空字符串");
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, path);
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail(path + " 必须是字符串数组");
  return value.map((item, index) =>
    requiredString(item, path + "[" + index + "]"),
  );
}

function assertVersion(record: Record<string, unknown>): void {
  if (record.version !== 1) fail("TargetTags version 必须为 1");
}

function assertUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) fail(path + " 不得重复");
}

function parseScope(value: unknown): TargetTagScope {
  const scope = requiredString(value, "TagKey.scope");
  if (!["cli", "provider", "provider-model", "model"].includes(scope)) {
    fail("未知 TagKey scope：" + scope);
  }
  return scope as TargetTagScope;
}

function parseStatus(value: unknown): TargetTagStatus {
  const status = requiredString(value, "TagKey.status");
  if (!["maintained", "reserved", "deprecated"].includes(status)) {
    fail("未知 TagKey status：" + status);
  }
  return status as TargetTagStatus;
}

function parseDictionaryKey(value: unknown, index: number): TargetTagKey {
  const path = "keys[" + index + "]";
  const record = asRecord(value, path);
  assertKnownFields(
    record,
    ["key", "scope", "dimension", "status", "values"],
    path,
  );
  const scope = parseScope(record.scope);
  const dimension = requiredString(record.dimension, path + ".dimension");
  const key = requiredString(record.key, path + ".key");
  if (key !== scope + "." + dimension) {
    fail(path + ".key 必须等于 scope.dimension");
  }
  const status = parseStatus(record.status);
  const values = stringArray(record.values, path + ".values");
  assertUnique(values, path + ".values");
  if (status === "maintained" && values.length === 0) {
    fail(path + " maintained key 至少需要一个 value");
  }
  if (status === "reserved" && values.length > 0) {
    fail(path + " reserved key 不得定义 value");
  }
  return { key, scope, dimension, status, values };
}

/** 解析并校验 TagKey/TagValue 词典 YAML。 */
export function parseTargetTagDictionary(text: string): TargetTagDictionary {
  const record = parseRoot(text);
  assertKnownFields(record, ["version", "rules", "keys"], "词典");
  assertVersion(record);
  if (record.rules !== undefined) asRecord(record.rules, "词典.rules");
  if (!Array.isArray(record.keys)) fail("词典.keys 必须是数组");
  const keys = record.keys.map(parseDictionaryKey);
  assertUnique(
    keys.map(({ key }) => key),
    "词典.keys",
  );
  return { version: 1, keys };
}

/** 校验 TagId 已注册、属于预期作用域且为维护状态。 */
export function assertTargetTagId(
  dictionary: TargetTagDictionary,
  tagId: string,
  expectedScope?: TargetTagScope,
): void {
  const entry = dictionary.keys.find(
    ({ key }) => tagId === key || tagId.startsWith(key + "."),
  );
  if (!entry) fail("未注册 TargetTag：" + tagId);
  if (expectedScope && entry.scope !== expectedScope) {
    fail("TargetTag 作用域错配：" + tagId + " 不能用于 " + expectedScope);
  }
  if (entry.status !== "maintained") {
    fail("TargetTag key 为 " + entry.status + "，不能产生能力：" + tagId);
  }
  const value = tagId.slice(entry.key.length + 1);
  if (!entry.values.includes(value)) {
    fail("TargetTag value 未注册：" + tagId);
  }
}

function parseTags(
  value: unknown,
  dictionary: TargetTagDictionary,
  scope: TargetTagScope,
  path: string,
): readonly string[] {
  const tags = stringArray(value, path);
  assertUnique(tags, path);
  for (const tag of tags) assertTargetTagId(dictionary, tag, scope);
  return tags;
}

function parseCli(
  value: unknown,
  index: number,
  dictionary: TargetTagDictionary,
): CliTags {
  const path = "cli[" + index + "]";
  const record = asRecord(value, path);
  assertKnownFields(record, ["id", "carrier", "wires", "tags"], path);
  return {
    id: requiredString(record.id, path + ".id"),
    carrier: requiredString(record.carrier, path + ".carrier"),
    wires: stringArray(record.wires, path + ".wires"),
    tags: parseTags(record.tags, dictionary, "cli", path + ".tags"),
  };
}

function parseProvider(
  value: unknown,
  index: number,
  dictionary: TargetTagDictionary,
): ProviderTags {
  const path = "providers[" + index + "]";
  const record = asRecord(value, path);
  assertKnownFields(record, ["id", "tags"], path);
  return {
    id: requiredString(record.id, path + ".id"),
    tags: parseTags(record.tags, dictionary, "provider", path + ".tags"),
  };
}

function parseProviderModel(
  value: unknown,
  index: number,
  dictionary: TargetTagDictionary,
): ProviderModelTags {
  const path = "providerModels[" + index + "]";
  const record = asRecord(value, path);
  assertKnownFields(
    record,
    ["id", "providerRef", "model", "modelRef", "modelRevision", "wire", "tags"],
    path,
  );
  return {
    id: requiredString(record.id, path + ".id"),
    providerRef: requiredString(record.providerRef, path + ".providerRef"),
    model: requiredString(record.model, path + ".model"),
    modelRef: optionalString(record.modelRef, path + ".modelRef"),
    modelRevision: optionalString(
      record.modelRevision,
      path + ".modelRevision",
    ),
    wire: optionalString(record.wire, path + ".wire"),
    tags: parseTags(record.tags, dictionary, "provider-model", path + ".tags"),
  };
}

function parseModel(
  value: unknown,
  index: number,
  dictionary: TargetTagDictionary,
): ModelTags {
  const path = "models[" + index + "]";
  const record = asRecord(value, path);
  assertKnownFields(record, ["id", "revision", "tags"], path);
  return {
    id: requiredString(record.id, path + ".id"),
    revision: optionalString(record.revision, path + ".revision"),
    tags: parseTags(record.tags, dictionary, "model", path + ".tags"),
  };
}

function parseSection<T>(
  value: unknown,
  path: string,
  parse: (value: unknown, index: number) => T,
): readonly T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path + " 必须是数组");
  return value.map(parse);
}

function validateReferences(instances: TargetTagInstances): void {
  const providers = new Set(instances.providers.map(({ id }) => id));
  const providerModels = new Set<string>();
  for (const instance of instances.providerModels) {
    if (!providers.has(instance.providerRef)) {
      fail(instance.id + " 的 providerRef 引用不存在：" + instance.providerRef);
    }
    if (instance.modelRevision && !instance.modelRef) {
      fail(instance.id + " 的 modelRevision 依赖 modelRef");
    }
    if (
      instance.modelRef &&
      !instances.models.some(
        (model) =>
          model.id === instance.modelRef &&
          model.revision === instance.modelRevision,
      )
    ) {
      fail(
        instance.id + " 的 modelRef/revision 引用不存在：" + instance.modelRef,
      );
    }
    const identity = [
      instance.providerRef,
      instance.model,
      instance.wire ?? "",
    ].join("\0");
    if (providerModels.has(identity)) {
      fail(instance.id + " 与既有 ProviderModelTags 身份重复");
    }
    providerModels.add(identity);
  }
}

function assertInstanceIds(instances: TargetTagInstances): void {
  assertUnique(
    instances.cli.map(({ id }) => id),
    "cli.id",
  );
  assertUnique(
    instances.providers.map(({ id }) => id),
    "providers.id",
  );
  assertUnique(
    instances.providerModels.map(({ id }) => id),
    "providerModels.id",
  );
  assertUnique(
    instances.models.map(({ id, revision }) => id + "\0" + (revision ?? "")),
    "models.id/revision",
  );
}

function parseInstanceRecord(
  record: Record<string, unknown>,
  dictionary: TargetTagDictionary,
): TargetTagInstances {
  assertKnownFields(
    record,
    ["version", "cli", "providers", "providerModels", "models"],
    "实例",
  );
  assertVersion(record);
  const instances: TargetTagInstances = {
    cli: parseSection(record.cli, "cli", (value, index) =>
      parseCli(value, index, dictionary),
    ),
    providers: parseSection(record.providers, "providers", (value, index) =>
      parseProvider(value, index, dictionary),
    ),
    providerModels: parseSection(
      record.providerModels,
      "providerModels",
      (value, index) => parseProviderModel(value, index, dictionary),
    ),
    models: parseSection(record.models, "models", (value, index) =>
      parseModel(value, index, dictionary),
    ),
  };
  assertInstanceIds(instances);
  return instances;
}

/** 解析并校验四层实例 YAML，同时检查词典、引用与身份唯一性。 */
export function parseTargetTagInstances(
  text: string,
  dictionary: TargetTagDictionary,
): TargetTagInstances {
  const instances = parseInstanceRecord(parseRoot(text), dictionary);
  validateReferences(instances);
  return instances;
}

async function readTagFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new TargetTagDefinitionError("无法读取 TargetTags 文件：" + path, {
      cause: error,
    });
  }
}
function mergeByKey<T extends { readonly tags: readonly string[] }>(
  base: readonly T[],
  overlay: readonly T[],
  keyOf: (item: T) => string,
): readonly T[] {
  const merged = new Map(base.map((item) => [keyOf(item), item]));
  for (const item of overlay) {
    const key = keyOf(item);
    const existing = merged.get(key);
    const defined = Object.fromEntries(
      Object.entries(item).filter(([, value]) => value !== undefined),
    ) as T;
    merged.set(
      key,
      existing
        ? {
            ...existing,
            ...defined,
            tags: [...new Set([...existing.tags, ...item.tags])],
          }
        : item,
    );
  }
  return [...merged.values()];
}

function mergeInstances(
  base: TargetTagInstances,
  overlay: TargetTagInstances,
): TargetTagInstances {
  const merged: TargetTagInstances = {
    cli: mergeByKey(base.cli, overlay.cli, ({ id }) => id),
    providers: mergeByKey(base.providers, overlay.providers, ({ id }) => id),
    providerModels: mergeByKey(
      base.providerModels,
      overlay.providerModels,
      ({ id }) => id,
    ),
    models: mergeByKey(base.models, overlay.models, ({ id, revision }) =>
      JSON.stringify([id, revision ?? ""]),
    ),
  };
  assertInstanceIds(merged);
  validateReferences(merged);
  return merged;
}

/** 读取 home 私有全局实例；文件不存在时跳过，其他错误显式失败。 */
async function readGlobalInstances(
  path: string,
  dictionary: TargetTagDictionary,
): Promise<TargetTagInstances | undefined> {
  try {
    return parseTargetTagInstances(await readTagFile(path), dictionary);
  } catch (error) {
    if (
      error instanceof TargetTagDefinitionError &&
      (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

async function readPrivateOverlay(
  path: string,
  dictionary: TargetTagDictionary,
): Promise<TargetTagInstances | undefined> {
  const document = parseRoot(await readTagFile(path));
  if (document.targetTags === undefined) return undefined;
  return parseInstanceRecord(
    asRecord(document.targetTags, "live.targetTags"),
    dictionary,
  );
}

/**
 * 加载公共标签并合并 home/live 私有实例，格式或文件错误显式抛出。
 * 显式文件路径优先，其次 repoRoot；缺省定位源码或制品所属包根，不依赖消费者 cwd。
 */
export async function loadTargetTagCatalog(
  options: LoadTargetTagCatalogOptions = {},
): Promise<TargetTagCatalog> {
  const repoRoot = options.repoRoot ?? (await defaultTagRoot());
  const dictionaryPath =
    options.dictionaryPath ?? join(repoRoot, TARGET_TAG_DICTIONARY_FILE);
  const instancesPath =
    options.instancesPath ?? join(repoRoot, TARGET_TAG_INSTANCES_FILE);
  const [dictionaryText, instancesText] = await Promise.all([
    readTagFile(dictionaryPath),
    readTagFile(instancesPath),
  ]);
  const dictionary = parseTargetTagDictionary(dictionaryText);
  let instances = parseTargetTagInstances(instancesText, dictionary);
  const homeDir = options.homeDir ?? homedir();
  const globalInstances = await readGlobalInstances(
    join(homeDir, TARGET_TAG_GLOBAL_INSTANCES_FILE),
    dictionary,
  );
  if (globalInstances) instances = mergeInstances(instances, globalInstances);
  if (options.liveConfig?.kind === "loaded") {
    const overlay = await readPrivateOverlay(
      options.liveConfig.path,
      dictionary,
    );
    if (overlay) instances = mergeInstances(instances, overlay);
  }
  return { dictionary, instances };
}
