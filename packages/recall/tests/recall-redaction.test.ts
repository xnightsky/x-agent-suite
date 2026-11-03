/** Recall driver.redactor 接入报告与错误出口的零 token 集成回归。 */
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.ts";
import { runRecall } from "../src/run.ts";
import { args, readReports, workspace } from "./fixtures/recall-workspace.ts";

const SECRET = "fixture-key";

const OBSERVATION_REGISTRY = `
const secret = "fixture-key";
const criterion = {
  name: "secret-seen",
  scope: "turn",
  evaluate(turn) {
    const call = turn.toolCalls[0];
    const pass =
      turn.text.includes(secret) &&
      call?.input?.leak === secret &&
      turn.metadata?.leak === secret;
    return { pass, score: pass ? 1 : 0, reason: pass ? "raw observation" : "missing raw observation" };
  },
};
export default {
  criteria: [criterion],
  profiles: {
    "fixture-direct": {
      carrier: "fixture-carrier",
      createDriver: () => ({
        redactor: (text) => text.replaceAll(secret, "[REDACTED]"),
        start: async () => {},
        sendPrompt: async () => ({
          text: "leak " + secret,
          toolCalls: [{
            name: "read",
            input: { leak: secret },
            output: { content: [{ type: "text", text: secret }] },
            status: "completed",
          }],
          toolCallsCount: 1,
          events: [{ type: "text", timestamp: 1, payload: { text: secret } }],
          metadata: { leak: secret },
        }),
        events: async function* () {},
        close: async () => {},
      }),
    },
  },
  effectsProfiles: {},
};
`;

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

test("Recall 报告应用 driver.redactor，但判据评估仍看到原始 Observation", async (t) => {
  const ws = await workspace(t);
  await writeFile(
    ws.recallPath,
    `version: 1
id: redaction
cases:
  - id: c
    turns:
      - send: hi
        expect:
          secret-seen: true
`,
  );
  await writeFile(ws.registryPath, OBSERVATION_REGISTRY);
  const outDir = join(ws.cwd, "reports-redaction");
  assert.equal(
    await main(args(ws, outDir), { cwd: ws.cwd, homeDir: ws.cwd }),
    0,
  );
  const reports = await readReports(outDir);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.rows[0].result.artifact.assertions[0].pass, true);
  let combined = "";
  for (const file of await listFiles(outDir)) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, new RegExp(SECRET), file);
    combined += "\n" + text;
  }
  assert.match(combined, /\[REDACTED\]/);
});

test("Recall failure error 同样使用 driver.redactor", async (t) => {
  const ws = await workspace(t);
  await writeFile(ws.registryPath, OBSERVATION_REGISTRY);
  await writeFile(
    ws.recallPath,
    `version: 1
id: failure-redaction
cases: [{ id: c, turns: [{ send: hi }] }]
`,
  );
  await writeFile(
    ws.registryPath,
    `
const secret = "fixture-key";
export default {
  criteria: [],
  effectsProfiles: {},
  profiles: {
    "fixture-direct": {
      carrier: "fixture-carrier",
      createDriver: () => ({
        redactor: (text) => text.replaceAll(secret, "[REDACTED]"),
        start: async () => {},
        sendPrompt: async () => { throw new Error("boom " + secret); },
        events: async function* () {},
        close: async () => {},
      }),
    },
  },
};
`,
  );
  const result = await runRecall({
    cwd: ws.cwd,
    homeDir: ws.cwd,
    target: ws.recallPath,
    selection: { carrier: "fixture-carrier" },
    liveConfigPath: ws.livePath,
    registryPath: ws.registryPath,
    outDir: join(ws.cwd, "reports-redaction-error"),
  });
  assert.equal(result.runs.length, 0);
  assert.equal(result.failures.length, 1);
  assert.doesNotMatch(result.failures[0]!.error.message, new RegExp(SECRET));
  assert.match(result.failures[0]!.error.message, /\[REDACTED\]/);

  const errors: string[] = [];
  t.mock.method(console, "error", (message: string) => errors.push(message));
  assert.equal(
    await main(args(ws, join(ws.cwd, "reports-redaction-cli")), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    1,
  );
  assert.doesNotMatch(errors.join("\n"), new RegExp(SECRET));
  assert.match(errors.join("\n"), /\[REDACTED\]/);
});

test("repeat 的多个 driver.redactor 组合后作用于代表结果", async (t) => {
  const ws = await workspace(t);
  await writeFile(
    ws.recallPath,
    `version: 1
id: repeat-redaction
cases: [{ id: c, turns: [{ send: hi }] }]
`,
  );
  await writeFile(
    ws.registryPath,
    `
globalThis.__redactionDriverCount = 0;
export default {
  criteria: [],
  effectsProfiles: {},
  profiles: {
    "fixture-direct": {
      carrier: "fixture-carrier",
      createDriver: () => {
        const count = ++globalThis.__redactionDriverCount;
        const secret = count === 1 ? "alpha-secret" : "beta-secret";
        return {
          redactor: (text) => text.replaceAll(secret, "[REDACTED]"),
          start: async () => {},
          sendPrompt: async () => ({
            text: count === 2 ? "alpha-secret beta-secret" : "alpha-secret",
            toolCalls: [],
            toolCallsCount: 0,
            events: [{ type: "text", timestamp: 1 }],
          }),
          events: async function* () {},
          close: async () => {},
        };
      },
    },
  },
};
`,
  );
  const outDir = join(ws.cwd, "reports-repeat-redaction");
  assert.equal(
    await main(args(ws, outDir, ["--repeat", "2"]), {
      cwd: ws.cwd,
      homeDir: ws.cwd,
    }),
    0,
  );
  const reports = await readReports(outDir);
  assert.equal(reports.length, 1);
  let combined = "";
  for (const file of await listFiles(outDir)) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /alpha-secret|beta-secret/, file);
    combined += "\n" + text;
  }
  assert.match(combined, /\[REDACTED\]/);
});
