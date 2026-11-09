/** 统一 CLI 子进程测试工具：本地 Node/tsx 入口并隔离 HOME，不经包管理器联网安装。 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** 一次统一 CLI 子进程的退出与输出。 */
export interface OfficialCliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** 运行官方 packaging/cli.ts recall；仅用于零 token 的 *.test.ts。 */
export async function runOfficialCli(
  args: readonly string[],
  options: {
    readonly homeDir: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly onStdout?: (chunk: string) => void;
    readonly onStderr?: (chunk: string) => void;
  },
): Promise<OfficialCliResult> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "packaging/cli.ts", "recall", ...args],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOME: options.homeDir,
        USERPROFILE: options.homeDir,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    options.onStdout?.(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    options.onStderr?.(chunk);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout, stderr };
}
