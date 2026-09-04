/**
 * @module scripts/release-notes
 * 从 CHANGELOG.md 提取指定稳定版本的章节，并合成 GitHub Release 正文。
 *
 * 不变量：Release 正文必须携带对应版本的 changelog 章节；章节缺失或为空即失败，
 * 禁止发布无变更说明的稳定制品。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 提取 CHANGELOG 中 `## <version>` 章节的正文（不含标题行）。
 * @param {string} changelog CHANGELOG.md 全文。
 * @param {string} version 不带 v 前缀的稳定版本。
 * @returns {string} 章节正文。
 */
export function extractChangelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex(
    (line) => line === `## ${version}` || line.startsWith(`## ${version} `),
  );
  if (start === -1) {
    throw new Error(`CHANGELOG.md 缺少 ${version} 章节`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  if (!body) {
    throw new Error(`CHANGELOG.md 的 ${version} 章节为空`);
  }
  return body;
}

/**
 * 合成 GitHub Release 正文：changelog 章节在前，安装与安全提示在后。
 * @param {string} version 不带 v 前缀的稳定版本。
 * @param {string} section extractChangelogSection 提取的章节正文。
 * @returns {string} Release 正文 Markdown。
 */
export function composeReleaseBody(version, section) {
  const base = `https://github.com/xnightsky/x-agent-suite/releases/download/v${version}`;
  return `## x-agent-suite v${version}

### 变更

${section}

### 安装

\`\`\`bash
# 使用 pnpm
pnpm add -D ${base}/x-agent-suite-${version}.tgz

# 使用 npm
npm install --save-dev ${base}/x-agent-suite-${version}.tgz

# 使用 yarn
yarn add -D ${base}/x-agent-suite-${version}.tgz
\`\`\`

如果需要 PTY 交互能力：
\`\`\`bash
pnpm add -D ${base}/x-agent-suite-pty-driver-${version}.tgz
\`\`\`

详见 [安装指南](https://github.com/xnightsky/x-agent-suite/blob/main/docs/INSTALLATION.md)。

### ⚠️ 重要提示

本框架会自动化驱动第三方 AI CLI 工具。使用前请阅读：
- [安全策略](https://github.com/xnightsky/x-agent-suite/blob/main/SECURITY.md)
- [风险评估](https://github.com/xnightsky/x-agent-suite/blob/main/docs/research/ai-cli-account-session-risk.md)

**你对使用本框架产生的任何后果（包括账号封禁、费用超支、数据泄露）承担全部责任。**
`;
}

/**
 * 读取仓库根 CHANGELOG.md，提取版本章节并把 Release 正文写入输出文件。
 * @param {{ root: string, version: string, output: string }} options 输入参数。
 */
export function writeReleaseBody(options) {
  const changelog = readFileSync(join(options.root, "CHANGELOG.md"), "utf8");
  const section = extractChangelogSection(changelog, options.version);
  writeFileSync(options.output, composeReleaseBody(options.version, section));
}

function runCli() {
  const [version, output] = process.argv.slice(2);
  if (!version || !output) {
    throw new Error("用法：node scripts/release-notes.mjs <version> <output>");
  }
  writeReleaseBody({ root: process.cwd(), version, output });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release notes 生成失败：${message}\n`);
    process.exitCode = 1;
  }
}
