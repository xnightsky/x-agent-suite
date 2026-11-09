/** @module @x-agent-suite/recall/first-of-dsl
 * 有序组合结构与编译路径；不解释领域判据输入，不执行条件。
 */
import {
  parseAssertionScore,
  type AssertionScoreConfig,
} from "@x-agent-suite/assertions";
import type { ExpectBlock, ScenarioSpec } from "@x-agent-suite/contracts";
import type { RecallCaseExpectDefinition } from "./assertion-dsl.ts";
import { assertKnownFields, isRecord, requiredString } from "./validation.ts";
/** 一个档位的封闭声明，expect 子条件不独立计分。 */
export interface RecallFirstOfBranch {
  readonly name: string;
  readonly score?: AssertionScoreConfig;
  readonly expect: RecallCaseExpectDefinition;
}
/** 具名有序评价点。 */
export type RecallFirstOfDefinition = Readonly<
  Record<string, readonly RecallFirstOfBranch[]>
>;
/** 编译后的组合私有键。 */
export const FIRST_OF_PREFIX = "__recall_first_of__:";
/** 判断编译键是否是有序组合。 */
export function isFirstOfKey(name: string): boolean {
  return name.startsWith(FIRST_OF_PREFIX);
}
function validName(value: unknown, at: string): string {
  const name = requiredString(value, at);
  if (name.includes(".")) throw new Error(at + " 不允许点号");
  return name;
}
/** 完整预检所有档位；回调沿用现有 expect/Judge 校验。 */
export function parseRecallFirstOf(
  value: unknown,
  parseExpect: (value: unknown, at: string) => RecallCaseExpectDefinition,
  at: string,
): RecallFirstOfDefinition {
  if (!isRecord(value) || !Object.keys(value).length)
    throw new Error(at + " 必须是非空对象");
  return Object.fromEntries(
    Object.entries(value).map(([name, entries]) => {
      validName(name, at);
      if (!Array.isArray(entries) || entries.length < 2)
        throw new Error(at + "." + name + " 至少两个档位");
      const names = new Set<string>();
      const branches = entries.map((entry, index) => {
        const path = `${at}.${name}.${index}`;
        if (!isRecord(entry)) throw new Error(path + " 必须是对象");
        assertKnownFields(entry, ["name", "score", "expect"], path);
        const branchName = validName(entry.name, path + ".name");
        if (names.has(branchName)) throw new Error(path + " 档名重复");
        names.add(branchName);
        const score = parseAssertionScore(
          entry.score === undefined ? {} : entry.score,
          path + ".score",
        );
        const expect = parseExpect(entry.expect, path + ".expect");
        if (!Object.keys(expect).length)
          throw new Error(path + ".expect 不能为空");
        return { name: branchName, score, expect };
      });
      if (
        branches.some(
          (branch) =>
            (branch.score.miss ?? -1) !== (branches[0]!.score.miss ?? -1),
        )
      )
        throw new Error(at + "." + name + " 各档 miss 必须一致");
      return [name, branches];
    }),
  );
}
/** 展开编译 expect 的机械引用（包含未执行档），仅供预检与装配。 */
export function mechanicalEntries(
  block: ExpectBlock | undefined,
): [string, unknown][] {
  return Object.entries(block ?? {}).flatMap(([name, value]) => {
    if (name === "firstOf")
      return Object.values(value as RecallFirstOfDefinition).flatMap(
        (branches) =>
          branches.flatMap((branch) => mechanicalEntries(branch.expect)),
      );
    if (isFirstOfKey(name))
      return (value as readonly RecallFirstOfBranch[]).flatMap((branch) =>
        mechanicalEntries(branch.expect),
      );
    return name === "judge" ? [] : [[name, value] as [string, unknown]];
  });
}
/** 判断场景是否显式声明组合。 */
export function hasFirstOf(spec: ScenarioSpec): boolean {
  return [spec.expect, ...spec.turns.map((turn) => turn.expect)].some((block) =>
    Object.keys(block ?? {}).some(isFirstOfKey),
  );
}
