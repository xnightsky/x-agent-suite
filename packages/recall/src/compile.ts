/**
 * @module @x-agent-suite/recall/compile
 * RecallDefinition → ScenarioSpec；只编译场景 provision，不创建 Driver 或合并执行资源。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Criterion, ScenarioSpec } from "@x-agent-suite/contracts";
import {
  parseRecallYaml,
  type RecallContextDefinition,
  type RecallDefinition,
} from "./schema.ts";
import { readContextFiles, type RecallContextFile } from "./context.ts";
import {
  readRecallResources,
  type RecallCompiledResource,
} from "./resources.ts";

/** 单份考卷编译选项。 */
export interface CompileRecallOptions {
  /** context.files 与 plans.source 的物理根目录。 */
  readonly rootDir: string;
  /** 独立 registry 提供的判据。 */
  readonly criteria: readonly Criterion[];
}

interface CompiledProvision {
  readonly value?: unknown;
  readonly attribution: string;
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

function assertPlanReferences(
  definition: RecallDefinition,
  filePath: string,
): void {
  for (const item of definition.cases) {
    const context = item.context ?? definition.context;
    if (!context?.plan || context.plan === "none") continue;
    if (!definition.plans?.[context.plan]) {
      throw new Error(
        "Recall ProvisionPlan 未注册：" +
          context.plan +
          "（" +
          filePath +
          "，case " +
          item.id +
          "）",
      );
    }
  }
}

async function loadPlans(
  definition: RecallDefinition,
  options: CompileRecallOptions,
  filePath: string,
) {
  const plans: Record<string, readonly RecallCompiledResource[]> = {};
  for (const [name, plan] of Object.entries(definition.plans ?? {})) {
    plans[name] = await readRecallResources(
      plan.resources,
      options.rootDir,
      filePath,
    );
  }
  return plans;
}

async function compileProvision(
  context: RecallContextDefinition | undefined,
  plans: Readonly<Record<string, readonly RecallCompiledResource[]>>,
  options: CompileRecallOptions,
): Promise<CompiledProvision> {
  if (!context || context.plan === "none") return { attribution: "none" };
  if (context.plan) {
    const name = context.plan;
    return {
      value: { plan: name, resources: plans[name]! },
      attribution: "plan:" + name,
    };
  }
  if (context.files) {
    const files = await readContextFiles(context.files, options.rootDir);
    return { value: createContextProvision(files), attribution: "files" };
  }
  return { attribution: "none" };
}

function createContextProvision(files: readonly RecallContextFile[]) {
  return { context: { files: files.map((file) => ({ ...file })) } };
}

/** 读取、校验并编译一份 Recall YAML；所有 plans 引用与资源均在返回前校验。 */
export async function compileRecallFile(
  filePath: string,
  options: CompileRecallOptions,
): Promise<ScenarioSpec[]> {
  const source = await readFile(filePath, "utf8").catch((cause: unknown) => {
    throw new Error("无法读取 Recall 考卷：" + filePath, { cause });
  });
  const definition = parseRecallYaml(source, filePath);
  assertRegisteredMetrics(definition, options.criteria, filePath);
  assertPlanReferences(definition, filePath);
  const plans = await loadPlans(definition, options, filePath);
  const scenarios: ScenarioSpec[] = [];
  for (const item of definition.cases) {
    const provision = await compileProvision(
      item.context ?? definition.context,
      plans,
      options,
    );
    scenarios.push({
      id: definition.id + "/" + item.id,
      turns: item.turns.map((turn) => ({ ...turn })),
      ...(item.timeoutMs !== undefined ? { timeoutMs: item.timeoutMs } : {}),
      ...(provision.value !== undefined ? { provision: provision.value } : {}),
      metadata: {
        ...item.metadata,
        recall: {
          file: resolve(filePath),
          fileId: definition.id,
          caseId: item.id,
          provision: provision.attribution,
        },
      },
    });
  }
  return scenarios;
}
