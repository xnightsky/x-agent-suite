/** @module @x-agent-suite/recall/first-of-dsl
 * 组合评价点结构、保留名与编译路径；不解释领域判据输入，不执行条件。
 */
import {
  parseAssertionScore,
  type AssertionScoreConfig,
} from "@x-agent-suite/assertions";
import type { ExpectBlock, ScenarioSpec } from "@x-agent-suite/contracts";
import type { RecallCaseExpectDefinition } from "./assertion-dsl.ts";
import { assertKnownFields, isRecord, requiredString } from "./validation.ts";

/** Recall 支持的组合评价点类型。 */
export type RecallCompositionKind = "allOf" | "anyOf" | "firstOf";

/** 一个分支的封闭声明；score 省略时由内部叶子实际贡献求和。 */
export interface RecallCompositionBranch {
  readonly name: string;
  readonly score?: AssertionScoreConfig;
  readonly expect: RecallCaseExpectDefinition;
}

/** 兼容既有 firstOf 分支类型。 */
export type RecallFirstOfBranch = RecallCompositionBranch;

/** 具名组合评价点。 */
export type RecallCompositionDefinition = Readonly<
  Record<string, readonly RecallCompositionBranch[]>
>;
/** 兼容既有 firstOf 定义类型。 */
export type RecallFirstOfDefinition = RecallCompositionDefinition;

/** 各组合编译后的私有键前缀。 */
export const COMPOSITION_PREFIXES: Readonly<
  Record<RecallCompositionKind, string>
> = {
  allOf: "__recall_all_of__:",
  anyOf: "__recall_any_of__:",
  firstOf: "__recall_first_of__:",
};
/** 兼容既有 firstOf 私有前缀。 */
export const FIRST_OF_PREFIX = COMPOSITION_PREFIXES.firstOf;
/** 组合作者名列表，解析与编译共用同一顺序。 */
export const COMPOSITION_KINDS = ["allOf", "anyOf", "firstOf"] as const;

/** 返回编译键对应的组合类型；普通机械键返回 undefined。 */
export function compositionKindOfKey(
  name: string,
): RecallCompositionKind | undefined {
  return COMPOSITION_KINDS.find((kind) =>
    name.startsWith(COMPOSITION_PREFIXES[kind]),
  );
}

/** 判断编译键是否是 firstOf。 */
export function isFirstOfKey(name: string): boolean {
  return compositionKindOfKey(name) === "firstOf";
}

/** 判断注册判据是否占用组合作者名、point 前缀或内部编译键。 */
export function isReservedCompositionName(name: string): boolean {
  return COMPOSITION_KINDS.some(
    (kind) =>
      name === kind ||
      name.startsWith(kind + ".") ||
      name.startsWith(COMPOSITION_PREFIXES[kind]),
  );
}

function validName(value: unknown, at: string): string {
  const name = requiredString(value, at);
  if (name.includes(".")) throw new Error(at + " 不允许点号");
  return name;
}

/** 完整预检一个组合的全部Branch；回调沿用现有 expect/Judge 校验。 */
export function parseRecallComposition(
  kind: RecallCompositionKind,
  value: unknown,
  parseExpect: (
    value: unknown,
    at: string,
    explicitBranchScore: boolean,
  ) => RecallCaseExpectDefinition,
  at: string,
): RecallCompositionDefinition {
  if (!isRecord(value) || !Object.keys(value).length)
    throw new Error(at + " 必须是非空对象");
  const minimum = kind === "allOf" ? 1 : 2;
  return Object.fromEntries(
    Object.entries(value).map(([name, entries]) => {
      validName(name, at);
      if (!Array.isArray(entries) || entries.length < minimum)
        throw new Error(at + "." + name + " 至少需要 " + minimum + " 个分支");
      const names = new Set<string>();
      const branches = entries.map((entry, index) => {
        const path = at + "." + name + "." + index;
        if (!isRecord(entry)) throw new Error(path + " 必须是对象");
        assertKnownFields(entry, ["name", "score", "expect"], path);
        const branchName = validName(entry.name, path + ".name");
        if (names.has(branchName)) throw new Error(path + " 分支名重复");
        names.add(branchName);
        const score =
          entry.score === undefined
            ? undefined
            : parseAssertionScore(entry.score, path + ".score");
        const expect = parseExpect(
          entry.expect,
          path + ".expect",
          score !== undefined,
        );
        if (!Object.keys(expect).length)
          throw new Error(path + ".expect 不能为空");
        return {
          name: branchName,
          ...(score === undefined ? {} : { score }),
          expect,
        };
      });
      if (
        kind !== "allOf" &&
        branches.every((branch) => branch.score !== undefined) &&
        branches.some(
          (branch) =>
            (branch.score?.miss ?? -1) !== (branches[0]!.score?.miss ?? -1),
        )
      )
        throw new Error(at + "." + name + " 各分支 miss 必须一致");
      return [name, branches];
    }),
  );
}

/** 兼容既有 firstOf 解析入口。 */
export function parseRecallFirstOf(
  value: unknown,
  parseExpect: (
    value: unknown,
    at: string,
    explicitBranchScore: boolean,
  ) => RecallCaseExpectDefinition,
  at: string,
): RecallFirstOfDefinition {
  return parseRecallComposition("firstOf", value, parseExpect, at);
}

/** 展开编译 expect 的机械引用（包含未执行档），仅供预检与装配。 */
export function mechanicalEntries(
  block: ExpectBlock | undefined,
): [string, unknown][] {
  return Object.entries(block ?? {}).flatMap(([name, value]) => {
    if ((COMPOSITION_KINDS as readonly string[]).includes(name)) {
      return Object.values(value as RecallCompositionDefinition).flatMap(
        (branches) =>
          branches.flatMap((branch) => mechanicalEntries(branch.expect)),
      );
    }
    if (compositionKindOfKey(name)) {
      return (value as readonly RecallCompositionBranch[]).flatMap((branch) =>
        mechanicalEntries(branch.expect),
      );
    }
    return name === "judge" ? [] : [[name, value] as [string, unknown]];
  });
}

/** 判断场景是否显式声明任一组合。 */
export function hasCompositions(spec: ScenarioSpec): boolean {
  return [spec.expect, ...spec.turns.map((turn) => turn.expect)].some((block) =>
    Object.keys(block ?? {}).some((key) => compositionKindOfKey(key)),
  );
}

/** 判断场景是否显式声明 firstOf。 */
export function hasFirstOf(spec: ScenarioSpec): boolean {
  return [spec.expect, ...spec.turns.map((turn) => turn.expect)].some((block) =>
    Object.keys(block ?? {}).some(isFirstOfKey),
  );
}
