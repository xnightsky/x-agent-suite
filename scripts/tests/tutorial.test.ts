/**
 * @module scripts/tests/tutorial
 * 教程契约测试：公开运行时导出、教程目录、示例与 AI 导航保持同步。
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "../..");
const execFileAsync = promisify(execFile);
const PACKAGE_IDS = [
  "contracts",
  "driver",
  "sandbox",
  "llm-fixture",
  "harness",
  "observation",
  "matrix",
] as const;

interface TutorialCatalog {
  readonly toolsFile?: string;
  readonly packages: readonly {
    readonly id: string;
    readonly tools: readonly {
      readonly name: string;
      readonly category: string;
      readonly purpose: string;
      readonly risk: string;
      readonly recipes?: readonly string[];
      readonly reason?: string;
    }[];
  }[];
  readonly recipes: readonly {
    readonly id: string;
    readonly source: string;
    readonly guide: string;
    readonly command: string;
    readonly modules: readonly string[];
  }[];
  readonly combinations: readonly {
    readonly status: "supported" | "conditional" | "planned";
    readonly recipe?: string;
    readonly requires?: readonly string[];
  }[];
}

async function readCatalog(): Promise<TutorialCatalog> {
  const path = resolve(ROOT, "docs/tutorial/catalog.json");
  const catalog = JSON.parse(await readFile(path, "utf8")) as TutorialCatalog;
  if (!catalog.toolsFile) return catalog;
  const tools = JSON.parse(
    await readFile(resolve(dirname(path), catalog.toolsFile), "utf8"),
  ) as Pick<TutorialCatalog, "packages">;
  return { ...catalog, packages: tools.packages };
}

async function runtimeExports(file: string): Promise<Set<string>> {
  const source = ts.createSourceFile(
    file,
    await readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      await collectExportDeclaration(file, statement, names);
    } else if (
      hasExportModifier(statement) &&
      isRuntimeDeclaration(statement)
    ) {
      const name = declarationName(statement);
      if (name) names.add(name);
    }
  }
  return names;
}

async function collectExportDeclaration(
  file: string,
  declaration: ts.ExportDeclaration,
  names: Set<string>,
): Promise<void> {
  if (declaration.isTypeOnly) return;
  if (declaration.exportClause && ts.isNamedExports(declaration.exportClause)) {
    for (const item of declaration.exportClause.elements) {
      if (!item.isTypeOnly) names.add(item.name.text);
    }
    return;
  }
  const specifier = declaration.moduleSpecifier;
  if (
    !specifier ||
    !ts.isStringLiteral(specifier) ||
    !specifier.text.startsWith(".")
  ) {
    return;
  }
  const target = resolve(dirname(file), specifier.text.replace(/\.ts$/, ".ts"));
  for (const name of await runtimeExports(target)) names.add(name);
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts
        .getModifiers(node)
        ?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword) ?? false)
    : false;
}

function isRuntimeDeclaration(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isVariableStatement(node) ||
    ts.isEnumDeclaration(node)
  );
}

function declarationName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text;
  }
  if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0];
    return declaration && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined;
  }
  return undefined;
}

async function runRecipe(
  source: string,
): Promise<{ summary: Record<string, unknown>; outDir: string }> {
  const outDir = await mkdtemp(join(tmpdir(), "xas-tutorial-"));
  // 直接以 node 跑 tsx CLI，绕开 win32 下 execFile 拒绝 .cmd（EINVAL）的硬化限制。
  const command = process.execPath;
  const tsxCli = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    XAS_TUTORIAL_OUT_DIR: outDir,
  };
  delete childEnv["NODE_TEST_CONTEXT"];
  delete childEnv["XAS_TUTORIAL_LIVE_AUTHORIZATION"];
  try {
    const { stdout } = await execFileAsync(
      command,
      [tsxCli, "--test", source],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: childEnv,
      },
    );
    const summaryLine = stdout
      .split(/\r?\n/)
      .find((line) => line.includes("TUTORIAL_SUMMARY "));
    assert.ok(summaryLine, `${source} 未输出教程摘要`);
    const json = summaryLine.slice(
      summaryLine.indexOf("TUTORIAL_SUMMARY ") + "TUTORIAL_SUMMARY ".length,
    );
    return { summary: JSON.parse(json) as Record<string, unknown>, outDir };
  } catch (error) {
    await rm(outDir, { recursive: true, force: true });
    throw error;
  }
}

test("教程目录覆盖七个包的全部公开运行时导出", async () => {
  const catalog = await readCatalog();
  assert.deepEqual(
    catalog.packages.map((item) => item.id),
    PACKAGE_IDS,
  );
  for (const packageId of PACKAGE_IDS) {
    const documented = catalog.packages.find((item) => item.id === packageId);
    assert.ok(documented, `缺少包目录：${packageId}`);
    const actual = await runtimeExports(
      resolve(ROOT, `packages/${packageId}/src/index.ts`),
    );
    assert.deepEqual(
      documented.tools.map((item) => item.name).sort(),
      [...actual].sort(),
      `${packageId} 的运行时导出目录已漂移`,
    );
  }
});

test("工具与组合目录提供可执行入口或明确停点", async () => {
  const catalog = await readCatalog();
  assert.equal(catalog.toolsFile, "tools.json");
  const recipeIds = new Set(catalog.recipes.map((recipe) => recipe.id));
  const packageIds = new Set(catalog.packages.map((item) => item.id));
  for (const item of catalog.packages) {
    for (const tool of item.tools) {
      const recipes = tool.recipes ?? [];
      assert.ok(
        tool.category && tool.purpose && tool.risk,
        `${tool.name} 分类不完整`,
      );
      assert.ok(
        recipes.length > 0 || tool.reason,
        `${tool.name} 缺少 recipe 或停点说明`,
      );
      for (const recipe of recipes) {
        assert.ok(
          recipeIds.has(recipe),
          `${tool.name} 引用了未知 recipe: ${recipe}`,
        );
      }
    }
  }
  for (const recipe of catalog.recipes) {
    assert.match(
      recipe.source,
      /(?:\.test|\.ittest|\.token\.ittest)\.ts$/,
      `${recipe.id} 未遵守测试分层后缀`,
    );
    for (const moduleId of recipe.modules) {
      assert.ok(
        packageIds.has(moduleId),
        `${recipe.id} 引用了未知包: ${moduleId}`,
      );
    }
  }
  for (const combination of catalog.combinations) {
    if (
      combination.status === "supported" ||
      combination.status === "conditional"
    ) {
      assert.ok(combination.recipe && recipeIds.has(combination.recipe));
    } else {
      assert.ok(combination.requires && combination.requires.length > 0);
    }
  }
});

test("教程、支持矩阵与示例通过同一个 recipe 打通", async () => {
  const catalog = await readCatalog();
  assert.ok(catalog.recipes.length >= 10);
  assert.ok(
    catalog.recipes.some(
      (recipe) =>
        recipe.source.startsWith("examples/tutorial/") &&
        recipe.source.endsWith(".ittest.ts") &&
        !recipe.source.endsWith(".token.ittest.ts"),
    ),
    "教程目录缺少真实宿主 *.ittest.ts 证据",
  );
  assert.ok(
    catalog.recipes.some(
      (recipe) =>
        recipe.source.startsWith("examples/tutorial/") &&
        recipe.source.endsWith(".token.ittest.ts"),
    ),
    "教程目录缺少真实 provider *.token.ittest.ts 证据",
  );
  const combinations = await readFile(
    resolve(ROOT, "docs/tutorial/combinations.md"),
    "utf8",
  );
  for (const recipe of catalog.recipes) {
    const source = resolve(ROOT, recipe.source);
    const guide = resolve(ROOT, recipe.guide);
    assert.match(
      recipe.source,
      /(?:\.test|\.ittest|\.token\.ittest)\.ts$/,
      `${recipe.id} 未遵守测试分层后缀`,
    );
    await access(source);
    await access(guide);
    const guideText = await readFile(guide, "utf8");
    assert.ok(guideText.includes(recipe.source), `${recipe.id} 教程未链接源码`);
    assert.ok(
      guideText.includes(recipe.command),
      `${recipe.id} 教程未给出命令`,
    );
    assert.ok(
      combinations.includes(`](./recipes/${recipe.id}.md)`),
      `${recipe.id} 未从支持矩阵链接到详细教程`,
    );
  }
});

test("AGENTS 为玩法问题提供教程上下文指针", async () => {
  const agents = await readFile(resolve(ROOT, "AGENTS.md"), "utf8");
  assert.match(agents, /玩法.*docs\/tutorial\/README\.md/);
  assert.match(agents, /组合.*docs\/tutorial\/catalog\.json/);
});

test("mock-report 跑通 Observation、checks 与双格式报告", async () => {
  const { summary, outDir } = await runRecipe(
    "examples/tutorial/01-mock-report.test.ts",
  );
  try {
    assert.equal(summary.recipe, "mock-report");
    assert.equal(summary.dryPass, true);
    assert.equal(summary.fuzzyPass, true);
    const report = summary.report as { mdPath: string; jsonPath: string };
    assert.match(
      await readFile(report.mdPath, "utf8"),
      /# 报告：tutorial\/mock/,
    );
    assert.equal(
      (
        JSON.parse(await readFile(report.jsonPath, "utf8")) as {
          scenario: string;
        }
      ).scenario,
      "tutorial/mock",
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("sandbox-jsonl 在隔离 cwd 读取记录并完成清理", async () => {
  const { summary, outDir } = await runRecipe(
    "examples/tutorial/02-sandbox-jsonl.test.ts",
  );
  try {
    assert.equal(summary.recipe, "sandbox-jsonl");
    assert.equal(summary.cwdMatches, true);
    assert.equal(summary.cleaned, true);
    assert.deepEqual(summary.record, { kind: "ready", isolated: true });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("fixture-backend 完成工具轮与文本收尾轮", async () => {
  const { summary, outDir } = await runRecipe(
    "examples/tutorial/03-fixture-backend.test.ts",
  );
  try {
    assert.equal(summary.recipe, "fixture-backend");
    assert.equal(summary.toolCallSeen, true);
    assert.equal(summary.finalTextSeen, true);
    assert.equal(summary.requestCount, 2);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("matrix-report 运行四种组合并写双格式报告", async () => {
  const { summary, outDir } = await runRecipe(
    "examples/tutorial/04-matrix.test.ts",
  );
  try {
    assert.equal(summary.recipe, "matrix-report");
    assert.equal(summary.okCount, 4);
    assert.equal(summary.skipCount, 0);
    assert.equal(summary.failCount, 0);
    const report = summary.report as { mdPath: string; jsonPath: string };
    await access(report.mdPath);
    const detail = JSON.parse(await readFile(report.jsonPath, "utf8")) as {
      rows: unknown[];
    };
    assert.equal(detail.rows.length, 4);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("headless-fixture 通过 profile 驱动假端点并归一 Observation", async () => {
  const { summary, outDir } = await runRecipe(
    "examples/tutorial/05-headless-fixture.test.ts",
  );
  try {
    assert.equal(summary.recipe, "headless-fixture");
    assert.equal(summary.toolCallsCount, 1);
    assert.equal(summary.text, "HEADLESS_DONE");
    assert.equal(summary.backendRequests, 2);
    assert.equal(summary.cleaned, true);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("long-lived 在同一会话完成两轮并匹配入站事件", async () => {
  const { summary, outDir } = await runRecipe(
    "examples/tutorial/06-long-lived.test.ts",
  );
  try {
    assert.equal(summary.recipe, "long-lived");
    assert.equal(summary.turns, 2);
    assert.equal(summary.inboundKind, "notification");
    assert.equal(summary.injectMode, "followUp");
    assert.equal(summary.closed, true);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("long-lived-wire 通过假 peer 完成握手、两轮注入与幂等关闭", async () => {
  const { summary, outDir } = await runRecipe(
    "examples/tutorial/06-long-lived-wire.test.ts",
  );
  try {
    assert.equal(summary.recipe, "long-lived-wire");
    assert.equal(summary.turns, 2);
    assert.equal(summary.firstText, "echo:first turn");
    assert.equal(summary.secondText, "echo:second turn");
    assert.equal(summary.inboundKind, "notification");
    assert.equal(summary.injectMode, "followUp");
    assert.equal(summary.closed, true);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("pty 在通用 TUI 中完成就绪、输入提交与沙箱清理", async () => {
  const { summary, outDir } = await runRecipe(
    "examples/tutorial/07-pty.test.ts",
  );
  try {
    assert.equal(summary.recipe, "pty");
    assert.equal(summary.ready, true);
    assert.equal(summary.promptSeen, true);
    assert.equal(summary.injectMode, "followUp");
    assert.equal(summary.cleaned, true);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("live-guard 默认不出网且所有诊断经过脱敏", async () => {
  const { summary, outDir } = await runRecipe(
    "examples/tutorial/08-live-guard.test.ts",
  );
  try {
    assert.equal(summary.recipe, "live-guard");
    assert.equal(summary.authorized, false);
    assert.equal(summary.networkAttempted, false);
    assert.equal(summary.redacted, true);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("package scripts 暴露安全教程命令且 typecheck 覆盖示例", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(ROOT, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.deepEqual(
    {
      tutorial: packageJson.scripts.tutorial,
      "tutorial:sandbox": packageJson.scripts["tutorial:sandbox"],
      "tutorial:fixture": packageJson.scripts["tutorial:fixture"],
      "tutorial:matrix": packageJson.scripts["tutorial:matrix"],
      "tutorial:headless": packageJson.scripts["tutorial:headless"],
      "tutorial:long-lived": packageJson.scripts["tutorial:long-lived"],
      "tutorial:pty": packageJson.scripts["tutorial:pty"],
      "tutorial:live:guard": packageJson.scripts["tutorial:live:guard"],
      "tutorial:pty:pi": packageJson.scripts["tutorial:pty:pi"],
      "itest:token:tutorial": packageJson.scripts["itest:token:tutorial"],
      "tutorial:check": packageJson.scripts["tutorial:check"],
    },
    {
      tutorial: "tsx --test examples/tutorial/01-mock-report.test.ts",
      "tutorial:sandbox":
        "tsx --test examples/tutorial/02-sandbox-jsonl.test.ts",
      "tutorial:fixture":
        "tsx --test examples/tutorial/03-fixture-backend.test.ts",
      "tutorial:matrix": "tsx --test examples/tutorial/04-matrix.test.ts",
      "tutorial:headless":
        "tsx --test examples/tutorial/05-headless-fixture.test.ts",
      "tutorial:long-lived":
        "tsx --test examples/tutorial/06-long-lived.test.ts",
      "tutorial:pty": "tsx --test examples/tutorial/07-pty.test.ts",
      "tutorial:live:guard":
        "tsx --test examples/tutorial/08-live-guard.test.ts",
      "tutorial:pty:pi": "tsx --test examples/tutorial/09-pi-pty.ittest.ts",
      "itest:token:tutorial":
        "tsx --test examples/tutorial/10-live-smoke.token.ittest.ts",
      "tutorial:check": "tsx --test scripts/tests/tutorial.test.ts",
    },
  );
  assert.equal("tutorial:live" in packageJson.scripts, false);

  const tsconfig = JSON.parse(
    await readFile(resolve(ROOT, "tsconfig.json"), "utf8"),
  ) as { include: string[] };
  assert.ok(tsconfig.include.includes("examples/tutorial/**/*.ts"));
});
