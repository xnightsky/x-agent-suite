/**
 * @module scripts/artifacts-build
 * 构建聚合 JS/声明、打 tarball、生成清单与校验和，并做仓库外安装冒烟。
 *
 * 不变量：打包暂存区落在仓库内（root/.tmp，已 gitignore），保证 esbuild
 * sourcemap 的 sources 只含仓库相对路径——制品规范禁止 tarball 携带绝对路径。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { build } from "esbuild";

import {
  CORE_EXPORT_NAMES,
  CORE_EXTERNAL_DEPENDENCIES,
  createCorePackageManifest,
  createPtyPackageManifest,
  rewriteDeclarationSpecifiers,
  type DeclarationFlavor,
} from "./artifacts-package.ts";
import type { ArtifactVersionPlan } from "./artifacts-git.ts";
import {
  createArtifactManifest,
  type ArtifactDescriptor,
} from "./artifacts-manifest.ts";
import { smokeInstall } from "./artifacts-smoke.ts";

/** 制品构建选项。 */
export interface BuildArtifactOptions {
  readonly root: string;
  readonly outputDir: string;
  readonly plan: ArtifactVersionPlan;
  readonly runChecks?: boolean;
}

/** 一次完整制品构建结果。 */
export interface BuildArtifactResult {
  readonly outputDir: string;
  readonly files: readonly string[];
}

const ESM_REQUIRE_BANNER =
  'import { createRequire as __xasCreateRequire } from "node:module"; const require = __xasCreateRequire(import.meta.url);';

/** 生成完整、经安装冒烟的制品目录。 */
export async function buildArtifactSet(
  options: BuildArtifactOptions,
): Promise<BuildArtifactResult> {
  await assertOutputAbsent(options.outputDir);
  if (options.runChecks !== false) {
    run("pnpm", ["check"], options.root);
  }
  const stageRoot = join(options.root, ".tmp");
  await mkdir(stageRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(stageRoot, "xas-artifacts-"));
  try {
    const candidateDir = await buildCandidate(options, tempRoot);
    await mkdir(dirname(options.outputDir), { recursive: true });
    await cp(candidateDir, options.outputDir, {
      recursive: true,
      errorOnExist: true,
    });
    return {
      outputDir: options.outputDir,
      files: (await readdir(options.outputDir)).sort(),
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function buildCandidate(
  options: BuildArtifactOptions,
  tempRoot: string,
): Promise<string> {
  const candidateDir = join(tempRoot, "candidate");
  const typesSource = join(tempRoot, "types-source");
  const coreStage = join(tempRoot, "core-package");
  const ptyStage = join(tempRoot, "pty-package");
  await Promise.all([
    mkdir(candidateDir, { recursive: true }),
    emitDeclarations(options.root, typesSource),
    bundleCore(options.root, coreStage),
    bundlePty(options.root, ptyStage),
  ]);
  await Promise.all([
    preparePackage(
      options.root,
      coreStage,
      typesSource,
      "core",
      options.plan.version,
    ),
    preparePackage(
      options.root,
      ptyStage,
      typesSource,
      "pty",
      options.plan.version,
    ),
  ]);
  await assertCorePackageIntegrity(coreStage);
  await packPackage(coreStage, candidateDir);
  await packPackage(ptyStage, candidateDir);
  const artifacts = await collectTarballHashes(candidateDir);
  await writeMetadata(candidateDir, options.plan, artifacts, options.root);
  await smokeInstall(candidateDir, options.root, artifacts, run);
  return candidateDir;
}

/** 删除本轮新生成且尚未发布 tag 的制品目录。 */
export async function rollbackArtifactSet(outputDir: string): Promise<void> {
  await rm(outputDir, { recursive: true, force: true });
}

async function emitDeclarations(root: string, outDir: string): Promise<void> {
  run(
    "pnpm",
    ["exec", "tsc", "-p", "tsconfig.build.json", "--outDir", outDir],
    root,
  );
}

async function bundleCore(root: string, stage: string): Promise<void> {
  const entries = Object.fromEntries(
    CORE_EXPORT_NAMES.map((name) => [
      name,
      join(root, "packaging", "entries", `${name}.ts`),
    ]),
  );
  const alias = Object.fromEntries(
    CORE_EXPORT_NAMES.map((name) => [
      `@x-agent-suite/${name}`,
      join(root, "packaging", "entries", `${name}.ts`),
    ]),
  );
  await build({
    absWorkingDir: root,
    entryPoints: entries,
    outdir: join(stage, "dist"),
    alias,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    sourcemap: true,
    banner: { js: ESM_REQUIRE_BANNER },
    external: Object.keys(CORE_EXTERNAL_DEPENDENCIES),
  });
}

async function bundlePty(root: string, stage: string): Promise<void> {
  await build({
    absWorkingDir: root,
    entryPoints: { index: join(root, "packaging", "entries", "pty-driver.ts") },
    outdir: join(stage, "dist"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    sourcemap: true,
    banner: { js: ESM_REQUIRE_BANNER },
    external: ["node-pty", "@lydell/node-pty", "@xterm/headless"],
  });
}

/**
 * 校验核心暂存包精确声明 external 依赖，且 JS 与 sourcemap 未复制其实现。
 */
export async function assertCorePackageIntegrity(stage: string): Promise<void> {
  const manifestFile = join(stage, "package.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  for (const [dependency, range] of Object.entries(
    CORE_EXTERNAL_DEPENDENCIES,
  )) {
    if (manifest.dependencies?.[dependency] !== range) {
      throw new Error(
        `核心制品完整性失败：package.json 的依赖 ${dependency} 必须为 ${range}`,
      );
    }
  }
  for (const file of await walkFiles(join(stage, "dist"))) {
    if (file.endsWith(".js")) {
      assertNoExternalImplementation(stage, file, await readFile(file, "utf8"));
    } else if (file.endsWith(".js.map")) {
      await assertSourceMapExternal(stage, file);
    }
  }
}

async function assertSourceMapExternal(
  stage: string,
  file: string,
): Promise<void> {
  const sourceMap = JSON.parse(await readFile(file, "utf8")) as {
    readonly sources?: readonly unknown[];
    readonly sourcesContent?: readonly unknown[];
  };
  for (const value of [
    ...(sourceMap.sources ?? []),
    ...(sourceMap.sourcesContent ?? []),
  ]) {
    if (typeof value === "string") {
      assertNoExternalImplementation(stage, file, value);
    }
  }
}

function assertNoExternalImplementation(
  stage: string,
  file: string,
  content: string,
): void {
  const normalized = `/${content.replaceAll("\\", "/")}`;
  for (const dependency of Object.keys(CORE_EXTERNAL_DEPENDENCIES)) {
    if (normalized.includes(`/node_modules/${dependency}/`)) {
      throw new Error(
        `核心制品完整性失败：${toPosix(relative(stage, file))} 包含 external 依赖 ${dependency} 的 node_modules 实现路径`,
      );
    }
  }
}

async function preparePackage(
  root: string,
  stage: string,
  typesSource: string,
  flavor: DeclarationFlavor,
  version: string,
): Promise<void> {
  const typesDir = join(stage, "types");
  await cp(typesSource, typesDir, { recursive: true });
  await rewriteDeclarationTree(typesDir, flavor);
  const manifest =
    flavor === "core"
      ? createCorePackageManifest(version)
      : createPtyPackageManifest(version);
  await Promise.all([
    writeFile(
      join(stage, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
    cp(join(root, "README.md"), join(stage, "README.md")),
    cp(join(root, "LICENSE"), join(stage, "LICENSE")),
  ]);
}

async function rewriteDeclarationTree(
  typesDir: string,
  flavor: DeclarationFlavor,
): Promise<void> {
  for (const file of await walkFiles(typesDir)) {
    if (!file.endsWith(".d.ts")) {
      continue;
    }
    const declarationPath = toPosix(join("types", relative(typesDir, file)));
    const source = await readFile(file, "utf8");
    const rewritten = rewriteDeclarationSpecifiers(
      source,
      declarationPath,
      flavor,
    );
    await writeFile(file, rewritten, "utf8");
  }
}

async function packPackage(stage: string, destination: string): Promise<void> {
  run("pnpm", ["pack", "--pack-destination", destination], stage);
}

async function collectTarballHashes(
  directory: string,
): Promise<ArtifactDescriptor[]> {
  const tarballs = (await readdir(directory))
    .filter((file) => file.endsWith(".tgz"))
    .sort();
  if (tarballs.length !== 2) {
    throw new Error(`期望 2 个 tarball，实际得到 ${tarballs.length} 个`);
  }
  return Promise.all(
    tarballs.map(async (file) => ({
      file,
      sha256: await hashFile(join(directory, file)),
      kind: file.startsWith("x-agent-suite-pty-driver-") ? "pty" : "core",
    })),
  );
}

async function writeMetadata(
  directory: string,
  plan: ArtifactVersionPlan,
  artifacts: readonly ArtifactDescriptor[],
  root: string,
): Promise<void> {
  const manifest = createArtifactManifest(plan, artifacts, {
    builtAt: new Date().toISOString(),
    node: process.version,
    pnpm: capture("pnpm", ["--version"], root).trim(),
  });
  const manifestPath = join(directory, "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const sums = [
    ...artifacts,
    { file: "manifest.json", sha256: await hashFile(manifestPath) },
  ]
    .map((item) => `${item.sha256}  ${item.file}`)
    .join("\n");
  await writeFile(join(directory, "SHA256SUMS"), `${sums}\n`, "utf8");
}

async function walkFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function hashFile(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

async function assertOutputAbsent(outputDir: string): Promise<void> {
  try {
    await access(outputDir);
    throw new Error(`制品目录已存在，拒绝覆盖：${outputDir}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function run(command: string, args: readonly string[], cwd: string): void {
  const invoker = command === "pnpm" ? pnpmInvoker() : { command, prefix: [] };
  execFileSync(invoker.command, [...invoker.prefix, ...args], {
    cwd,
    stdio: "inherit",
  });
}

function capture(
  command: string,
  args: readonly string[],
  cwd: string,
): string {
  const invoker = command === "pnpm" ? pnpmInvoker() : { command, prefix: [] };
  return execFileSync(invoker.command, [...invoker.prefix, ...args], {
    cwd,
    encoding: "utf8",
  });
}

/**
 * 解析 pnpm 的跨平台调用方式。
 * 优先经 npm_execpath 以 node 直跑 pnpm CLI，绕开 win32 下
 * execFile 无法解析/拒绝 .cmd 脚本（ENOENT / EINVAL）的硬化限制。
 */
function pnpmInvoker(): {
  readonly command: string;
  readonly prefix: readonly string[];
} {
  const execPath = process.env.npm_execpath;
  if (execPath && /\.c?js$/.test(execPath)) {
    return { command: process.execPath, prefix: [execPath] };
  }
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      prefix: ["/d", "/s", "/c", "pnpm"],
    };
  }
  return { command: "pnpm", prefix: [] };
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.replaceAll(sep, "/");
}
