/**
 * @module @x-agent-suite/recall/resources
 * Recall 场景资源 realpath 校验与隔离工作区物化；不实现执行级 ProvisionPlan。
 * 不变量：source 不越出 rootDir，destination 不越出 sandbox.cwd，禁止覆盖，readOnly 恒 true。
 */
import {
  chmod,
  cp,
  mkdir,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
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

async function markReadOnly(path: string, directory: boolean): Promise<void> {
  if (!directory) {
    await chmod(path, 0o444);
    return;
  }
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    await markReadOnly(resolve(path, entry.name), entry.isDirectory());
  }
  await chmod(path, 0o555);
}

async function materializeResource(
  sandbox: SandboxContext,
  resource: RecallCompiledResource,
): Promise<void> {
  const destination = destinationPath(sandbox, resource.destination);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await cp(resource.source, destination, {
    recursive: resource.kind === "directory",
    force: false,
    errorOnExist: true,
  });
  await markReadOnly(destination, resource.kind === "directory");
}

async function materializeContextFiles(
  sandbox: SandboxContext,
  files: readonly { path: string; content: string }[],
): Promise<void> {
  for (const file of files) {
    const destination = destinationPath(sandbox, file.path);
    await mkdir(resolve(destination, ".."), { recursive: true });
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
