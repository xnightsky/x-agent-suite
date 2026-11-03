#!/usr/bin/env node
/**
 * @module scripts/install-global
 * 从指定正式制品集校验并全局安装核心 CLI，不构建、不发布、不初始化用户配置。
 * 不变量：全部校验（含 tarball 内唯一 package.json 身份）完成前不调用包管理器；
 * 不安装 PTY，不执行依赖生命周期脚本。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { CORE_BIN_NAME, CORE_PACKAGE_NAME } from "./artifacts-package.ts";

interface CoreArtifact {
  readonly version: string;
  readonly file: string;
  readonly sha256: string;
}

/** tarball 内 package.json 的最小身份字段。 */
export interface TarballPackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly bin?: Readonly<Record<string, string>>;
}

/** 通过全部校验后的核心制品。 */
export interface VerifiedCoreArtifact extends CoreArtifact {
  readonly path: string;
  readonly packageIdentity: TarballPackageIdentity;
}

const TAR_BLOCK_SIZE = 512;
const PACKAGE_JSON_ENTRY = "package/package.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseCoreArtifact(value: unknown): CoreArtifact {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    value.dirty !== false ||
    value.validationOnly !== undefined ||
    !["stable", "snapshot"].includes(String(value.mode)) ||
    typeof value.commit !== "string" ||
    !/^[a-f\d]{40}$/i.test(value.commit) ||
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(value.version) ||
    !Array.isArray(value.artifacts)
  ) {
    throw new Error("非法或非正式制品清单；需要干净提交产生的 schema v2 制品");
  }
  const cores = value.artifacts.filter(
    (item) => isRecord(item) && item.kind === "core",
  );
  if (cores.length !== 1) throw new Error("制品清单必须恰含一个 core");
  const core: unknown = cores[0];
  if (
    !isRecord(core) ||
    core.file !== `x-agent-suite-${value.version}.tgz` ||
    typeof core.sha256 !== "string" ||
    !/^[a-f\d]{64}$/i.test(core.sha256)
  ) {
    throw new Error("制品清单 core 文件名或 SHA-256 非法");
  }
  return {
    version: value.version,
    file: String(core.file),
    sha256: core.sha256.toLowerCase(),
  };
}

function parseChecksums(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of source.split(/\r?\n/).filter(Boolean)) {
    // 只接受 basename，拒绝路径逃逸、空白歧义与重复项。
    const match = /^([a-f\d]{64})  ([\w.+-]+)$/i.exec(line);
    if (!match || result.has(match[2]!))
      throw new Error("SHA256SUMS 存在非法或重复校验和项");
    result.set(match[2]!, match[1]!.toLowerCase());
  }
  return result;
}

async function artifactPath(directory: string, file: string): Promise<string> {
  const path = await realpath(join(directory, file));
  if (dirname(path) !== directory)
    throw new Error("文件不得通过符号链接越出制品目录");
  return path;
}

function assertChecksum(
  content: Uint8Array,
  expected: string | undefined,
  file: string,
): void {
  const actual = createHash("sha256").update(content).digest("hex");
  if (expected !== actual) throw new Error(`制品校验和不匹配或缺失：${file}`);
}

function readTarString(
  block: Uint8Array,
  offset: number,
  length: number,
): string {
  const raw = Buffer.from(block.subarray(offset, offset + length));
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul === -1 ? raw.length : nul).toString("utf8");
}

function parseTarNumber(
  block: Uint8Array,
  offset: number,
  length: number,
): number {
  const raw = readTarString(block, offset, length).trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) {
    throw new Error("tarball header 包含非八进制数字字段");
  }
  return Number.parseInt(raw, 8);
}

function assertTarHeaderChecksum(block: Uint8Array): void {
  const expected = parseTarNumber(block, 148, 8);
  let actual = 0;
  for (let index = 0; index < block.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : block[index]!;
  }
  if (actual !== expected) {
    throw new Error("tarball header checksum 不匹配");
  }
}

function normalizeTarPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) {
    throw new Error(`tarball entry 不允许绝对路径：${path}`);
  }
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error(`tarball entry 逃逸解包根：${path}`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

type TarExtensionSource = "pax" | "gnu" | "global";

interface PaxMetadata {
  readonly path?: string;
  readonly size?: number;
}

function isLayoutPaxKey(key: string): boolean {
  return (
    key === "linkpath" ||
    key === "GNU.sparse" ||
    key.startsWith("GNU.sparse.") ||
    key === "SCHILY.realsize" ||
    key === "SCHILY.sparse" ||
    key.startsWith("SCHILY.sparse.")
  );
}

/** 按 PAX 长度前缀完整解析记录；布局扩展、重复/非法字段或格式损坏一律失败。 */
function parsePaxMetadata(content: Buffer): PaxMetadata {
  let offset = 0;
  let path: string | undefined;
  let size: number | undefined;
  let pathCount = 0;
  let sizeCount = 0;

  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    if (space <= offset) {
      throw new Error("tarball PAX 记录缺少长度分隔");
    }
    const lengthText = content.subarray(offset, space).toString("ascii");
    if (!/^[1-9]\d*$/.test(lengthText)) {
      throw new Error("tarball PAX 记录长度非法");
    }
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length > content.length - offset) {
      throw new Error("tarball PAX 记录长度越界");
    }
    const end = offset + length;
    if (end <= space + 1 || content[end - 1] !== 0x0a) {
      throw new Error("tarball PAX 记录必须完整并以换行结束");
    }
    const body = content.subarray(space + 1, end - 1).toString("utf8");
    const equals = body.indexOf("=");
    if (equals <= 0) {
      throw new Error("tarball PAX 记录缺少 key=value");
    }
    const key = body.slice(0, equals);
    const value = body.slice(equals + 1);
    if (isLayoutPaxKey(key)) {
      throw new Error(`tarball PAX 布局扩展 ${key} 不受支持`);
    }
    if (key === "path") {
      pathCount += 1;
      if (pathCount > 1) {
        throw new Error("PAX 扩展头包含多个 path 字段");
      }
      if (!value) {
        throw new Error("PAX path 不得为空");
      }
      path = value;
    } else if (key === "size") {
      sizeCount += 1;
      if (sizeCount > 1) {
        throw new Error("PAX 扩展头包含多个 size 字段");
      }
      if (!/^\d+$/.test(value)) {
        throw new Error("PAX size 必须是非负十进制整数");
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error("PAX size 超出安全整数范围");
      }
      size = parsed;
    }
    offset = end;
  }
  if (offset !== content.length) {
    throw new Error("tarball PAX 记录未完整消费");
  }
  return {
    ...(path === undefined ? {} : { path }),
    ...(size === undefined ? {} : { size }),
  };
}

/**
 * 完整扫描 tar；目标 entry 必须唯一且为普通文件，扩展头歧义一律拒绝。
 * 结束规则为连续两个全零块或 EOF；单个零块后仍有非零 header 必须失败。
 */
function readTarEntry(archive: Buffer, target: string): Buffer | null {
  let offset = 0;
  let pendingPath: string | undefined;
  let pendingSize: number | undefined;
  let pendingExtension: TarExtensionSource | undefined;
  let found: Buffer | null = null;
  while (offset + TAR_BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) {
      const nextOffset = offset + TAR_BLOCK_SIZE;
      if (nextOffset >= archive.length) break;
      const nextBlock = archive.subarray(
        nextOffset,
        Math.min(nextOffset + TAR_BLOCK_SIZE, archive.length),
      );
      if (nextBlock.length < TAR_BLOCK_SIZE) {
        if (nextBlock.every((byte) => byte === 0)) break;
        throw new Error("tarball 单个结束零块后存在截断数据");
      }
      if (!nextBlock.every((byte) => byte === 0)) {
        throw new Error("tarball 单个结束零块后仍有非零 header");
      }
      break;
    }
    assertTarHeaderChecksum(header);

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const typeFlag =
      header[156] === 0 ? "\0" : String.fromCharCode(header[156]!);
    const size = parseTarNumber(header, 124, 12);
    const effectiveSize = pendingSize ?? size;
    const dataStart = offset + TAR_BLOCK_SIZE;
    const dataEnd = dataStart + effectiveSize;
    if (dataEnd > archive.length) {
      throw new Error("tarball entry 长度越出文件末尾");
    }
    const logicalPath = normalizeTarPath(prefix ? `${prefix}/${name}` : name);
    const entryPath = pendingPath ?? logicalPath;
    const content = archive.subarray(dataStart, dataEnd);

    if (typeFlag === "S" || typeFlag === "s" || typeFlag === "K") {
      throw new Error(`tarball 布局扩展 header type ${typeFlag} 不受支持`);
    }
    if (typeFlag === "x") {
      if (pendingExtension !== undefined) {
        throw new Error("tarball 连续扩展头存在歧义，拒绝 PAX/GNU 混用");
      }
      const metadata = parsePaxMetadata(content);
      pendingExtension = "pax";
      if (metadata.path !== undefined) {
        pendingPath = normalizeTarPath(metadata.path);
      }
      pendingSize = metadata.size;
    } else if (typeFlag === "g") {
      if (pendingExtension !== undefined) {
        throw new Error("tarball 连续扩展头存在歧义，拒绝 PAX/GNU 混用");
      }
      const metadata = parsePaxMetadata(content);
      if (metadata.path !== undefined || metadata.size !== undefined) {
        throw new Error("PAX global header 不允许 path/size 布局覆盖");
      }
      pendingExtension = "global";
    } else if (typeFlag === "L") {
      if (pendingExtension !== undefined) {
        throw new Error("tarball 连续扩展头存在歧义，拒绝 PAX/GNU 混用");
      }
      const longName = content.toString("utf8").replace(/\0+$/u, "");
      if (!longName) {
        throw new Error("GNU longname path 不得为空");
      }
      pendingExtension = "gnu";
      pendingPath = normalizeTarPath(longName);
      pendingSize = undefined;
    } else {
      pendingExtension = undefined;
      pendingPath = undefined;
      pendingSize = undefined;
      if (entryPath === target) {
        if (typeFlag !== "0" && typeFlag !== "\0") {
          throw new Error(`tarball 目标 ${target} 不是普通文件，拒绝歧义条目`);
        }
        if (found !== null) {
          throw new Error(`tarball 包含重复 entry：${target}`);
        }
        found = Buffer.from(content);
      }
    }

    offset =
      dataStart + Math.ceil(effectiveSize / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }
  return found;
}

/** 读取 tarball 内 package/package.json 的最小身份字段，不执行安装或解压整包。 */
export async function readTarballPackageIdentity(
  tarballPath: string,
): Promise<TarballPackageIdentity> {
  let archive: Buffer;
  try {
    archive = gunzipSync(await readFile(tarballPath));
  } catch (error) {
    throw new Error(
      `无法读取 tarball：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const packageJson = readTarEntry(archive, PACKAGE_JSON_ENTRY);
  if (!packageJson) throw new Error("tarball 缺少 package/package.json");

  let value: unknown;
  try {
    value = JSON.parse(packageJson.toString("utf8"));
  } catch (error) {
    throw new Error(
      `tarball 内 package/package.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    typeof value.version !== "string" ||
    !value.version.trim()
  ) {
    throw new Error("tarball 内 package/package.json 缺少有效 name/version");
  }
  if (value.private !== undefined && typeof value.private !== "boolean") {
    throw new Error("tarball 内 package/package.json 的 private 必须是布尔值");
  }
  let bin: Readonly<Record<string, string>> | undefined;
  if (value.bin !== undefined) {
    if (!isRecord(value.bin)) {
      throw new Error("tarball 内 package/package.json 的 bin 必须是对象");
    }
    const entries = Object.entries(value.bin);
    if (!entries.every(([, target]) => typeof target === "string")) {
      throw new Error(
        "tarball 内 package/package.json 的 bin 必须全部为字符串",
      );
    }
    bin = Object.fromEntries(entries) as Readonly<Record<string, string>>;
  }
  return {
    name: value.name,
    version: value.version,
    ...(typeof value.private === "boolean" ? { private: value.private } : {}),
    ...(bin ? { bin } : {}),
  };
}

/** 校验 tarball 内包 identity 与 manifest 版本、公开属性及 CLI bin 一致。 */
export function assertCorePackageIdentity(
  identity: TarballPackageIdentity,
  expectedVersion: string,
): void {
  if (identity.name !== CORE_PACKAGE_NAME) {
    throw new Error("tarball 内包名不是核心主包");
  }
  if (identity.version !== expectedVersion) {
    throw new Error("tarball 内版本与清单不一致");
  }
  if (identity.private === true) {
    throw new Error("tarball 内核心包不得为 private");
  }
  const binPath = identity.bin?.[CORE_BIN_NAME];
  if (typeof binPath !== "string" || !binPath.trim()) {
    throw new Error(`tarball 内缺少 ${CORE_BIN_NAME} bin`);
  }
}

/** 校验正式清单、路径边界、核心制品双重 SHA-256 与 tar 内包身份，不执行安装或发布。 */
export async function verifyCoreArtifact(
  directory: string,
): Promise<VerifiedCoreArtifact> {
  const root = await realpath(directory);
  const sums = parseChecksums(
    await readFile(await artifactPath(root, "SHA256SUMS"), "utf8"),
  );
  const manifest = await readFile(await artifactPath(root, "manifest.json"));
  assertChecksum(manifest, sums.get("manifest.json"), "manifest.json");
  const core = parseCoreArtifact(JSON.parse(manifest.toString("utf8")));
  if (sums.get(core.file) !== core.sha256)
    throw new Error("core 的双重校验和不一致");
  const path = await artifactPath(root, core.file);
  assertChecksum(await readFile(path), core.sha256, core.file);
  const packageIdentity = await readTarballPackageIdentity(path);
  assertCorePackageIdentity(packageIdentity, core.version);
  return { ...core, path, packageIdentity };
}

function installCore(tarball: string): void {
  const execPath = process.env.npm_execpath;
  const viaPnpm = execPath !== undefined && /[/\\]pnpm\.c?js$/i.test(execPath);
  const args = ["add", "--global", "--ignore-scripts", tarball];
  // pnpm run 提供真实 JS 入口，避免 Windows .cmd 和 shell 插值处理制品路径。
  if (!viaPnpm && process.platform === "win32") {
    throw new Error(
      "Windows 请通过 pnpm run install:global 调用，以无 shell 方式启动 pnpm",
    );
  }
  execFileSync(
    viaPnpm ? process.execPath : "pnpm",
    viaPnpm ? [execPath, ...args] : args,
    {
      stdio: "inherit",
    },
  );
}

/**
 * 校验显式制品集并安装核心 CLI；install 仅为测试替换安装副作用。
 * 参数仅接受一个目录（兼容 package script 的分隔符 --）；任何失败均抛出，
 * 成功后才打印版本。实际全局目录由 pnpm 配置决定，不自动修改 PATH/home。
 */
export async function installGlobal(
  argv: readonly string[],
  install: (tarball: string) => void = installCore,
): Promise<void> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length !== 1 || !args[0]?.trim() || args[0].startsWith("-")) {
    throw new Error("用法：pnpm run install:global -- <正式制品目录>");
  }
  const core = await verifyCoreArtifact(resolve(args[0]));
  install(core.path);
  console.log(
    `[install:global] 已全局安装 ${CORE_PACKAGE_NAME}@${core.version}；请确认 pnpm 全局 bin 已加入 PATH`,
  );
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  installGlobal(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
