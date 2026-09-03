/**
 * @module examples/tutorial/01-mock-report
 * 最小闭环：MockDriver → Observation → checks → Markdown/JSON report。
 */
import { MockDriver } from "@x-agent-suite/driver";
import { writeScenarioReports } from "@x-agent-suite/observation";
import {
  buildTutorialResult,
  printTutorialSummary,
  resolveTutorialOutDir,
} from "./support.ts";

const scenarioId = "tutorial/mock";
const prompt = "hello tutorial";
const outDir = resolveTutorialOutDir(".tmp/tutorial/mock-report");
const driver = new MockDriver();
const startedAt = Date.now();

await driver.start();
let observation;
try {
  observation = await driver.sendPrompt(prompt);
} finally {
  await driver.close("tutorial complete");
}

const result = buildTutorialResult(observation, prompt, Date.now() - startedAt);
const report = await writeScenarioReports(
  [
    {
      scenario: scenarioId,
      carrier: "mock",
      promptVariant: "default",
      result,
    },
  ],
  { scenarioId, outDir, stamp: "tutorial" },
);

printTutorialSummary({
  recipe: "mock-report",
  dryPass: result.dryPass,
  fuzzyPass: result.fuzzyPass,
  report,
});
