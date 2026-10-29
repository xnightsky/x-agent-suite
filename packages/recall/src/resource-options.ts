/**
 * @module @x-agent-suite/recall/resource-options
 * 资源声明与直接物化共用的安装开关、目标路径校验。
 * 不变量：禁用项没有目标路径；启用项目标只能相对隔离工作区。
 */
import { posix } from "node:path";
import { isRecord, requiredString } from "./validation.ts";

/** 校验安装开关及字段互斥；启用时收窄为旧声明或显式 true。 */
export function shouldInstallRecallResource<T>(
  resource: T,
): resource is T & { readonly install?: true } {
  if (!isRecord(resource)) throw new Error("Recall resource 必须是对象");
  if (resource.install !== undefined && typeof resource.install !== "boolean") {
    throw new Error("Recall resource install 必须是布尔值");
  }
  if (resource.install === false && "destination" in resource) {
    throw new Error("Recall resource install=false 时禁止 destination");
  }
  return resource.install !== false;
}

/** 归一化相对工作区的资源目标；拒绝主目录简写、绝对路径及逃逸。 */
export function normalizeResourceDestination(value: unknown): string {
  const raw = requiredString(value, "Recall resource destination");
  if (raw.includes("\0") || /^[a-zA-Z]:/.test(raw)) {
    throw new Error("Recall resource 含非法 destination：" + raw);
  }
  const portable = raw.split("\\").join("/");
  const normalized = posix.normalize(portable);
  if (
    /^~(?:\/|$)/.test(portable) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^~(?:\/|$)/.test(normalized)
  ) {
    throw new Error("Recall resource destination 必须相对隔离工作区：" + raw);
  }
  return normalized;
}
