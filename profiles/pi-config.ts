/**
 * @module profiles/pi-config
 * 消费者侧 Pi live 配置投影，不属于领域中立的 Harness 实现。
 * 不变量：只读宿主原生配置，只写隔离目录；凭据与端点由已解析 live context 提供。
 */
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  SandboxContext,
  WriteConfigContext,
  LlmLiveChannel,
} from "@x-agent-suite/contracts";

/** Pi 隔离投影选项；运行参数由 Recall createDriver 显式转交。 */
export interface PiLiveConfigOptions {
  /** 宿主 agent 目录；默认 PI_CODING_AGENT_DIR 或 HOME 下的 .pi/agent。 */
  readonly agentDir?: string;
  /** 仅支持 thinkingLevel；不提供时继承宿主默认值。 */
  readonly executionParams?: Readonly<Record<string, unknown>>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pi 原生配置必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

async function readConfig(path: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Pi 原生配置不可读");
  }
  try {
    return record(JSON.parse(raw));
  } catch {
    throw new Error("Pi 原生配置必须是 JSON 对象");
  }
}

function thinkingOverride(
  params: Readonly<Record<string, unknown>> = {},
): string | undefined {
  if (Object.keys(params).some((key) => key !== "thinkingLevel")) {
    throw new Error("Pi executionParams 含不支持的字段");
  }
  const value = params.thinkingLevel;
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
  ) {
    throw new Error("Pi thinkingLevel 不合法");
  }
  return value;
}

function cleanModel(value: unknown): Record<string, unknown> {
  const { headers, apiKey: _key, baseUrl: _url, ...model } = record(value);
  if (headers !== undefined)
    throw new Error("Pi 原生 headers 需要消费者专用认证适配，禁止隐式复制");
  return model;
}

function projectProvider(
  source: Record<string, unknown>,
  baseUrl: string,
  apiKey: string,
): Record<string, unknown> {
  const {
    apiKey: _key,
    headers,
    oauth,
    models,
    modelOverrides,
    ...native
  } = source;
  if (headers !== undefined || oauth !== undefined) {
    throw new Error(
      "Pi 原生 headers/oauth 需要消费者专用认证适配，禁止隐式复制",
    );
  }
  if (models !== undefined && !Array.isArray(models))
    throw new Error("Pi models 必须是数组");
  return {
    ...native,
    baseUrl,
    apiKey,
    ...(models === undefined ? {} : { models: models.map(cleanModel) }),
    ...(modelOverrides === undefined
      ? {}
      : {
          modelOverrides: Object.fromEntries(
            Object.entries(record(modelOverrides)).map(([id, model]) => [
              id,
              cleanModel(model),
            ]),
          ),
        }),
  };
}

async function isolatedDestination(
  destination: string | undefined,
  agentDir: string,
): Promise<string> {
  if (!destination || resolve(destination) === agentDir)
    throw new Error("Pi 配置目标必须是隔离目录");
  let source: string;
  try {
    source = await realpath(agentDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Pi 宿主配置目录不可读");
    source = agentDir;
  }
  await mkdir(destination, { recursive: true });
  if (source === (await realpath(destination)))
    throw new Error("Pi 配置目标必须是隔离目录");
  return destination;
}

function projectSettings(
  settings: Record<string, unknown>,
  context: WriteConfigContext,
  level?: string,
): Record<string, unknown> {
  const live = record(context.live);
  const inherited = Object.fromEntries(
    ["defaultThinkingLevel", "thinkingBudgets"]
      .filter((key) => settings[key] !== undefined)
      .map((key) => [key, settings[key]]),
  );
  return {
    ...inherited,
    ...(level === undefined ? {} : { defaultThinkingLevel: level }),
    defaultProvider: live.provider,
    defaultModel: live.model,
    enableInstallTelemetry: false,
    enableAnalytics: false,
    ...(context.injectServer === false
      ? {}
      : { packages: ["npm:pi-mcp-adapter@2.29.0"] }),
  };
}

/** 为真实 CLI 投影宿主默认思考和原生 provider 配置；不读取或复制 auth.json。 */
export async function writePiLiveConfig(
  sandbox: SandboxContext,
  context: WriteConfigContext,
  options: PiLiveConfigOptions = {},
): Promise<void> {
  const live = context.live as
    (LlmLiveChannel & { readonly provider?: string }) | undefined;
  if (!live?.provider || !live.model)
    throw new Error("Pi live 配置缺 provider/model");
  const level = thinkingOverride(options.executionParams);
  const agentDir = resolve(
    options.agentDir ??
      process.env.PI_CODING_AGENT_DIR ??
      join(homedir(), ".pi", "agent"),
  );
  const destination = await isolatedDestination(
    sandbox.configDirs?.piHome,
    agentDir,
  );
  const settings = await readConfig(join(agentDir, "settings.json"));
  const models = await readConfig(join(agentDir, "models.json"));
  const providers =
    models.providers === undefined ? {} : record(models.providers);
  const source =
    providers[live.provider] === undefined
      ? {}
      : record(providers[live.provider]);
  const provider = projectProvider(
    source,
    live.harnessBaseUrl ?? context.baseUrl,
    context.apiKey,
  );
  await Promise.all([
    writeFile(
      join(destination, "models.json"),
      JSON.stringify({ providers: { [live.provider]: provider } }, null, 2),
      { mode: 0o600 },
    ),
    writeFile(
      join(destination, "settings.json"),
      JSON.stringify(projectSettings(settings, context, level), null, 2),
      { mode: 0o600 },
    ),
  ]);
}
