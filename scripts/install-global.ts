#!/usr/bin/env node
/**
 * @module scripts/install-global
 * 从指定正式制品集校验并全局安装核心 CLI，不构建、不发布、不初始化用户配置。
 * 不变量：全部校验完成前不调用包管理器；不安装 PTY，不执行依赖生命周期脚本。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface CoreArtifact {
  readonly version: string;
  readonly file: string;
  readonly sha256: string;
}

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

/** 校验正式清单、路径边界和核心制品的双重 SHA-256，不执行安装或发布。 */
export async function verifyCoreArtifact(
  directory: string,
): Promise<CoreArtifact & { path: string }> {
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
  return { ...core, path };
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
    `[install:global] 已全局安装 x-agent-suite@${core.version}；请确认 pnpm 全局 bin 已加入 PATH`,
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
