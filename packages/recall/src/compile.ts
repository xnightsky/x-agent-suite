/**
 * @module @x-agent-suite/recall/compile
 * RecallDefinition → ScenarioSpec；编译场景 provision 并绑定静态变量上下文，不创建 Driver 或合并执行资源。
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ScenarioSpec } from "@x-agent-suite/contracts";
import {
  parseRecallYaml,
  type RecallContextDefinition,
  type RecallCaseDefinition,
  type RecallDefinition,
} from "./schema.ts";
import type { RecallCriterionDescriptor } from "./registry.ts";
import { readContextFiles, type RecallContextFile } from "./context.ts";
import {
  readRecallResources,
  type RecallCompiledResource,
} from "./resources.ts";
import { compileRecallCaseExpect } from "./assertion-dsl.ts";
import {
  attachRecallVariableContext,
  mergeRecallVariables,
  type RecallStaticVariableContext,
} from "./recall-var.ts";

/** 单份考卷编译选项。 */
export interface CompileRecallOptions {
  /** context.files 与 plans.source 的物理根目录。 */
  readonly rootDir: string;
  /** 独立 registry 提供的判据描述（静态判据或工厂声明；编译期只需 name/scope）。 */
  readonly criteria: readonly RecallCriterionDescriptor[];
}

interface CompiledProvision {
  readonly value?: unknown;
  readonly attribution: string;
}

function assertRegisteredMetrics(
  definition: RecallDefinition,
  criteria: readonly RecallCriterionDescriptor[],
  filePath: string,
): void {
  const registered = {
    turn: new Set(
      criteria.filter((item) => item.scope === "turn").map((item) => item.name),
    ),
    session: new Set(
      criteria
        .filter((item) => item.scope === "session")
        .map((item) => item.name),
    ),
  };
  const assertRegistered = (
    scope: "turn" | "session",
    metric: string,
    id: string,
  ) => {
    if (registered[scope].has(metric)) return;
    throw new Error(
      "Recall metric 未注册：" +
        metric +
        "（" +
        filePath +
        "，case " +
        id +
        "）",
    );
  };
  for (const item of definition.cases) {
    for (const turn of item.turns) {
      for (const metric of Object.keys(turn.expect ?? {})) {
        if (metric !== "judge") assertRegistered("turn", metric, item.id);
      }
    }
    for (const metric of Object.keys(item.expect ?? {})) {
      if (metric !== "judge") assertRegistered("session", metric, item.id);
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

/**
 * 为单个 case 构造只读类型的静态变量上下文。
 *
 * @behavior recall-variable-context-compile
 * Given: 已校验的 Recall 文档、case、有效 context 和编译选项。
 * When: 选择当前文件内 plan 并合并变量层。
 * Then: vars 按 case > plan > 文档浅合并；scenario.file/dir/rootDir 使用实际编译路径；
 * 未选择命名 plan 或 context.plan=none 时 plan.name=none；resources: [] 的命名 plan 仍保留其 vars。
 * Failure: 未注册 plan 已在编译前置检查拒绝，不回退其他 plan 或猜测上下文。
 */
function createVariableContext(
  definition: RecallDefinition,
  item: RecallCaseDefinition,
  context: RecallContextDefinition | undefined,
  options: CompileRecallOptions,
  filePath: string,
): RecallStaticVariableContext {
  const scenarioFile = resolve(filePath);
  const planName =
    context?.plan && context.plan !== "none" ? context.plan : "none";
  return {
    vars: mergeRecallVariables(
      definition.vars,
      planName === "none" ? undefined : definition.plans?.[planName]?.vars,
      item.vars,
    ),
    scenario: {
      id: definition.id,
      file: scenarioFile,
      dir: dirname(scenarioFile),
      rootDir: resolve(options.rootDir),
    },
    case: { id: item.id },
    plan: { name: planName },
  };
}

/**
 * 读取、校验并编译一份 Recall YAML；所有 plans 引用与资源均在返回前校验。
 *
 * @behavior recall-file-compile
 * Given: 考卷路径、资源 rootDir 和独立判据描述表。
 * When: 解析文档，校验 metric/plan/resource，再逐 case 编译 provision 与变量上下文。
 * Then: 返回 ScenarioSpec[]；send 等执行输入保持原义，静态上下文经 metadata 弱引用绑定，
 * 不创建 Driver，也不把 vars 写入可枚举报告 metadata。
 * Failure: 读取、YAML、注册引用或资源校验失败均显式抛错，不返回部分场景。
 */
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
    const context = item.context ?? definition.context;
    const provision = await compileProvision(context, plans, options);
    const caseExpect = compileRecallCaseExpect(item.expect);
    const turns = item.turns.map((turn) => ({
      definition: turn,
      compiled: compileRecallCaseExpect(turn.expect),
    }));
    const turnAssertions = turns.map(({ compiled }) => ({
      ...(compiled.judge ? { judge: compiled.judge } : {}),
    }));
    const metadata = {
      ...item.metadata,
      recall: {
        file: resolve(filePath),
        fileId: definition.id,
        caseId: item.id,
        provision: provision.attribution,
        ...(caseExpect.judge ? { judge: caseExpect.judge } : {}),
        turnAssertions,
      },
    };
    attachRecallVariableContext(
      metadata,
      createVariableContext(definition, item, context, options, filePath),
    );
    scenarios.push({
      id: definition.id + "/" + item.id,
      turns: turns.map(({ definition, compiled }) => ({
        send: definition.send,
        ...(compiled.expect ? { expect: compiled.expect } : {}),
        ...(definition.timeoutMs !== undefined
          ? { timeoutMs: definition.timeoutMs }
          : {}),
      })),
      ...(item.timeoutMs !== undefined ? { timeoutMs: item.timeoutMs } : {}),
      ...(caseExpect.expect ? { expect: caseExpect.expect } : {}),
      ...(provision.value !== undefined ? { provision: provision.value } : {}),
      metadata,
    });
  }
  return scenarios;
}
