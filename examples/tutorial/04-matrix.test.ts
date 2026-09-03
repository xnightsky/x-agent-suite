/**
 * @module examples/tutorial/04-matrix
 * 对照组合：两个 MockDriver × 两个 prompt 变体 → Matrix → 双格式报告。
 */
import { MockDriver } from "@x-agent-suite/driver";
import {
  runMatrix,
  toScenarioReportRows,
  writeScenarioReports,
} from "@x-agent-suite/matrix";
import {
  buildTutorialResult,
  printTutorialSummary,
  resolveTutorialOutDir,
} from "./support.ts";

const scenarioId = "tutorial/matrix";
const outDir = resolveTutorialOutDir(".tmp/tutorial/matrix-report");
const result = await runMatrix(
  {
    carriers: ["mock-a", "mock-b"],
    getVariants: () => ["brief", "detailed"],
    createDriver: async () => new MockDriver(),
    runScenario: async ({ carrier, promptVariant, driver }) => {
      await driver.start();
      const prompt = `${carrier}:${promptVariant}`;
      const observation = await driver.sendPrompt(prompt);
      return buildTutorialResult(observation, prompt);
    },
  },
  { scenarioId },
);
const report = await writeScenarioReports(toScenarioReportRows(result.rows), {
  scenarioId,
  outDir,
  stamp: "tutorial",
});

printTutorialSummary({
  recipe: "matrix-report",
  okCount: result.okCount,
  skipCount: result.skipCount,
  failCount: result.failCount,
  report,
});
