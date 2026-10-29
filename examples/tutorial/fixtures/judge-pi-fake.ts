/**
 * @module examples/tutorial/judge-pi-fake
 * 离线合成 Pi JSONL CLI 与输入：只写测试现场，不读取真实宿主、凭据或 provider。
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  LiveConfigOptions,
  ResolvedLiveTarget,
  TargetTagCatalog,
} from "@x-agent-suite/llm-fixture";

/** 合成 CLI 的脱敏生命周期与隔离现场记录。 */
export interface SyntheticPiProbe {
  readonly event: "start" | "exit";
  readonly judge: boolean;
  readonly cwd?: string;
  readonly home?: string | null;
  readonly files?: readonly string[];
  readonly flags?: {
    readonly noTools: boolean;
    readonly noSession: boolean;
    readonly noContextFiles: boolean;
    readonly noExtensions: boolean;
    readonly noSkills: boolean;
  };
  readonly secretPresent?: boolean;
  readonly originalExam?: boolean;
  readonly secretInPrompt?: boolean;
}

/** 合成单轮 borrowed target；渠道和凭据只由合成 hooks 提供。 */
export function syntheticTarget(): ResolvedLiveTarget {
  return {
    carrier: "pi",
    channel: {
      wire: "openai-chat",
      baseUrl: "https://offline.invalid/v1",
      provider: "native",
      model: "native-model",
      from: "harness",
      credential: "harness",
    },
  };
}

/** 构造满足 Judge 与 Pi borrowed 的合成 TargetTags。 */
export function syntheticTags(
  dictionary: TargetTagCatalog["dictionary"],
): TargetTagCatalog {
  return {
    dictionary,
    instances: {
      cli: [
        {
          id: "pi",
          carrier: "pi",
          wires: ["openai-chat"],
          tags: [
            "cli.execution.one-shot",
            "cli.execution.unattended",
            "cli.session.ephemeral",
            "cli.context.context-files.off",
            "cli.context.extensions.off",
            "cli.context.skills.off",
            "cli.tools.none",
            "cli.io.text",
          ],
        },
      ],
      providers: [
        {
          id: "native",
          tags: [
            "provider.usage.third-party-subscription",
            "provider.usage.live.review-required",
          ],
        },
      ],
      providerModels: [
        {
          id: "native/native-model",
          providerRef: "native",
          model: "native-model",
          modelRef: "native-model",
          wire: "openai-chat",
          tags: ["provider-model.api.complete"],
        },
      ],
      models: [{ id: "native-model", tags: ["model.inference.chat"] }],
    },
  };
}

/** 创建只指向临时目录与合成 hooks 的配置。 */
export function createSyntheticConfig(homeDir: string): LiveConfigOptions {
  const target = syntheticTarget();
  return {
    env: {},
    homeDir,
    repoRoot: homeDir,
    borrowChannel: async () => ({
      kind: "resolved",
      wire: target.channel.wire,
      baseUrl: target.channel.baseUrl,
      provider: target.channel.provider,
      model: target.channel.model,
      source: "synthetic",
    }),
    borrowCredential: async () => ({
      kind: "resolved",
      apiKey: "synthetic-key",
      source: "synthetic",
    }),
  };
}

/** 写入合成 JSONL CLI，返回公开工厂可消费的 commandOverride 与 probe 路径。 */
export async function writeSyntheticPi(root: string): Promise<{
  readonly commandOverride: { command: string; argsPrefix: string[] };
  readonly probeLog: string;
}> {
  const probeLog = join(root, "probe.jsonl");
  const script = join(root, "synthetic-pi.mjs");
  const source = [
    'import { appendFileSync, readdirSync } from "node:fs";',
    "const probeLog = " + JSON.stringify(probeLog) + ";",
    "const argv = process.argv.slice(2);",
    "const prompt = argv[argv.length - 1] ?? '';",
    "const judge = prompt.includes('policy: judge-v1');",
    "const record = (value) => appendFileSync(probeLog, JSON.stringify(value) + '\\n');",
    "const flags = {",
    "  noTools: argv.includes('--no-tools'),",
    "  noSession: argv.includes('--no-session'),",
    "  noContextFiles: argv.includes('--no-context-files'),",
    "  noExtensions: argv.includes('--no-extensions'),",
    "  noSkills: argv.includes('--no-skills'),",
    "};",
    "record({",
    "  event: 'start', judge, cwd: process.cwd(), home: process.env.HOME ?? null,",
    "  files: readdirSync(process.cwd()).sort(), flags,",
    "  secretPresent: process.env.XAS_FAKE_SECRET !== undefined,",
    "  originalExam: prompt.includes('plans:') || prompt.includes('createJudgeAssertion') || prompt.includes('MAIN_ONLY.txt'),",
    "  secretInPrompt: prompt.includes('USER_SECRET_CANARY'),",
    "});",
    "process.on('exit', () => record({ event: 'exit', judge }));",
    "const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n');",
    "let text;",
    "if (judge) {",
    "  if (prompt.includes('__ABSENT__')) text = '{}';",
    "  else text = JSON.stringify({ grounded: { pass: true, reason: 'synthetic' } });",
    "} else {",
    "  text = prompt.includes('__SUCCESS__') ? '标题：合成\\n正文：证据' : prompt;",
    "}",
    "const failed = judge && prompt.includes('__PROVIDER_ERROR__');",
    "const message = { role: 'assistant', stopReason: failed ? 'error' : 'end', content: [{ type: 'text', text }] };",
    "if (failed) message.errorMessage = 'synthetic provider failure';",
    "emit({ type: 'message_end', message });",
    "if (!(judge && prompt.includes('__INCOMPLETE__'))) emit({ type: 'agent_end' });",
    "",
  ].join("\n");
  await writeFile(script, source, "utf8");
  return {
    commandOverride: { command: process.execPath, argsPrefix: [script] },
    probeLog,
  };
}

/** 读取合成 CLI 的脱敏 probe；不读取任何真实宿主文件。 */
export async function readSyntheticPiProbes(
  path: string,
): Promise<readonly SyntheticPiProbe[]> {
  const source = await readFile(path, "utf8");
  return source
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SyntheticPiProbe);
}
