/**
 * @module examples/tutorial/02-sandbox-jsonl
 * 底层组合：Sandbox → JsonlProcess → 结构化记录 → cleanup。
 */
import { access } from "node:fs/promises";
import { JsonlProcess } from "@x-agent-suite/driver";
import { cleanupSandbox, createSandbox } from "@x-agent-suite/sandbox";
import { printTutorialSummary } from "./support.ts";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const sandbox = await createSandbox();
const childScript = [
  "const isolated = process.cwd() === process.env.TUTORIAL_EXPECTED_CWD;",
  "process.stdout.write(JSON.stringify({kind:'ready', isolated}) + '\\n');",
].join("");
const proc = new JsonlProcess({
  command: process.execPath,
  args: ["-e", childScript],
  cwd: sandbox.cwd,
  env: { ...sandbox.env, TUTORIAL_EXPECTED_CWD: sandbox.cwd },
  closeStdinAfterStart: true,
});

let record: unknown;
try {
  await proc.start();
  for await (const line of proc.lines()) {
    record = line;
    break;
  }
} finally {
  await proc.close();
  await cleanupSandbox(sandbox);
}

const cleaned =
  !(await pathExists(sandbox.homeDir)) && !(await pathExists(sandbox.cwd));
const cwdMatches =
  typeof record === "object" &&
  record !== null &&
  (record as { isolated?: unknown }).isolated === true;

printTutorialSummary({ recipe: "sandbox-jsonl", cwdMatches, cleaned, record });
