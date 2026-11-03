/**
 * 仓库实际 Recall 考卷的现行 schema 守卫；覆盖隐藏文件且零 Driver、零 token。
 */
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseRecallYaml } from "../../packages/recall/src/schema.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

test("仓库全部实际 .recall.yaml 均符合现行 schema", () => {
  const files = globSync(["**/.recall.yaml", "**/.recall.yml"], {
    cwd: repoRoot,
    exclude: ["node_modules/**", ".git/**"],
  }).sort();
  assert.ok(files.includes(".recall.yaml"), "必须覆盖根考卷");
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotThrow(
      () => parseRecallYaml(readFileSync(file, "utf8"), file),
      file,
    );
  }
});
