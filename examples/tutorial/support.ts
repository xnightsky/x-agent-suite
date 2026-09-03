/**
 * @module examples/tutorial/support
 * 教程消费者侧胶水：把一次 Observation 组装成可报告的 ScenarioResult。
 * 本文件不属于框架公共 API，也不实现路线图中的通用 Scenario runner。
 */
import type { Observation, ScenarioResult } from "@x-agent-suite/contracts";
import { dryChecks, fuzzyChecks } from "@x-agent-suite/observation";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * 用通用 dry/fuzzy checks 构造教程结果。
 * 教程没有 hard expectation，因此 hardPass 只继承 dry 门禁。
 */
export function buildTutorialResult(
  observation: Observation,
  expectedText: string,
  latencyMs = 0,
): ScenarioResult<{ expectedText: string }> {
  const dryFailures = dryChecks(observation);
  const fuzzyFailures = fuzzyChecks(observation.text, [expectedText]);
  const failures = [...dryFailures, ...fuzzyFailures];
  return {
    observation,
    artifact: { expectedText },
    dryPass: dryFailures.length === 0,
    hardPass: dryFailures.length === 0,
    fuzzyPass: fuzzyFailures.length === 0,
    latencyMs,
    error: failures.length > 0 ? failures.join("；") : undefined,
  };
}

/** 解析教程产物目录；契约测试通过环境变量注入独立临时目录。 */
export function resolveTutorialOutDir(defaultPath: string): string {
  return resolve(process.env.XAS_TUTORIAL_OUT_DIR ?? defaultPath);
}

/** 以稳定前缀输出机器可解析的教程摘要。 */
export function printTutorialSummary(summary: Record<string, unknown>): void {
  console.log(`TUTORIAL_SUMMARY ${JSON.stringify(summary)}`);
}

/** 判断路径是否仍存在，供教程验证资源清理。 */
export async function tutorialPathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
