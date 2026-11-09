/**
 * @module @x-agent-suite/recall/cli
 * Recall CLI：显式 target、独立 registry/Plan；定义错误 2，基础设施失败 1。
 * 不变量：无 target 参数拒绝；不支持 --config/--mode/--cli-ref。
 */
import { runRecall } from "./run.ts";
import type { LoadRecallOptions } from "./load.ts";
import { parseExecutionParams } from "./execution-params.ts";
import { createRecallReporter, type RecallVerbosity } from "./reporter.ts";

type RecallArguments = Omit<LoadRecallOptions, "cwd"> & {
  verbosity: RecallVerbosity;
};

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
    const { verbosity, ...loadArgs } = args;
    const result = await runRecall(
      {
        cwd: options.cwd,
        homeDir: options.homeDir,
        ...loadArgs,
      },
      createRecallReporter(verbosity),
    );
    return result.failures.length > 0 ? 1 : 0;
  } catch (cause) {
    console.error(errorMessage(cause));
    return 2;
  }
}

function usage(): string {
  return "用法：x-agent-suite recall (--carrier <id> | --provider <id> | --model <id>) [--live-config <yaml>] [--registry <module.ts>] [--plan <yaml|use:profile>] [--execution-params <json-object>] [--approve-live] [--repeat <n>] [--out-dir <path>] [--root-dir <path>] [--verbose [0..3]] [-v|-vv|-vvv] [YAML|目录]";
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
    executionParams?: Readonly<Record<string, unknown>>;
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
    case "--execution-params":
      mutable.executionParams = parseExecutionParams(value);
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

/** 累加 verbosity 并执行 0..3 的封闭区间校验。 */
function addVerbosity(args: RecallArguments, raw: string): void {
  if (!/^\d+$/.test(raw)) {
    throw new Error("verbosity 必须是 0..3 的整数，实际：" + raw);
  }
  const value = Number(raw);
  const total = args.verbosity + value;
  if (!Number.isSafeInteger(value) || total > 3) {
    throw new Error("verbosity 总和必须位于 0..3，实际：" + total);
  }
  args.verbosity = total as RecallVerbosity;
}

/** 判断可选 verbosity 数值是否跟随 --verbose；非数值仍按 target 解析。 */
function isVerbosityValue(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value);
}

function parseArguments(argv: readonly string[]): RecallArguments {
  const args = { selection: {}, verbosity: 0 } as RecallArguments & {
    target?: string;
  };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (/^-v+$/.test(argument)) {
      addVerbosity(args, String(argument.length - 1));
      continue;
    }
    if (argument === "--verbose" || argument.startsWith("--verbose=")) {
      let value = argument.startsWith("--verbose=")
        ? argument.slice("--verbose=".length)
        : "1";
      const next = argv[index + 1];
      if (
        argument === "--verbose" &&
        next !== undefined &&
        isVerbosityValue(next)
      ) {
        value = next;
        index += 1;
      }
      addVerbosity(args, value);
      continue;
    }
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
