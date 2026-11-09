/** Recall CLI 真实子进程流式时序：后续 case 阻塞不延迟已完成结果。 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { args, workspace } from "./fixtures/recall-workspace.ts";
import { runOfficialCli } from "./fixtures/official-cli.ts";

async function waitFor(
  condition: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待流式输出超时");
}

test("第一个 case 完成后立即输出，第二个 case 仍在阻塞", async (t) => {
  const ws = await workspace(t);
  const gate = join(ws.cwd, "gate");
  await mkdir(gate);
  await writeFile(
    ws.recallPath,
    `version: 1
id: streaming
cases:
  - id: first
    turns: [{ send: ready }]
  - id: second
    turns: [{ send: block }]
`,
  );
  await writeFile(
    ws.registryPath,
    `import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const gate = ${JSON.stringify(gate)};
async function waitForRelease() {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try { await readFile(join(gate, "release")); return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("release gate timeout");
}
export default {
  criteria: [],
  effectsProfiles: {},
  profiles: {
    "fixture-direct": {
      carrier: "fixture-carrier",
      createDriver: () => ({
        start: async () => {},
        sendPrompt: async (text) => {
          if (text === "block") {
            await writeFile(join(gate, "blocked"), "started");
            await waitForRelease();
          }
          return {
            text,
            toolCalls: [],
            toolCallsCount: 0,
            events: [{ type: "text", timestamp: Date.now(), payload: { text } }],
          };
        },
        events: async function* () {},
        close: async () => {},
      }),
    },
  },
};
`,
  );

  let stdout = "";
  const running = runOfficialCli(args(ws, join(ws.cwd, "reports"), ["-vvv"]), {
    homeDir: ws.cwd,
    onStdout: (chunk) => {
      stdout += chunk;
    },
  });
  let settled = false;
  void running.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  let failure: unknown;
  try {
    await waitFor(async () => {
      if (settled) throw new Error("Recall CLI 在第二个 case 阻塞前已退出");
      try {
        await readFile(join(gate, "blocked"));
        return true;
      } catch {
        return false;
      }
    });
    assert.match(stdout, /PASS streaming\/first/);
    assert.match(stdout, /RUN 2\/2 streaming\/second/);
    assert.match(stdout, /PROMPT streaming\/second .*"block"/);
    assert.doesNotMatch(stdout, /OBSERVATION streaming\/second/);
    assert.doesNotMatch(stdout, /SUMMARY/);
  } catch (error) {
    failure = error;
  }
  await writeFile(join(gate, "release"), "continue");
  const executed = await running;
  if (failure) {
    throw new Error(
      `${String(failure)}\nstdout=${executed.stdout}\nstderr=${executed.stderr}`,
    );
  }
  assert.equal(executed.code, 0, executed.stderr);
  assert.match(executed.stdout, /SUMMARY total=2 passed=2 failed=0 errors=0/);
});
