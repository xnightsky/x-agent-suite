/**
 * @module @x-agent-suite/contracts/report
 * ScenarioResult 列表 → 报告文件的契约类型。
 *
 * 不变量：
 * - 报告由消费者产出，本模块只声明行/选项/路径形状；
 * - `ScenarioResult` 通过默认泛型参数保持类型兼容。
 */

import type { ScenarioResult } from "./observation.ts";
import type { Redactor } from "./redaction.ts";

/**
 * 报告中的一行：一次 scenario × carrier × prompt 变体的运行结果。
 *
 * @typeParam Artifact 场景跑完后收集的状态证据形状，由消费者定义。
 */
export interface ScenarioReportRow<Artifact = Record<string, unknown>> {
  /** 场景 id。 */
  readonly scenario: string;
  /** carrier 标识。 */
  readonly carrier: string;
  /** prompt 变体名。 */
  readonly promptVariant: string;
  /** 评分结果。 */
  readonly result: ScenarioResult<Artifact>;
  /** 宿主 stdout 尾部（排查用，可选）。 */
  readonly stdoutTail?: string;
  /** 宿主 stderr 尾部（排查用，可选）。 */
  readonly stderrTail?: string;
}

/** writeScenarioReports 选项。 */
export interface WriteReportsOptions {
  /** 场景 id，进入文件名。 */
  readonly scenarioId: string;
  /** 输出目录。 */
  readonly outDir?: string;
  /** 报告时间戳，进入文件名。 */
  readonly stamp?: string;
  /** 写盘前递归应用的文本脱敏器。 */
  readonly redact?: Redactor;
}

/** 报告输出路径对。 */
export interface ReportPaths {
  /** 结论表路径。 */
  readonly mdPath: string;
  /** 明细路径。 */
  readonly jsonPath: string;
}
