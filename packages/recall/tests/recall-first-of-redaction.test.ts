/** 组合报告、原始 Judge 与事件均应用 Judge Driver 的独立 redactor，零 token。 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { runRecall } from "../src/index.ts";
import {
  firstOfBranches as branches,
  firstOfWorkspace,
} from "./fixtures/first-of-workspace.ts";
for (const fail of [false, true])
  test(`Judge 专属 redactor 保护 ${fail ? "ERROR" : "正常"} 出口`, async (t) => {
    const ws = await firstOfWorkspace(t, {
      firstOf: {
        quality: branches("fail-private-marker", "pass-private-marker"),
      },
    });
    await writeFile(
      ws.registryPath,
      `import base from ${JSON.stringify(ws.registry)};
export default { ...base, profiles: { ...base.profiles, 'fixture-direct': {
  ...base.profiles['fixture-direct'], async createDriver(context) {
    const driver = await base.profiles['fixture-direct'].createDriver(context);
    if (context.spec.id !== 'recall/judge') return driver;
    return { redactor: text => text.replaceAll('private-marker', '[REDACTED]'),
      start: () => driver.start(), events: () => driver.events(), close: reason => driver.close(reason),
      sendPrompt: ${fail ? "async prompt => { if (prompt.includes('1. pass-private-marker:')) throw new Error('private-marker'); return driver.sendPrompt(prompt); }" : "prompt => driver.sendPrompt(prompt)"},
    };
  },
} } };`,
    );
    const output: unknown[] = [];
    const result = await runRecall(ws.options, (event) => output.push(event));
    assert.equal(result.failures.length, fail ? 1 : 0);
    const paths = fail ? result.failures[0]!.reports! : result.runs[0]!.reports;
    for (const path of [paths.mdPath, paths.jsonPath]) {
      const text = await readFile(path, "utf8");
      assert.doesNotMatch(text, /private-marker/);
      assert.match(text, /REDACTED/);
    }
    assert.doesNotMatch(JSON.stringify(output), /private-marker/);
  });
