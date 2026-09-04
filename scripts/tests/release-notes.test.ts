/**
 * @module scripts/tests/release-notes
 * Release 正文生成的 changelog 章节提取与合成回归。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  composeReleaseBody,
  extractChangelogSection,
  writeReleaseBody,
} from "../release-notes.mjs";

const CHANGELOG = [
  "# 变更记录",
  "",
  "## Unreleased",
  "",
  "- 未发布条目不应进入任何版本章节",
  "",
  "## 0.2.0 - 2026-09-10",
  "",
  "### Added",
  "",
  "- 新能力甲",
  "",
  "## 0.1.1 - 2026-09-04",
  "",
  "### Fixed",
  "",
  "- 修复乙",
  "",
  "## 0.1.0 - 2026-09-04",
  "",
  "### Added",
  "",
  "- 首个公开发布",
  "",
].join("\n");

test("按版本提取章节且不越界到相邻章节", () => {
  assert.equal(
    extractChangelogSection(CHANGELOG, "0.1.1"),
    "### Fixed\n\n- 修复乙",
  );
  assert.equal(
    extractChangelogSection(CHANGELOG, "0.2.0"),
    "### Added\n\n- 新能力甲",
  );
  assert.equal(
    extractChangelogSection(CHANGELOG, "0.1.0"),
    "### Added\n\n- 首个公开发布",
  );
});

test("缺失或空章节显式失败", () => {
  assert.throws(
    () => extractChangelogSection(CHANGELOG, "9.9.9"),
    /缺少 9\.9\.9 章节/,
  );
  assert.throws(
    () =>
      extractChangelogSection(
        "## 1.0.0 - 2026-01-01\n\n## 0.9.0\n\n- x\n",
        "1.0.0",
      ),
    /1\.0\.0 章节为空/,
  );
});

test("合成的 Release 正文携带 changelog 章节与制品下载地址", () => {
  const body = composeReleaseBody("0.1.1", "### Fixed\n\n- 修复乙");
  assert.match(body, /### 变更\n\n### Fixed\n\n- 修复乙/);
  assert.match(
    body,
    /releases\/download\/v0\.1\.1\/x-agent-suite-0\.1\.1\.tgz/,
  );
  assert.match(
    body,
    /releases\/download\/v0\.1\.1\/x-agent-suite-pty-driver-0\.1\.1\.tgz/,
  );
  assert.doesNotMatch(body, /Unreleased/);
});

test("writeReleaseBody 从仓库 CHANGELOG 读章节并写正文文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "xas-release-notes-"));
  const output = join(root, "body.md");
  try {
    await writeFile(join(root, "CHANGELOG.md"), CHANGELOG);
    writeReleaseBody({ root, version: "0.1.1", output });
    const body = readFileSync(output, "utf8");
    assert.match(body, /- 修复乙/);
    assert.throws(
      () => writeReleaseBody({ root, version: "0.3.0", output }),
      /缺少 0\.3\.0 章节/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release 工作流：正文生成必须排在制品构建之后（artifacts:pack 拒绝脏工作区）", () => {
  const workflow = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      ".github",
      "workflows",
      "release.yml",
    ),
    "utf8",
  );
  const pack = workflow.indexOf("pnpm artifacts:pack");
  const body = workflow.indexOf("release-notes.mjs");
  assert.ok(pack > 0 && body > 0, "release.yml 应包含制品构建与正文生成步骤");
  assert.ok(
    body > pack,
    "正文生成必须在制品构建之后，否则 release-body.md 弄脏工作区",
  );
});
