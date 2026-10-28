/**
 * @module @x-agent-suite/recall/tests/recall
 * 新 Recall CLI/Runner：显式 target、独立 registry、effects Plan 与报告归因。
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import { main } from "../src/cli.ts";
import {
  workspace,
  args,
  state,
  resetState,
  readReports,
} from "./fixtures/recall-workspace.ts";

const REGISTRY_FIXTURE_URL = new URL(
  "./fixtures/recall.registry.ts",
  import.meta.url,
).href;

test("无 target 参数与旧 --config 均在 Driver 前返回定义错误", async (t) => {
  const ws = await workspace(t);
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports"), [], false), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    2,
  );
  assert.equal(
    await main(
      args(ws, join(ws.cwd, "reports"), [
        "--config",
        join(ws.cwd, ".recall", "x-agent-suite.config.ts"),
      ]),
      { cwd: ws.cwd, homeDir: ws.cwd },
    ),
    2,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles.length, 0);
});

test("direct 默认无 effects，复用单 Runner 并保留多轮与执行归因", async (t) => {
  const ws = await workspace(t);
  const outDir = join(ws.cwd, "reports");
  assert.equal(
    await main(args(ws, outDir, ["--repeat", "2"]), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    0,
  );
  assert.equal(state().transports.length, 2);
  assert.equal(state().profiles.length, 0);
  const reports = await readReports(outDir);
  assert.equal(reports.length, 1);
  const metadata = reports[0].rows[0].result.observation.metadata;
  assert.deepEqual(metadata.recallExecution, {
    target: {
      carrier: "fixture-carrier",
      provider: "fixture-provider",
      model: "fixture-model-0",
    },
    mode: "direct",
    kind: "ephemeral-client",
    clientRef: "fixture-direct",
    provision: "none",
    effects: "none",
  });
});

test("carrier 展开多个 default 并逐 target 出报告，provider 过滤不追加其他 default", async (t) => {
  const ws = await workspace(t, { targetCount: 2 });
  const allDir = join(ws.cwd, "reports-all");
  assert.equal(
    await main(args(ws, allDir), { cwd: ws.cwd, homeDir: ws.cwd }),
    0,
  );
  assert.equal(state().transports.length, 2);
  const allReports = await readReports(allDir);
  assert.equal(allReports.length, 2);
  assert.deepEqual(
    new Set(
      allReports.map(
        (report) =>
          report.rows[0].result.observation.metadata.recallExecution.target
            .model,
      ),
    ),
    new Set(["fixture-model-0", "fixture-model-1"]),
  );

  resetState();
  const filteredDir = join(ws.cwd, "reports-filtered");
  assert.equal(
    await main(args(ws, filteredDir, ["--provider", "other-provider"]), {
      cwd: ws.cwd,
    }),
    0,
  );
  assert.equal(state().transports.length, 1);
  assert.equal(state().transports[0]!.model, "fixture-model-1");
  assert.equal((await readReports(filteredDir)).length, 1);
});

test("场景 provision 无 Plan 拒绝，显式 effects:none 才经唯一 borrowed profile", async (t) => {
  const ws = await workspace(t, { provision: true });
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-denied")), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    2,
  );
  assert.equal(state().profiles.length, 0);
  assert.equal(state().transports.length, 0);

  const planPath = join(ws.cwd, "execution.yaml");
  await writeFile(planPath, "version: 1\neffects: none\n");
  const outDir = join(ws.cwd, "reports-borrowed");
  assert.equal(
    await main(args(ws, outDir, ["--plan", planPath]), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    0,
  );
  assert.equal(state().profiles.length, 1);
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles[0]!.effects, "none");
  const [report] = await readReports(outDir);
  const execution = report.rows[0].result.observation.metadata.recallExecution;
  assert.equal(execution.mode, "borrowed");
  assert.equal(execution.cliRef, "fixture-cli-0");
  assert.equal(execution.provision, "plan:shared");
  assert.equal(execution.effects, "none");
});

test("非 none inline effects 显式选择 borrowed，EffectsProfile 不归并不猜 mode", async (t) => {
  const ws = await workspace(t, { cliCarrier: true });
  const planPath = join(ws.cwd, "execution.yaml");
  await writeFile(
    planPath,
    `version: 1
effects:
  tools: read-only
  commands:
    allow: [read-file]
    deny: [read-file]
`,
  );
  const outDir = join(ws.cwd, "reports");
  assert.equal(
    await main(args(ws, outDir, ["--plan", planPath]), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    0,
  );
  assert.equal(state().profiles.length, 1);
  assert.equal(state().profiles[0]!.effects, "inline");
  assert.equal(state().transports.length, 0);
  const [report] = await readReports(outDir);
  assert.equal(
    report.rows[0].result.observation.metadata.recallExecution.effects,
    "inline",
  );
});

test("live review-required 未审批拒绝，--approve-live 仅放行当前调用", async (t) => {
  const ws = await workspace(t, { livePolicy: "review-required" });
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-denied")), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    2,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-approved"), ["--approve-live"]), {
      cwd: ws.cwd,
    }),
    0,
  );
  assert.equal(state().transports.length, 1);
});

test("borrowed 多 profile 未唯一时在 Driver 前拒绝且不 fallback", async (t) => {
  const ws = await workspace(t, { provision: true });
  const planPath = join(ws.cwd, "execution.yaml");
  await writeFile(planPath, "version: 1\neffects: none\n");
  const live = parse(await readFile(ws.livePath, "utf8"));
  live.targetTags.cli.push({
    ...live.targetTags.cli[0],
    id: "fixture-cli-1",
  });
  await writeFile(ws.livePath, stringify(live));
  await writeFile(
    ws.registryPath,
    `import base from ${JSON.stringify(REGISTRY_FIXTURE_URL)};
export default {
  ...base,
  profiles: {
    ...base.profiles,
    "fixture-cli-1": base.profiles["fixture-cli-0"],
  },
};
`,
  );
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports"), ["--plan", planPath]), {
      cwd: ws.cwd,
    }),
    2,
  );
  assert.equal(state().profiles.length, 0);
  assert.equal(state().transports.length, 0);
});

test("ephemeral-client 经 clientRef 使用自定义 direct Adapter 并保留渠道归因", async (t) => {
  const ws = await workspace(t, { ephemeralClient: true });
  const outDir = join(ws.cwd, "reports-ephemeral");
  assert.equal(
    await main(args(ws, outDir, ["--carrier", "fixture-ephemeral"], false), {
      cwd: ws.cwd,
    }),
    0,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles.length, 1);
  assert.equal(state().profiles[0]?.clientRef, "fixture-client-0");
  assert.equal(state().profiles[0]?.backendCarrier, "fixture-carrier");
  assert.equal(state().profiles[0]?.cliRef, undefined);

  const [report] = await readReports(outDir);
  const execution = report.rows[0].result.observation.metadata.recallExecution;
  assert.deepEqual(execution, {
    target: {
      carrier: "fixture-ephemeral",
      provider: "fixture-provider",
      model: "fixture-model-0",
    },
    kind: "ephemeral-client",
    mode: "direct",
    clientRef: "fixture-client-0",
    channelCarrier: "fixture-carrier",
    provision: "none",
    effects: "none",
  });
});

test("ephemeral-client 缺注册 Adapter 时在 Driver 前拒绝且不回退 direct", async (t) => {
  const ws = await workspace(t, { ephemeralClient: true });
  await writeFile(
    ws.registryPath,
    `import base from ${JSON.stringify(REGISTRY_FIXTURE_URL)};
export default {
  ...base,
  profiles: {
    "fixture-cli-0": base.profiles["fixture-cli-0"],
  },
};
`,
  );
  assert.equal(
    await main(
      args(
        ws,
        join(ws.cwd, "reports-denied"),
        ["--carrier", "fixture-ephemeral"],
        false,
      ),
      { cwd: ws.cwd, homeDir: ws.cwd },
    ),
    2,
  );
  assert.equal(state().profiles.length, 0);
  assert.equal(state().transports.length, 0);
});

test("ephemeral-client Adapter 接收场景 provision 与显式 effects Plan", async (t) => {
  const ws = await workspace(t, { ephemeralClient: true, provision: true });
  const planPath = join(ws.cwd, "execution.yaml");
  await writeFile(planPath, "version: 1\neffects: none\n");
  const outDir = join(ws.cwd, "reports-ephemeral-provision");
  assert.equal(
    await main(
      args(
        ws,
        outDir,
        ["--carrier", "fixture-ephemeral", "--plan", planPath],
        false,
      ),
      { cwd: ws.cwd, homeDir: ws.cwd },
    ),
    0,
  );
  assert.equal(state().transports.length, 0);
  assert.equal(state().profiles.length, 1);
  assert.notEqual(state().profiles[0]?.provision, undefined);
  const [report] = await readReports(outDir);
  const execution = report.rows[0].result.observation.metadata.recallExecution;
  assert.equal(execution.mode, "direct");
  assert.equal(execution.clientRef, "fixture-client-0");
  assert.equal(execution.provision, "plan:shared");
  assert.equal(execution.effects, "none");
});
