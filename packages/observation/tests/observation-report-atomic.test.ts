/** 报告原子替换：已打开的读者保留完整旧版本，新读者看到完整新版本。 */
import assert from "node:assert/strict";
import { mkdtemp, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeReportDocument } from "../src/report.ts";
test("同路径诊断更新不截断已打开的 JSON，不遗留临时文件，权限仍为 0600", async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), "report-atomic-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const options = { scenarioId: "atomic", stamp: "fixed", outDir };
  const render = {
    suffix: "diagnostic" as const,
    json: (value: { revision: number }) => value,
    markdown: (value: { revision: number }) => JSON.stringify(value),
  };
  const paths = await writeReportDocument({ revision: 0 }, options, render);
  const reader = await open(paths.jsonPath, "r");
  try {
    await writeReportDocument({ revision: 1 }, options, render);
    assert.equal(JSON.parse(await reader.readFile("utf8")).revision, 0);
    assert.equal(
      JSON.parse(await readFile(paths.jsonPath, "utf8")).revision,
      1,
    );
    assert.equal((await readdir(outDir)).length, 2);
    if (process.platform !== "win32")
      assert.equal((await stat(paths.jsonPath)).mode & 0o777, 0o600);
  } finally {
    await reader.close();
  }
});
