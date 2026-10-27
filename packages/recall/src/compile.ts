/**
 * @module @x-agent-suite/recall/compile
 * RecallDefinition → ScenarioSpec；不创建 driver、不写被测工作区。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Criterion, ScenarioSpec } from "@x-agent-suite/contracts";
import { parseRecallYaml, type RecallDefinition } from "./schema.ts";
import { readContextFiles, type RecallContextFile } from "./context.ts";

/** 单份考卷编译选项。 */
export interface CompileRecallOptions {
  readonly rootDir: string;
  readonly criteria: readonly Criterion[];
}

/** 读取、校验并编译一份考卷；metric 引用在返回前全部核对。 */
export async function compileRecallFile(
  filePath: string,
  options: CompileRecallOptions,
): Promise<ScenarioSpec[]> {
  const source = await readFile(filePath, "utf8").catch((cause: unknown) => {
    throw new Error("无法读取 Recall 考卷：" + filePath, { cause });
  });
  const definition = parseRecallYaml(source, filePath);
  assertRegisteredMetrics(definition, options.criteria, filePath);
  const contextFiles = definition.context?.files
    ? await readContextFiles(definition.context.files, options.rootDir)
    : undefined;
  return definition.cases.map((item) => ({
    id: definition.id + "/" + item.id,
    turns: item.turns.map((turn) => ({ ...turn })),
    ...(item.timeoutMs !== undefined ? { timeoutMs: item.timeoutMs } : {}),
    ...(contextFiles ? { provision: createProvision(contextFiles) } : {}),
    metadata: {
      ...item.metadata,
      recall: {
        file: resolve(filePath),
        fileId: definition.id,
        caseId: item.id,
      },
    },
  }));
}

function assertRegisteredMetrics(
  definition: RecallDefinition,
  criteria: readonly Criterion[],
  filePath: string,
): void {
  const registered = new Set(
    criteria.filter((item) => item.scope === "turn").map((item) => item.name),
  );
  for (const item of definition.cases) {
    for (const turn of item.turns) {
      for (const metric of Object.keys(turn.expect ?? {})) {
        if (!registered.has(metric)) {
          throw new Error(
            "Recall metric 未注册：" +
              metric +
              "（" +
              filePath +
              "，case " +
              item.id +
              "）",
          );
        }
      }
    }
  }
}

function createProvision(files: readonly RecallContextFile[]) {
  return {
    context: {
      files: files.map((file) => ({ ...file })),
    },
  };
}
