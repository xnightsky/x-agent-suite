/**
 * @module @x-agent-suite/recall/cli
 * Recall CLI：显式 target、独立 registry/Plan；定义错误 2，基础设施失败 1。
 * 不变量：无 target 参数拒绝；不支持 --config/--mode/--cli-ref。
 */
import { runRecall } from "./run.ts";
import type { LoadRecallOptions } from "./load.ts";

type RecallArguments = Omit<LoadRecallOptions, "cwd">;

/** Recall CLI 主入口；argv 不包含 recall 命令名。 */
export async function main(
  argv: readonly string[],
  options: { readonly cwd?: string; readonly homeDir?: string } = {},
): Promise<number> {
  let args: RecallArguments;
  try {
    args = parseArguments(argv);
  } catch (cause) {
    console.error(errorMessage(cause));
    console.error(usage());
    return 2;
  }
  try {
    const result = await runRecall({
      cwd: options.cwd,
      homeDir: options.homeDir,
      ...args,
    });
    for (const run of result.runs) {
      const implementation = run.cliRef
        ? run.mode + "/" + run.cliRef
        : run.mode;
      console.log(
        (run.hardPass ? "PASS " : "FAIL ") +
          run.scenarioId +
          " [" +
          run.carrier +
          "/" +
          implementation +
          "]",
      );
    }
    for (const failure of result.failures) {
      console.error(
        "ERROR " +
          failure.scenarioId +
          " [" +
          failure.carrier +
          "/" +
          failure.mode +
          "]：" +
          failure.error.message,
      );
    }
    return result.failures.length > 0 ? 1 : 0;
  } catch (cause) {
    console.error(errorMessage(cause));
    return 2;
  }
}

function usage(): string {
  return "用法：x-agent-suite recall (--carrier <id> | --provider <id> | --model <id>) [--live-config <yaml>] [--registry <module.ts>] [--plan <yaml>] [--approve-live] [--repeat <n>] [--out-dir <path>] [--root-dir <path>] [YAML|目录]";
}

function applyOption(
  args: RecallArguments,
  argument: string,
  value: string,
): void {
  const mutable = args as {
    selection: { carrier?: string; provider?: string; model?: string };
    liveConfigPath?: string;
    registryPath?: string;
    planPath?: string;
    repeat?: number;
    outDir?: string;
    rootDir?: string;
  };
  switch (argument) {
    case "--carrier":
      mutable.selection.carrier = value;
      break;
    case "--provider":
      mutable.selection.provider = value;
      break;
    case "--model":
      mutable.selection.model = value;
      break;
    case "--live-config":
      mutable.liveConfigPath = value;
      break;
    case "--registry":
      mutable.registryPath = value;
      break;
    case "--plan":
      mutable.planPath = value;
      break;
    case "--repeat":
      mutable.repeat = Number(value);
      break;
    case "--out-dir":
      mutable.outDir = value;
      break;
    case "--root-dir":
      mutable.rootDir = value;
      break;
    default:
      throw new Error("未知 Recall 参数：" + argument);
  }
}

function parseArguments(argv: readonly string[]): RecallArguments {
  const args = { selection: {} } as RecallArguments & { target?: string };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--config") {
      throw new Error(
        "--config 已移除；请使用 --registry 注册实现、--plan 声明 effects",
      );
    }
    if (argument === "--approve-live") {
      if (seen.has(argument)) throw new Error("--approve-live 不得重复");
      seen.add(argument);
      (args as { approveLive?: boolean }).approveLive = true;
      continue;
    }
    if (argument.startsWith("--")) {
      if (seen.has(argument)) throw new Error("参数不得重复：" + argument);
      const value = argv[++index];
      if (value === undefined) throw new Error(argument + " 必须指定值");
      seen.add(argument);
      applyOption(args, argument, value);
    } else if (argument.startsWith("-")) {
      throw new Error("未知 Recall 参数：" + argument);
    } else if (args.target !== undefined) {
      throw new Error("Recall 只接受一个考卷文件或目录目标");
    } else {
      args.target = argument;
    }
  }
  if (
    !args.selection.carrier &&
    !args.selection.provider &&
    !args.selection.model
  ) {
    throw new Error(
      "必须显式指定 --carrier/--provider/--model，拒绝隐式执行默认目标",
    );
  }
  return args;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
