/**
 * @module @x-agent-suite/recall/config
 * Recall 运行配置：只声明运行方式，不承载模型、渠道或凭证解析。
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunScenarioSpecDeps } from "@x-agent-suite/runner";

/** Recall 代码运行配置；由 config 模块 default 导出。 */
export interface RecallConfig {
  /** 消费者 driver 工厂；每次 case/repeat 执行调用一次。 */
  readonly createDriver: RunScenarioSpecDeps["createDriver"];
  /** 消费者注册的判据；turn expect 只接受 turn scope。 */
  readonly criteria: RunScenarioSpecDeps["criteria"];
  /** 每个 case 的独立执行次数，缺省 1。 */
  readonly repeat?: number;
  /** 报告目录；相对路径按调用 cwd 解析，缺省 .tmp/x-agent-suite。 */
  readonly outDir?: string;
  /** context 文件根目录；相对路径按 config 所在目录解析，缺省调用 cwd。 */
  readonly rootDir?: string;
  /** 考卷文件列表；相对路径按 config 所在目录解析，覆盖默认目录发现。 */
  readonly files?: readonly string[];
  /** 写入报告行的消费者 carrier 标识，缺省 default。 */
  readonly carrier?: string;
}

const CONFIG_FIELDS = new Set([
  "createDriver",
  "criteria",
  "repeat",
  "outDir",
  "rootDir",
  "files",
  "carrier",
]);

/** 加载并严格校验 Recall config 模块；导入失败属于定义错误。 */
export async function loadRecallConfig(
  configPath: string,
): Promise<RecallConfig> {
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(resolve(configPath)).href)) as {
      default?: unknown;
    };
  } catch (cause) {
    throw new Error("Recall 运行配置导入失败：" + configPath, { cause });
  }
  return validateRecallConfig(module.default, configPath);
}

/** 校验 config 的已知字段、必需函数/数组与正整数。 */
function validateRecallConfig(
  value: unknown,
  configPath: string,
): RecallConfig {
  if (!isRecord(value))
    throw configError(configPath, "必须 default 导出配置对象");
  for (const key of Object.keys(value)) {
    if (!CONFIG_FIELDS.has(key))
      throw configError(configPath, "未知字段 " + key);
  }
  if (typeof value.createDriver !== "function") {
    throw configError(configPath, "createDriver 必须是函数");
  }
  if (!Array.isArray(value.criteria)) {
    throw configError(configPath, "criteria 必须是数组");
  }
  assertUniqueCriteria(value.criteria, configPath);
  if (value.repeat !== undefined && !isPositiveInteger(value.repeat)) {
    throw configError(configPath, "repeat 必须是正整数");
  }
  for (const key of ["outDir", "rootDir", "carrier"] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) {
      throw configError(configPath, key + " 必须是非空字符串");
    }
  }
  if (
    value.files !== undefined &&
    (!Array.isArray(value.files) || !value.files.every(isNonEmptyString))
  ) {
    throw configError(configPath, "files 必须是非空字符串路径数组");
  }
  return value as unknown as RecallConfig;
}

/** 提前匹配 Runner 的注册唯一性，避免执行后才暴露配置错误。 */
function assertUniqueCriteria(
  criteria: readonly unknown[],
  configPath: string,
): void {
  const seen = new Set<string>();
  for (const criterion of criteria) {
    if (!isRecord(criterion)) continue;
    const key = String(criterion.scope) + ":" + String(criterion.name);
    if (seen.has(key)) {
      throw configError(
        configPath,
        "判据重复注册：" +
          String(criterion.name) +
          "（" +
          String(criterion.scope) +
          "）",
      );
    }
    seen.add(key);
  }
}

/** 判断正整数配置值。 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 判断非空字符串（纯空白也拒绝）。 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断 YAML/config 的普通记录形状。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configError(configPath: string, message: string): Error {
  return new Error(
    "Recall 运行配置无效：" + message + "（" + configPath + "）",
  );
}
