/**
 * @module @x-agent-suite/llm-fixture/target-tag-root
 * 定位本框架源码或聚合制品的公共资源根目录。
 * 不变量：只识别本框架包元数据，不使用 cwd、不发现或识别被测系统。
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TargetTagDefinitionError } from "./target-tag-error.ts";

/** 从模块路径向上定位源码根包或 scoped 聚合包，文件错误与定位失败显式抛出。 */
export async function defaultTagRoot(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (true) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      ) as { readonly name?: unknown };
      if (
        manifest.name === "x-agent-suite" ||
        manifest.name === "@xnightsky/x-agent-suite"
      )
        return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new TargetTagDefinitionError("无法定位 TargetTags 所属包", {
          cause: error,
        });
      }
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new TargetTagDefinitionError("无法定位 TargetTags 所属包");
    directory = parent;
  }
}
