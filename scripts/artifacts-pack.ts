#!/usr/bin/env node
/**
 * @module scripts/artifacts-pack
 * 统一制品 CLI：由 Git history 推导版本，构建并验收制品，成功后补 annotated tag。
 */
import { resolve } from "node:path";

import { buildArtifactSet, rollbackArtifactSet } from "./artifacts-build.ts";
import {
  assertCleanRepository,
  createVersionTag,
  planArtifactVersion,
} from "./artifacts-git.ts";

interface CliOptions {
  readonly expectedVersion?: string;
  readonly snapshot: boolean;
  readonly output?: string;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const options = parseArguments(process.argv.slice(2));
  assertCleanRepository(root);
  const plan = planArtifactVersion({
    root,
    expectedVersion: options.expectedVersion,
    snapshot: options.snapshot,
  });
  const outputDir = resolve(
    root,
    options.output ?? `artifacts/${plan.version}`,
  );
  console.log(
    `[artifacts:pack] ${plan.snapshot ? "snapshot" : "stable"} ${plan.version} <- ${plan.shortCommit}`,
  );
  const result = await buildArtifactSet({
    root,
    outputDir,
    plan,
  });
  try {
    const tagged = createVersionTag(root, plan);
    console.log(`[artifacts:pack] 输出 ${result.outputDir}`);
    console.log(`[artifacts:pack] 文件 ${result.files.join(", ")}`);
    console.log(
      `[artifacts:pack] tag ${tagged ? `已创建 ${plan.tag}` : plan.snapshot ? "snapshot 不创建" : "已存在"}`,
    );
  } catch (error) {
    await rollbackArtifactSet(outputDir);
    throw error;
  }
}

function parseArguments(args: readonly string[]): CliOptions {
  let expectedVersion: string | undefined;
  let output: string | undefined;
  let snapshot = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--version") {
      expectedVersion = requireValue(args, ++index, arg);
    } else if (arg === "--output") {
      output = requireValue(args, ++index, arg);
    } else if (arg === "--snapshot") {
      snapshot = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return { expectedVersion, output, snapshot };
}

function requireValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} 缺少值`);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
