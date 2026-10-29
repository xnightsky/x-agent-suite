#!/usr/bin/env node
/**
 * @module scripts/publish-release-core
 * 在 GitHub Actions 中补发已存在的核心制品，不构建、不修改标签或 Release。
 * 不变量：凭据、稳定版本、来源提交、双重哈希及 tarball 身份全部通过后才调用 npm。
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { verifyCoreArtifact } from "./install-global.ts";

async function main() {
  const [version, commit, directory, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "") ||
    !/^[a-f\d]{40}$/i.test(commit ?? "") ||
    !directory
  ) {
    throw new Error(
      "用法：publish-release-core <稳定版本> <tag 提交> <制品目录>",
    );
  }
  if (!process.env.NODE_AUTH_TOKEN)
    throw new Error("请配置当前仓库的 NPM_TOKEN");
  const root = resolve(directory);
  const core = await verifyCoreArtifact(root);
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  );
  if (manifest.mode !== "stable") throw new Error("补发只接受 stable 制品");
  if (core.version !== version) throw new Error("制品版本与请求版本不一致");
  if (manifest.commit !== commit) throw new Error("制品提交与 tag 提交不一致");
  const pkg = JSON.parse(
    execFileSync("tar", ["-xOf", core.path, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  if (pkg.name !== "x-agent-suite")
    throw new Error("tarball 内包名不是核心主包");
  if (pkg.version !== version || pkg.private === true)
    throw new Error("tarball 内版本或公开发布属性非法");
  execFileSync(
    "npm",
    [
      "publish",
      core.path,
      "--access",
      "public",
      "--provenance",
      "--ignore-scripts",
      "--registry",
      "https://registry.npmjs.org",
    ],
    { stdio: "inherit" },
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode =
    Number.isInteger(error?.status) && error.status > 0 ? error.status : 1;
});
