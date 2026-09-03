/**
 * @module scripts/artifacts-package
 * 生成对外制品清单，并把 declaration 中的 workspace 引用改写为包内路径。
 */
import { posix } from "node:path";

/** 核心聚合包的稳定子路径。 */
export const CORE_EXPORT_NAMES = [
  "contracts",
  "driver",
  "sandbox",
  "llm-fixture",
  "harness",
  "observation",
  "matrix",
] as const;

/** 核心聚合包保持外置的标准运行时依赖及其精确版本范围。 */
export const CORE_EXTERNAL_DEPENDENCIES = {
  tsx: "^4.21.0",
  yaml: "^2.9.0",
} as const;

/** 声明文件的制品形态。 */
export type DeclarationFlavor = "core" | "pty";

interface ExportTarget {
  readonly types: string;
  readonly import: string;
}

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly type: "module";
  readonly license: "MIT";
  readonly engines: { readonly node: ">=24.0.0" };
  readonly exports: Readonly<Record<string, ExportTarget>>;
  readonly files: readonly string[];
  readonly sideEffects: false;
  readonly dependencies?: Readonly<Record<string, string>>;
}

const SOURCE_TYPE_ENTRY = Object.fromEntries(
  CORE_EXPORT_NAMES.map((name) => [
    `@x-agent-suite/${name}`,
    `types/packages/${name}/src/index.d.ts`,
  ]),
) as Readonly<Record<string, string>>;

const CORE_TYPE_ENTRY = Object.fromEntries(
  CORE_EXPORT_NAMES.map((name) => [
    `@x-agent-suite/${name}`,
    `types/packaging/entries/${name}.d.ts`,
  ]),
) as Readonly<Record<string, string>>;

/** 创建零原生依赖、外置纯 JS 依赖的核心聚合包清单。 */
export function createCorePackageManifest(version: string): PackageManifest {
  const exports = Object.fromEntries(
    CORE_EXPORT_NAMES.map((name) => [
      `./${name}`,
      {
        types: `./types/packaging/entries/${name}.d.ts`,
        import: `./dist/${name}.js`,
      },
    ]),
  );
  return {
    name: "x-agent-suite",
    version,
    description: "通用 Agent 测试套件框架的聚合分发包。",
    type: "module",
    license: "MIT",
    engines: { node: ">=24.0.0" },
    exports,
    files: ["dist", "types", "README.md", "LICENSE"],
    sideEffects: false,
    dependencies: CORE_EXTERNAL_DEPENDENCIES,
  };
}

/** 创建显式承载原生终端依赖的 PTY 包清单。 */
export function createPtyPackageManifest(version: string): PackageManifest {
  return {
    name: "@x-agent-suite/pty-driver",
    version,
    description: "x-agent-suite 的 PTY 与长驻终端驱动分发包。",
    type: "module",
    license: "MIT",
    engines: { node: ">=24.0.0" },
    exports: {
      ".": {
        types: "./types/packaging/entries/pty-driver.d.ts",
        import: "./dist/index.js",
      },
    },
    files: ["dist", "types", "README.md", "LICENSE"],
    sideEffects: false,
    dependencies: {
      "@lydell/node-pty": "^1.1.0",
      "@xterm/headless": "^5.5.0",
    },
  };
}

/** 把 declaration 中的 TS 后缀和内部 workspace 包名改成制品内相对路径。 */
export function rewriteDeclarationSpecifiers(
  source: string,
  declarationPath: string,
  flavor: DeclarationFlavor,
): string {
  const aliases = flavor === "core" ? CORE_TYPE_ENTRY : SOURCE_TYPE_ENTRY;
  let rewritten = source.replace(
    /(["'])(@x-agent-suite\/[a-z-]+)\1/g,
    (_match, quote: string, packageName: string) => {
      const target = aliases[packageName];
      if (!target) {
        throw new Error(`声明文件含未知内部包：${packageName}`);
      }
      const relative = posix.relative(posix.dirname(declarationPath), target);
      const specifier = relative.startsWith(".") ? relative : `./${relative}`;
      return `${quote}${specifier.replace(/\.d\.ts$/, ".js")}${quote}`;
    },
  );
  rewritten = rewritten.replace(
    /(["'])(\.\.?\/[^"']+)\1/g,
    (_match, quote: string, specifier: string) => {
      const extension = posix.extname(specifier);
      const normalized =
        extension === ".ts"
          ? `${specifier.slice(0, -3)}.js`
          : extension
            ? specifier
            : `${specifier}.js`;
      return `${quote}${normalized}${quote}`;
    },
  );
  return rewritten;
}
