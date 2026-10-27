/**
 * @module scripts/run-pi-token-ittest
 * Pi live PTY 的显式 token 入口：解析模型参数并注入 Node 测试子进程。
 * 不变量：模型选择不得依赖 node:test 不透明的尾部参数；未授权仍由测试文件 skip。
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const TEST_FILE = "examples/tutorial/11-pi-live-pty.token.ittest.ts";

/** 测试子进程接收显式模型选择的环境变量名。 */
export const PI_TOKEN_MODEL_ENV = "XAS_TUTORIAL_LIVE_MODEL";

/** 解析 Pi token 入口仅支持的 --model 参数；非法尾部参数显式失败。 */
export function parsePiTokenArgs(argv: readonly string[]): string | undefined {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 0) return undefined;
  const [flag, model, ...rest] = args;
  if (
    flag === "--model" &&
    model &&
    !model.startsWith("--") &&
    rest.length === 0
  ) {
    return model;
  }
  throw new Error(
    "用法：pnpm ittest:token:pi-pty -- [--model <provider/model|模型名>]",
  );
}

/** 启动唯一授权的 Pi token 测试文件并透传退出状态。 */
async function main(): Promise<void> {
  const model = parsePiTokenArgs(process.argv.slice(2));
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", TEST_FILE],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ...(model === undefined ? {} : { [PI_TOKEN_MODEL_ENV]: model }),
      },
      stdio: "inherit",
    },
  );
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
  process.exitCode = exitCode;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
