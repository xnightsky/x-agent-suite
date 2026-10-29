/**
 * @module harness/tests/pi-recall-evidence
 * 直接验证真实文件的证据采集、缺失状态、路径与大小限制，不启动模型。
 */
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectPiRecallEvidence } from "../../../profiles/pi-recall-evidence.ts";

test("清理前采集真实内容与缺失状态，工作区删除后证据仍可用", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "xas-evidence-")));
  try {
    await mkdir(join(root, "out"));
    await writeFile(join(root, "out/report.json"), '{"total":3}\n');
    const evidence = await collectPiRecallEvidence(root, {
      report: "out/report.json",
      absent: "out/absent.json",
    });
    assert.deepEqual(evidence, {
      report: { exists: true, content: '{"total":3}\n' },
      absent: { exists: false },
    });
    await rm(root, { recursive: true, force: true });
    assert.equal(JSON.parse(evidence.report!.content!).total, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("证据采集拒绝逃逸、符号链接与过大文件，不把读取错误当作文件缺失", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "xas-evidence-guard-")),
  );
  try {
    await assert.rejects(
      collectPiRecallEvidence(root, { bad: "../escape.json" }),
      /工作区/,
    );
    await assert.rejects(collectPiRecallEvidence(root, { bad: root }), /相对/);
    await writeFile(join(root, "large.json"), "x".repeat(65537));
    await assert.rejects(
      collectPiRecallEvidence(root, { large: "large.json" }),
      /大小|65536/,
    );
    if (process.platform !== "win32") {
      await symlink(tmpdir(), join(root, "link"), "dir");
      await assert.rejects(
        collectPiRecallEvidence(root, { linked: "link/nonexistent.json" }),
        /符号链接/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
