/**
 * @module @x-agent-suite/matrix
 * x-agent-suite matrix 层：scenario × carrier × prompt 变体对照运行与报告。
 *
 * 不变量：
 * - 本包不内置任何具体 scenario / driver / profile，只提供编排原语；
 * - 单个 carrier 失败 → 该行标记 skip 并记原因，不影响其余 carrier；
 * - 报告写入由 @x-agent-suite/observation 提供。
 */

export { writeScenarioReports } from "@x-agent-suite/observation";

export type {
  MatrixOptions,
  MatrixResult,
  MatrixRow,
  RunMatrixOptions,
} from "./matrix.ts";

export {
  runMatrix,
  createMatrixRunner,
  toScenarioReportRows,
} from "./matrix.ts";
