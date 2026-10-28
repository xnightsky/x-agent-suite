/**
 * @module @x-agent-suite/recall/resources
 * Recall 场景资源 realpath 校验与隔离工作区物化；不实现执行级 ProvisionPlan。
 * 不变量：source 不越出 rootDir，destination 不越出 sandbox.cwd 的物理子树，禁止覆盖，readOnly 恒 true；
 * 来源树内链接与来源祖先/叶链接一律拒绝（物化前按段 lstat 重验），目标链接拒绝。
 * 前置条件：物化期间调用方独占来源与目标目录树；路径校验不提供原子的并发隔离。
 */
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import type { SandboxContext } from "@x-agent-suite/contracts";
import type { RecallResourceDefinition } from "./schema.ts";
import { isRecord } from "./validation.ts";

/** 已完成 realpath 与类型校验的场景资源。 */
export interface RecallCompiledResource extends RecallResourceDefinition {
  readonly source: string;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel))
  );
}

async function resolveSource(
  source: string,
  rootReal: string,
  filePath: string,
): Promise<string> {
  if (isAbsolute(source)) {
    throw new Error(
      "Recall resource source 必须相对 rootDir：" +
        source +
        "（" +
        filePath +
        "）",
    );
  }
  const lexical = resolve(rootReal, source);
  if (!inside(rootReal, lexical)) {
    throw new Error(
      "Recall resource source 路径逃逸：" + source + "（" + filePath + "）",
    );
  }
  let physical: string;
  try {
    physical = await realpath(lexical);
  } catch (cause) {
    throw new Error("Recall resource source 缺失或不存在：" + source, {
      cause,
    });
  }
  if (!inside(rootReal, physical)) {
    throw new Error(
      "Recall resource source 符号链接逃逸：" + source + "（" + filePath + "）",
    );
  }
  return physical;
}

/**
 * 目录树内不允许符号链接：逐层 lstat，不 follow、不 realpath。
 *
 * @behavior recall-resource-no-nested-symlink
 * Given: 目录资源可能含指向 rootDir 内外的符号链接。
 * When: 编译期 readRecallResources 与物化前 materializeResource 各校验一次。
 * Then: 任一链接条目立即失败并给出相对路径；不做真实路径解析，故永不触碰链接目标。
 *
 * @param root 目录资源物理根。
 * @param at 错误上下文（原始 source）。
 */
async function assertNoSymlinks(root: string, at: string): Promise<void> {
  for (const name of await readdir(root)) {
    const current = join(root, name);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error(
        "Recall resource 目录资源内不支持符号链接：" +
          relative(root, current) +
          "（" +
          at +
          "）；请改用实体文件",
      );
    }
    if (info.isDirectory()) await assertNoSymlinks(current, at);
  }
}

/**
 * 物化前重验来源：compiled.source 是物理绝对路径，逐段 lstat 拒绝任何祖先或叶链接。
 *
 * 不变量：不 realpath、不 follow；祖先被替换成链接时立即失败，避免从沙箱外复制内容。
 *
 * @param source 编译期 realpath 后的来源绝对路径。
 * @param kind 资源类型；叶类型漂移同样失败。
 * @param at 错误上下文（原始 source）。
 */
async function assertPhysicalSource(
  source: string,
  kind: RecallResourceDefinition["kind"],
  at: string,
): Promise<void> {
  const { root } = parse(source);
  const segments = source
    .slice(root.length)
    .split(sep)
    .filter((s) => s !== "");
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    const info = await lstat(current).catch((error: unknown) => {
      if ((error as { code?: string }).code === "ENOENT") {
        throw new Error("Recall resource source 已不存在，拒绝物化：" + at);
      }
      throw error;
    });
    if (info.isSymbolicLink()) {
      throw new Error("Recall resource source 路径含符号链接，拒绝物化：" + at);
    }
    if (current === source) {
      const matches = kind === "directory" ? info.isDirectory() : info.isFile();
      if (!matches) {
        throw new Error("Recall resource source 类型已变更，拒绝物化：" + at);
      }
    }
  }
}

/** 读取并校验一组场景资源；source 的 realpath 与 kind 必须匹配。 */
export async function readRecallResources(
  resources: readonly RecallResourceDefinition[],
  rootDir: string,
  filePath: string,
): Promise<readonly RecallCompiledResource[]> {
  const rootReal = await realpath(rootDir);
  const compiled: RecallCompiledResource[] = [];
  for (const resource of resources) {
    const source = await resolveSource(resource.source, rootReal, filePath);
    const info = await stat(source);
    if (resource.kind === "file" && !info.isFile()) {
      throw new Error("Recall resource 必须是文件：" + resource.source);
    }
    if (resource.kind === "directory" && !info.isDirectory()) {
      throw new Error("Recall resource 必须是目录：" + resource.source);
    }
    if (resource.kind === "directory") {
      await assertNoSymlinks(source, resource.source);
    }
    compiled.push({ ...resource, source });
  }
  return compiled;
}

function destinationPath(sandbox: SandboxContext, destination: string): string {
  const target = resolve(sandbox.cwd, destination);
  if (!inside(sandbox.cwd, target) || target === sandbox.cwd) {
    throw new Error(
      "Recall resource destination 逃逸 sandbox.cwd：" + destination,
    );
  }
  return target;
}

/** 读取 lstat；ENOENT 视为不存在，其余错误显式抛出。 */
async function lstatIfExists(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * 校验目标物理根：sandbox.cwd 必须是真实目录。
 *
 * 不变量：根被替换为符号链接时直接拒绝，绝不 realpath 后把链接目标当作新合法根。
 *
 * @param sandbox 隔离沙箱上下文。
 * @returns 逐字使用的沙箱根路径（不做 realpath）。
 */
async function physicalRoot(sandbox: SandboxContext): Promise<string> {
  const info = await lstat(sandbox.cwd);
  if (info.isSymbolicLink()) {
    throw new Error(
      "Recall resource 目标根是符号链接，拒绝写入：" + sandbox.cwd,
    );
  }
  if (!info.isDirectory()) {
    throw new Error("Recall resource 目标根不是目录，拒绝写入：" + sandbox.cwd);
  }
  return sandbox.cwd;
}

/**
 * 逐段物化目标父目录；任一段是既有符号链接或非目录即拒绝。
 *
 * 不变量：只创建缺失段，创建成功或 EEXIST 后均重验实际节点；调用方须独占目标目录树。
 *
 * @param root 沙箱根（物理路径）。
 * @param destination 目标绝对路径。
 */
async function ensureParentInside(
  root: string,
  destination: string,
): Promise<void> {
  const parent = dirname(destination);
  const nested = relative(root, parent);
  if (nested === "") return;
  let current = root;
  for (const segment of nested.split(sep)) {
    if (segment === "" || segment === ".") continue;
    current = join(current, segment);
    let info = await lstatIfExists(current);
    if (info === undefined) {
      await mkdir(current).catch((error: { code?: string }) => {
        if (error.code !== "EEXIST") throw error;
      });
      info = await lstat(current);
    }
    if (info.isSymbolicLink()) {
      throw new Error(
        "Recall resource destination 父级含符号链接，拒绝写入：" +
          relative(root, current),
      );
    }
    if (!info.isDirectory()) {
      throw new Error(
        "Recall resource destination 父级不是目录，拒绝写入：" +
          relative(root, current),
      );
    }
  }
}

/**
 * 递归把物化结果设为只读；在独占目录树的前提下拒绝符号链接。
 *
 * 不变量：每层 lstat 判定类型（不依赖 Dirent 缓存），目录递归后 0555，普通文件 0444。
 *
 * @param path 物化结果绝对路径。
 */
async function markReadOnly(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new Error("Recall resource 物化结果含符号链接，拒绝 chmod：" + path);
  }
  if (!info.isDirectory()) {
    await chmod(path, 0o444);
    return;
  }
  for (const name of await readdir(path)) {
    await markReadOnly(join(path, name));
  }
  await chmod(path, 0o555);
}

async function materializeResource(
  sandbox: SandboxContext,
  resource: RecallCompiledResource,
): Promise<void> {
  await assertPhysicalSource(resource.source, resource.kind, resource.source);
  if (resource.kind === "directory") {
    await assertNoSymlinks(resource.source, resource.source);
  }
  const root = await physicalRoot(sandbox);
  const destination = destinationPath(sandbox, resource.destination);
  await ensureParentInside(root, destination);
  const existing = await lstatIfExists(destination);
  if (existing !== undefined) {
    throw new Error(
      existing.isSymbolicLink()
        ? "Recall resource destination 是符号链接，拒绝写入：" +
            resource.destination
        : "Recall resource destination 已存在，禁止覆盖：" +
            resource.destination,
    );
  }
  await cp(resource.source, destination, {
    recursive: resource.kind === "directory",
    force: false,
    errorOnExist: true,
  });
  await markReadOnly(destination);
}

async function materializeContextFiles(
  sandbox: SandboxContext,
  files: readonly { path: string; content: string }[],
): Promise<void> {
  const root = await physicalRoot(sandbox);
  for (const file of files) {
    const destination = destinationPath(sandbox, file.path);
    await ensureParentInside(root, destination);
    const existing = await lstatIfExists(destination);
    if (existing !== undefined) {
      throw new Error(
        existing.isSymbolicLink()
          ? "Recall context file 目标是符号链接，拒绝写入：" + file.path
          : "Recall context file 目标已存在，禁止覆盖：" + file.path,
      );
    }
    await writeFile(destination, file.content, { flag: "wx" });
    await chmod(destination, 0o444);
  }
}

/** 将 Recall 编译出的 ScenarioSpec.provision 物化到隔离 cwd；undefined 为无操作。 */
export async function materializeRecallProvision(
  sandbox: SandboxContext,
  provision: unknown,
): Promise<void> {
  if (provision === undefined) return;
  if (!isRecord(provision)) throw new Error("Recall provision 形状非法");
  if (
    typeof provision.plan === "string" &&
    Array.isArray(provision.resources)
  ) {
    for (const resource of provision.resources as readonly RecallCompiledResource[]) {
      await materializeResource(sandbox, resource);
    }
    return;
  }
  if (isRecord(provision.context) && Array.isArray(provision.context.files)) {
    await materializeContextFiles(
      sandbox,
      provision.context.files as readonly { path: string; content: string }[],
    );
    return;
  }
  throw new Error("Recall provision 形状非法，拒绝隐式合并或猜测资源");
}
