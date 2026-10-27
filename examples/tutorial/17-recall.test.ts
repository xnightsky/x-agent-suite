/**
 * @module examples/tutorial/recall
 * 教程：显式 target、独立 registry、effects-only Plan、文件内场景 plans（零 token）。
 * 运行：pnpm tutorial:recall。本文件是消费者示例，不是框架 API。
 */
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRecall } from "@x-agent-suite/recall";
import { main } from "../../packaging/cli.ts";
import { printTutorialSummary, resolveTutorialOutDir } from "./support.ts";

async function reportFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return reportFiles(path);
      return entry.name.endsWith("-report.json") ? [path] : [];
    }),
  );
  return nested.flat();
}

test("tutorial/recall：显式执行并编译文件内 plans", async () => {
  const outDir = resolveTutorialOutDir(".tmp/tutorial/recall");
  const cwd = await mkdtemp(join(tmpdir(), "xas-tutorial-recall-"));
  try {
    await mkdir(join(cwd, ".recall"));
    await writeFile(join(cwd, "package.json"), '{"type":"module"}\n');
    await writeFile(join(cwd, "CONTEXT.md"), "read only context");
    const registryPath = join(cwd, "registry.ts");
    await writeFile(
      registryPath,
      "export { default } from " +
        JSON.stringify(
          new URL("./fixtures/tutorial-recall.registry.ts", import.meta.url)
            .href,
        ) +
        ";\n",
    );
    const planPath = join(cwd, ".recall", "execution.yaml");
    await writeFile(planPath, "version: 1\neffects: none\n");
    const recallPath = join(cwd, ".recall", "project-rules.yaml");
    await writeFile(
      recallPath,
      `version: 1
id: tutorial-recall
plans:
  local:
    resources:
      - source: CONTEXT.md
        destination: CONTEXT.md
context:
  plan: local
cases:
  - id: multi-turn
    turns:
      - send: first
        expect:
          text-contains: [first]
      - send: second
        expect:
          text-contains: [second]
`,
    );
    const livePath = join(cwd, "private-live.yaml");
    await writeFile(
      livePath,
      `carriers:
  tutorial-carrier:
    providers:
      tutorial-provider:
        models: [tutorial-model]
        wire: openai-chat
        baseUrl: https://tutorial.invalid/v1
        apiKey: tutorial-key
    default: tutorial-provider/tutorial-model
targetTags:
  version: 1
  cli:
    - id: tutorial-cli
      carrier: tutorial-carrier
      wires: [openai-chat]
      tags: [
        cli.execution.one-shot,
        cli.execution.unattended,
        cli.session.ephemeral,
        cli.context.context-files.off,
        cli.context.extensions.off,
        cli.context.skills.off,
        cli.tools.none,
        cli.io.text,
      ]
  providers:
    - id: tutorial-provider
      tags: [provider.usage.cli-subscription, provider.usage.live.allowed]
  providerModels:
    - id: tutorial-provider/tutorial-model
      providerRef: tutorial-provider
      model: tutorial-model
      modelRef: tutorial-model
      wire: openai-chat
      tags: [provider-model.api.complete]
  models:
    - id: tutorial-model
      tags: [model.inference.chat]
`,
    );
    const selection = { carrier: "tutorial-carrier" };
    const loaded = await loadRecall({
      cwd,
      selection,
      liveConfigPath: livePath,
      registryPath,
      planPath,
    });
    const provision = loaded.scenarios[0]!.provision as {
      plan: string;
      resources: { source: string; destination: string }[];
    };
    assert.equal(provision.plan, "local");
    assert.equal(provision.resources[0]!.destination, "CONTEXT.md");
    assert.equal(
      await readFile(provision.resources[0]!.source, "utf8"),
      "read only context",
    );

    const before = new Set(await reportFiles(outDir));
    const exitCode = await main(
      [
        "recall",
        "--carrier",
        "tutorial-carrier",
        "--live-config",
        livePath,
        "--registry",
        registryPath,
        "--plan",
        planPath,
        "--out-dir",
        outDir,
        recallPath,
      ],
      { cwd },
    );
    assert.equal(exitCode, 0);
    const files = (await reportFiles(outDir)).filter(
      (file) => !before.has(file),
    );
    assert.equal(files.length, 1);
    const report = JSON.parse(await readFile(files[0]!, "utf8"));
    assert.equal(report.scenario, "tutorial-recall/multi-turn");
    const execution =
      report.rows[0].result.observation.metadata.recallExecution;
    assert.equal(execution.mode, "borrowed");
    assert.equal(execution.provision, "plan:local");
    assert.equal(execution.effects, "none");
    printTutorialSummary({
      recipe: "recall",
      exitCode,
      reports: files.length,
      scenario: report.scenario,
      turns: loaded.scenarios[0]!.turns.length,
      contextPath: provision.resources[0]!.destination,
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
