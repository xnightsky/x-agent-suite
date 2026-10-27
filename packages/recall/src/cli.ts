/**
 * @module @x-agent-suite/recall/cli
 * recall 子命令：定义/用法错误 2，基础设施失败 1，行为结论不改变退出码。
 */
import { runRecall } from "./run.ts";

interface RecallArguments {
  readonly configPath?: string;
  readonly target?: string;
}

/** Recall CLI 主入口；argv 不包含 recall 命令名。 */
export async function main(
  argv: readonly string[],
  options: { readonly cwd?: string } = {},
): Promise<number> {
  let args: RecallArguments;
  try {
    args = parseArguments(argv);
  } catch (cause) {
    console.error(errorMessage(cause));
    console.error(
      "用法：x-agent-suite recall [--config <config.ts>] [YAML|目录]",
    );
    return 2;
  }
  try {
    const result = await runRecall({ cwd: options.cwd, ...args });
    for (const run of result.runs) {
      console.log((run.hardPass ? "PASS " : "FAIL ") + run.scenarioId);
    }
    for (const failure of result.failures) {
      console.error(
        "ERROR " + failure.scenarioId + "：" + failure.error.message,
      );
    }
    return result.failures.length > 0 ? 1 : 0;
  } catch (cause) {
    console.error(errorMessage(cause));
    return 2;
  }
}

function parseArguments(argv: readonly string[]): RecallArguments {
  let configPath: string | undefined;
  let target: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--config") {
      if (configPath !== undefined || argv[index + 1] === undefined) {
        throw new Error("--config 必须且只能指定一个配置路径");
      }
      configPath = argv[++index];
    } else if (argument.startsWith("-")) {
      throw new Error("未知 Recall 参数：" + argument);
    } else if (target !== undefined) {
      throw new Error("Recall 只接受一个考卷文件或目录目标");
    } else {
      target = argument;
    }
  }
  return {
    ...(configPath ? { configPath } : {}),
    ...(target ? { target } : {}),
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
