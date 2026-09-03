/**
 * @module @x-agent-suite/sandbox/create
 * createSandbox：为单个 harness 创建隔离沙箱。
 *
 * 流程：
 * 1. mkdtemp 生成 homeDir / cwd；
 * 2. 按需创建 configDirs 与 runtimeDir，均位于 homeDir 下；
 * 3. 合并 process.env 与调用方 env；
 * 4. 剥离内置代理变量与 stripEnv 声明的变量；
 * 5. 最后设置 HOME，win32 额外设置 USERPROFILE / APPDATA / LOCALAPPDATA。
 *
 * 代理变量剥离是硬要求：部分 CLI 会把对本地端点的请求发往 http_proxy。
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  CreateSandboxOptions,
  SandboxContext,
} from "@x-agent-suite/contracts";

/** 所有 harness 一律剥离的代理变量（各 CLI 对 no_proxy 解析不一致，剥离比设 no_proxy 可靠）。 */
const PROXY_ENV_VARS = [
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
] as const;

/** 校验并解析位于 root 下的单个安全路径段。 */
function resolveSafeConfigDir(root: string, name: string): string {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("\0") ||
    name.includes("/") ||
    name.includes("\\") ||
    isAbsolute(name)
  ) {
    throw new Error(`configDirs 必须是安全路径段：${JSON.stringify(name)}`);
  }
  const target = resolve(root, name);
  const nested = relative(root, target);
  if (
    !nested ||
    nested === ".." ||
    nested.startsWith(`..${sep}`) ||
    isAbsolute(nested)
  ) {
    throw new Error(`configDirs 路径逃逸 sandbox home：${name}`);
  }
  return target;
}

/**
 * 创建一个隔离沙箱。
 *
 * @param options 剥离清单、注入环境与按需目录开关。
 * @returns 沙箱上下文；调用方负责在结束后 cleanupSandbox。
 */
export async function createSandbox(
  options: CreateSandboxOptions = {},
): Promise<SandboxContext> {
  const configDirNames = options.configDirs ?? [];
  for (const name of configDirNames) {
    resolveSafeConfigDir(tmpdir(), name);
  }

  const id = randomUUID();
  const homeDir = await mkdtemp(join(tmpdir(), `xas-sandbox-home-${id}-`));
  const cwd = await mkdtemp(join(tmpdir(), `xas-sandbox-cwd-${id}-`));

  const configDirs: Record<string, string> = {};
  if (configDirNames.length > 0) {
    for (const name of configDirNames) {
      const dir = resolveSafeConfigDir(homeDir, name);
      await mkdir(dir, { recursive: true });
      configDirs[name] = dir;
    }
  }

  let runtimeDir: string | undefined;
  if (options.runtimeDir) {
    runtimeDir = join(homeDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...options.env,
  };
  for (const name of PROXY_ENV_VARS) delete env[name];
  for (const name of options.stripEnv ?? []) delete env[name];
  env.HOME = homeDir;
  if (process.platform === "win32") {
    env.USERPROFILE = homeDir;
    env.APPDATA = join(homeDir, "AppData", "Roaming");
    env.LOCALAPPDATA = join(homeDir, "AppData", "Local");
  }
  let configFilePath: string | undefined;
  if (options.configFile) {
    configFilePath = join(homeDir, "config.json");
    await writeFile(configFilePath, "");
  }

  return {
    homeDir,
    cwd,
    configDirs: Object.keys(configDirs).length > 0 ? configDirs : undefined,
    configFilePath,
    runtimeDir,
    env,
    id,
  };
}
