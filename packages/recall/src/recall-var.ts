/**
 * @module @x-agent-suite/recall/recall-var
 * Recall 内部静态变量解析：完整准备声明树后再求值，不执行 I/O。
 * 不变量：只展开值、不展开键；整值保持类型，值中的模板符不递归解析。
 */
import type { TurnCriterionContext } from "@x-agent-suite/contracts";
import { assertJsonValue } from "@x-agent-suite/assertions";

/** Recall 静态变量的编译期上下文。 */
export interface RecallStaticVariableContext {
  /** 文档、选中 plan 与 case 浅合并后的自定义变量。 */
  readonly vars: Readonly<Record<string, unknown>>;
  /** 当前考卷的身份与物理位置。 */
  readonly scenario: {
    readonly id: string;
    readonly file: string;
    readonly dir: string;
    readonly rootDir: string;
  };
  /** 当前 case 身份。 */
  readonly case: { readonly id: string };
  /** 当前选中的文件内 plan；未选择命名 plan 或显式 none 时为 none，空 resources 不改变选择。 */
  readonly plan: { readonly name: string };
}

/** 已准备的变量值；准备完成前不得调用 resolve。 */
export interface PreparedRecallVariableValue {
  /** 同步求值，不读取文件或环境。 */
  resolve(): unknown;
}

/** Recall 判据工厂可显式注入的变量解析器。 */
export interface RecallVariableResolver {
  /** 绑定当前判据上下文并准备完整值树。 */
  prepareValue(
    value: unknown,
    context: TurnCriterionContext,
  ): PreparedRecallVariableValue;
}

type StringPart = string | { readonly reference: string };

const REFERENCE_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/;
// Runner 原样保留 spec.metadata 引用。WeakMap 让变量随该对象按 case 隔离，
// 同时避免把 vars 或物理路径作为可枚举字段写入 JSON 报告。
const contexts = new WeakMap<
  Record<string, unknown>,
  RecallStaticVariableContext
>();

/**
 * 将编译期变量上下文绑定到会原样进入 SessionObservation 的 metadata。
 *
 * @behavior recall-var-context-attach
 * Given: 编译器为 case 创建独立 metadata 和静态变量上下文。
 * When: 后续 Runner 复用同一个 metadata 对象进行评估。
 * Then: 解析器能取回对应当前 case 的上下文，且变量不会成为可枚举报告字段。
 * Failure: metadata 未绑定时不伪造空上下文；静态引用会在准备阶段报缺少编译上下文。
 */
export function attachRecallVariableContext(
  metadata: Record<string, unknown>,
  context: RecallStaticVariableContext,
): void {
  contexts.set(metadata, context);
}

function definitionError(reference: string, detail = "未知或非法"): TypeError {
  return new TypeError(`Recall 变量引用无效（${detail}）：${reference}`);
}

/**
 * 按有限目录读取静态变量，不开放继承属性或深层寻址。
 *
 * @behavior recall-var-static-lookup
 * Given: 已通过文法检查的引用和可选编译上下文。
 * When: 在 vars/scenario/case/plan 中查找精确名称。
 * Then: vars 与 scenario 只接受自有属性，case.id 与 plan.name 返回对应身份值。
 * Failure: 缺上下文、未知名称、继承属性或额外路径段均抛定义错误。
 */
function staticValue(
  reference: string,
  context: RecallStaticVariableContext | undefined,
): unknown {
  if (!context) throw definitionError(reference, "缺少编译上下文");
  const [namespace, name, extra] = reference.split(".");
  if (extra !== undefined || name === undefined) {
    throw definitionError(reference);
  }
  if (namespace === "vars" && Object.hasOwn(context.vars, name)) {
    return context.vars[name];
  }
  if (namespace === "scenario" && Object.hasOwn(context.scenario, name)) {
    return context.scenario[name as keyof typeof context.scenario];
  }
  if (namespace === "case" && name === "id") return context.case.id;
  if (namespace === "plan" && name === "name") return context.plan.name;
  throw definitionError(reference);
}

/**
 * 在准备阶段把引用编译为无副作用的取值闭包。
 *
 * @behavior recall-var-reference-getter
 * Given: 一个引用、静态上下文和当前 turn 索引。
 * When: 准备 turn.index 或静态命名空间引用。
 * Then: turn.index 绑定当前轮；静态引用捕获编译值；run/resources/steps 在阶段 1 拒绝。
 * Failure: 非整数轮次、scope 不支持、动态名称或未知静态名称均在 resolve 前抛错。
 */
function referenceGetter(
  reference: string,
  context: RecallStaticVariableContext | undefined,
  turnIndex: number | undefined,
): () => unknown {
  if (reference === "turn.index") {
    if (
      turnIndex === undefined ||
      !Number.isInteger(turnIndex) ||
      turnIndex < 0
    ) {
      throw definitionError(reference, "当前 scope 不支持");
    }
    return () => turnIndex;
  }
  if (/^(?:run|resources|steps)\./.test(reference)) {
    throw definitionError(reference, "阶段 1 不支持");
  }
  const value = staticValue(reference, context);
  return () => value;
}

/**
 * 将原始字符串扫描为字面量与引用片段。
 *
 * @behavior recall-var-string-scan
 * Given: 含普通字符、转义模板符和 {{...}} 的字符串。
 * When: 从左到右识别 \{{ 与引用边界。
 * Then: \{{ 变为字面量 {{，其余反斜杠保留；引用去除两侧可选空白并校验名称文法。
 * Failure: 缺结束符、空名称或不符合 segment 文法的引用立即抛定义错误。
 */
function parseStringParts(value: string): StringPart[] {
  const parts: StringPart[] = [];
  let literal = "";
  let index = 0;
  const flush = () => {
    if (literal) parts.push(literal);
    literal = "";
  };
  while (index < value.length) {
    if (value.startsWith("\\{{", index)) {
      literal += "{{";
      index += 3;
      continue;
    }
    if (!value.startsWith("{{", index)) {
      literal += value[index]!;
      index += 1;
      continue;
    }
    const end = value.indexOf("}}", index + 2);
    if (end < 0) throw definitionError(value, "缺少结束符");
    const reference = value.slice(index + 2, end).trim();
    if (!REFERENCE_PATTERN.test(reference)) {
      throw definitionError(reference, "文法错误");
    }
    flush();
    parts.push({ reference });
    index = end + 2;
  }
  flush();
  return parts;
}

/**
 * 准备字符串的整值或嵌入语义，变量结果不做二次解析。
 *
 * @behavior recall-var-string-prepare
 * Given: 原始字符串、静态上下文和 turn 索引。
 * When: 扫描原文，判断其是否恰好一个引用，并准备全部取值闭包。
 * Then: 整值引用保留原始 JSON 类型；嵌入引用在 resolve 时拼接为字符串；
 * 变量值中的模板符始终作为字面值返回。
 * Failure: 非法引用在准备期抛出；null、数组、对象或非有限数用于嵌入时在求值期抛 TypeError。
 */
function prepareString(
  value: string,
  context: RecallStaticVariableContext | undefined,
  turnIndex: number | undefined,
): PreparedRecallVariableValue {
  const parts = parseStringParts(value);
  // 原文恰好一个引用时保留原始 JSON 类型；其余情况一律按嵌入字符串处理。
  if (parts.length === 1 && typeof parts[0] !== "string") {
    return {
      resolve: referenceGetter(parts[0]!.reference, context, turnIndex),
    };
  }
  const resolved = parts.map((part) =>
    typeof part === "string"
      ? part
      : referenceGetter(part.reference, context, turnIndex),
  );
  return {
    resolve: () =>
      resolved
        .map((part) => {
          const item = typeof part === "function" ? part() : part;
          if (
            typeof item !== "string" &&
            typeof item !== "boolean" &&
            !(typeof item === "number" && Number.isFinite(item))
          ) {
            throw new TypeError(
              "Recall 嵌入引用只能拼接字符串、有限数或布尔值",
            );
          }
          return String(item);
        })
        .join(""),
  };
}

/**
 * 准备完整声明值树；所有引用均在返回前完成文法与静态名称检查。
 *
 * @behavior recall-var-value-prepare
 * Given: 任意标量、数组或对象声明值，以及可选静态上下文和 turn 索引。
 * When: 递归准备数组元素和对象属性值，不处理对象键。
 * Then: 返回可同步 resolve 的准备结果；完整树先准备，求值时重建原结构并保留整值类型。
 * Failure: 当前值树内任意后代的非法引用都使 prepare 失败；嵌入类型错误由 resolve 继续传播。
 */
export function prepareRecallVariableValue(
  value: unknown,
  context: RecallStaticVariableContext | undefined,
  turnIndex?: number,
): PreparedRecallVariableValue {
  if (typeof value === "string")
    return prepareString(value, context, turnIndex);
  if (Array.isArray(value)) {
    const children = value.map((item) =>
      prepareRecallVariableValue(item, context, turnIndex),
    );
    return { resolve: () => children.map((child) => child.resolve()) };
  }
  if (typeof value === "object" && value !== null) {
    const children = Object.entries(value).map(
      ([key, item]) =>
        [key, prepareRecallVariableValue(item, context, turnIndex)] as const,
    );
    return {
      resolve: () =>
        Object.fromEntries(
          children.map(([key, child]) => [key, child.resolve()]),
        ),
    };
  }
  return { resolve: () => value };
}

/**
 * 供 Recall 判据工厂显式注入的无状态解析器。
 *
 * @behavior recall-var-resolver-binding
 * Given: 含 session.metadata 与 turnIndex 的判据上下文。
 * When: 判据为 opt-in 字段调用 prepareValue。
 * Then: 通过 WeakMap 找回当前 case 的静态上下文并绑定当前轮次，
 * 不保存全局 current case，也不执行 I/O。
 * Failure: metadata 未绑定时的静态引用显式报错；普通无引用字面值不受影响。
 */
export const recallVariableResolver: RecallVariableResolver = {
  prepareValue(value, criterionContext) {
    return prepareRecallVariableValue(
      value,
      contexts.get(criterionContext.session.metadata),
      criterionContext.turnIndex,
    );
  },
};

/** Recall 作者声明的一层 vars。 */
export type RecallVariableDefinitions = Readonly<Record<string, unknown>>;

const VARIABLE_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const RESERVED_VARIABLE_NAMES = new Set([
  "vars",
  "scenario",
  "case",
  "plan",
  "turn",
  "run",
  "resources",
  "steps",
]);

/**
 * 校验一层 vars 的变量名、保留命名空间与 JSON 值。
 *
 * @behavior recall-vars-definition-parse
 * Given: 文档、plan 或 case 的一层 vars 及其声明位置。
 * When: 逐变量检查名称、保留命名空间和嵌套 JSON 值。
 * Then: 返回通过校验的变量记录，供后续按层浅合并；不在此阶段展开引用。
 * Failure: 非对象层、非法 lowerCamelCase 名、保留名或非 JSON 值均抛 TypeError。
 */
export function parseRecallVariableDefinitions(
  value: unknown,
  at: string,
): RecallVariableDefinitions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(at + " 必须是对象");
  }
  for (const [name, item] of Object.entries(value)) {
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      throw new TypeError(at + " 变量名必须是 lowerCamelCase：" + name);
    }
    if (RESERVED_VARIABLE_NAMES.has(name)) {
      throw new TypeError(at + " 不得覆盖保留命名空间：" + name);
    }
    assertJsonValue(item, at + "." + name);
  }
  return value as RecallVariableDefinitions;
}

/**
 * 按文档、选中 plan、case 顺序浅合并 vars。
 *
 * @behavior recall-vars-shallow-merge
 * Given: 已按文档、plan、case 排序且经校验的可选变量层。
 * When: 按变量名执行一次浅合并。
 * Then: 后层仅覆盖同名变量，其他项保留；嵌套对象和数组整体替换，不做深合并；
 * 返回新的顶层记录，但不深克隆嵌套值。
 * Failure: 合并阶段不求值、不展开模板；非法层必须由前置 schema 拒绝，不能靠合并修补。
 */
export function mergeRecallVariables(
  ...layers: readonly (RecallVariableDefinitions | undefined)[]
): RecallVariableDefinitions {
  return Object.assign({}, ...layers) as RecallVariableDefinitions;
}
