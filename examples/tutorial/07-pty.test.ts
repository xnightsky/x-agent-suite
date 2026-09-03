/**
 * @module examples/tutorial/07-pty
 * 合成 TUI + PtyAgentDriver：验证 ready、回显、提交、idle 与清理机制。
 * 不变量：通用 Node 测试 TUI 不是真实宿主，因此属于零 token 单元测试。
 */
import type { HarnessProfile, LlmBackend } from "@x-agent-suite/contracts";
import { createPtyAgentDriver } from "@x-agent-suite/harness";
import { printTutorialSummary, tutorialPathExists } from "./support.ts";

const TUI_SOURCE = String.raw`
process.stdin.setEncoding("utf8");
process.stdin.setRawMode?.(true);
process.stdin.resume();
let input = "";
process.stdout.write("TUTORIAL_READY\r\n> ");
process.stdin.on("data", (chunk) => {
  for (const character of chunk) {
    if (character === "\u0003") process.exit(0);
    if (character === "\r" || character === "\n") {
      const submitted = input;
      input = "";
      process.stdout.write("\r\nRECEIVED:" + submitted + "\r\n> ");
    } else {
      input += character;
      process.stdout.write(character);
    }
  }
});
`;

const profile: HarnessProfile = {
  name: "tutorial-pty",
  command: process.execPath,
  ptyCommand: process.execPath,
  headlessArgs: () => [],
  ptyArgs: () => ["-e", TUI_SOURCE],
  ptyReadyPattern: /TUTORIAL_READY/,
  ptyPromptPattern: /^>$/,
  wire: "openai-chat",
  baseUrlEnv: "",
  stripEnv: [],
  toolName: (_server, tool) => tool,
  writeConfig: async () => {},
  createParser: () => () => null,
  supportsFixture: true,
};
const backend: LlmBackend = {
  mode: "fixture",
  start: async () => ({ baseUrl: "http://127.0.0.1:1", apiKey: "fake" }),
  stop: async () => {},
};
const driver = createPtyAgentDriver({
  profile,
  backend,
  injectServer: false,
  commandOverride: { command: process.execPath, argsPrefix: [] },
  readyTimeoutMs: 5_000,
  echoTimeoutMs: 2_000,
  screenIdleMs: 150,
  ioIdleMs: 80,
  promptTimeoutMs: 5_000,
});

let homeDir = "";
let cwd = "";
let ready = false;
let observation;
try {
  await driver.start();
  ({ homeDir, cwd } = driver.sandbox);
  ready = driver.screenTail().includes("TUTORIAL_READY");
  observation = await driver.inject("pty hello");
} finally {
  await driver.close("pty tutorial complete");
}
if (!observation) throw new Error("PTY 教程未产生 Observation");

printTutorialSummary({
  recipe: "pty",
  ready,
  promptSeen: observation.text.includes("RECEIVED:pty hello"),
  injectMode: driver.injectMode,
  cleaned:
    !(await tutorialPathExists(homeDir)) && !(await tutorialPathExists(cwd)),
});
