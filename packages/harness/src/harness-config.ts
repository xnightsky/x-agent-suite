/**
 * @module @x-agent-suite/harness/harness-config
 * 宿主 CLI 渠道借用：baseUrl / wire / model 直接取宿主 CLI 自己的配置文件。
 * 与本模块同级的 harness-credentials.ts（凭证借用）配套。
 * 结构依据 2026-08-23 本机对若干主流宿主 CLI 的探测：
 * - 宿主 A：~/.x-agent-a/config.toml，default_model → provider/model → base_url/type
 * - 宿主 B：~/.x-agent-b/config.toml，顶层 model + 可选 model_providers base_url
 * - 宿主 C：~/.x-agent-c/settings.json，model + env.ANTHROPIC_BASE_URL
 * - 宿主 D：固定 Google 端点，model 取 settings.json（可缺省）
 * - 宿主 E：~/.x-agent-e/agent/settings.json defaultProvider/defaultModel + models.json providers
 *   （models.json 无对应条目时回退内置 provider 注册表快照，见 PI_BUILTIN_PROVIDERS；
 *   options.provider 可指定借用目标 provider，缺省用 defaultProvider；
 *   hint 与 defaultProvider 不一致时不带 defaultModel，由调用方显式声明 model）
 * 不变量：
 * - 只读不写；TOML 只做目标字段的有限提取（无 TOML 依赖），提不到 → 显式 missing + 原因，绝不静默猜值；
 * - baseUrl 属私密信息，调用方输出前必须经 redactLiveSecrets 脱敏；
 * - 本模块不发起任何网络请求。
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WireProtocol } from "@x-agent-suite/contracts";

/** 借用到的渠道信息（model 可缺省——部分宿主无渠道概念，由 yaml 显式补齐）。 */
export interface HarnessChannelInfo {
  /** wire 协议类型。 */
  readonly wire: WireProtocol;
  /** API base URL（私密，输出必须脱敏）。 */
  readonly baseUrl: string;
  /** 模型标识（可缺省）。 */
  readonly model?: string;
  /** 宿主侧 provider 键名（多 provider 宿主的凭证借用按它索引）。 */
  readonly provider?: string;
  /** 宿主 CLI 自己期望的 baseUrl 原值形态（仅与归一 baseUrl 不同的宿主设置，如某宿主不带 /v1）。 */
  readonly harnessBaseUrl?: string;
  /** 来源描述（文件路径级，便于诊断）。 */
  readonly source: string;
}

/** 借用结果。 */
export type HarnessChannelResult =
  | { readonly kind: "resolved"; readonly channel: HarnessChannelInfo }
  | { readonly kind: "missing"; readonly reason: string };

/** 提取选项（测试注入用；缺省取真实环境）。 */
export interface HarnessChannelOptions {
  /** 用户 home 目录；缺省 os.homedir()。 */
  readonly homeDir?: string;
  /** 借用目标 provider 提示（仅多 provider 宿主生效；缺省用宿主默认 provider）。 */
  readonly provider?: string;
}

/** 读文本文件；失败返回 undefined。 */
async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** 读 JSON 文件；失败返回 undefined。 */
async function readJson(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  const raw = await readText(path);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** TOML-lite：取顶层（首个 section 之前）的字符串键值。 */
function tomlTopLevelString(text: string, key: string): string | undefined {
  const top = text.split(/^\s*\[/m)[0] ?? "";
  const match = top.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match?.[1];
}

/** TOML-lite：取指定 section 头（精确匹配，如 `providers."managed:<provider>"`）内的字符串键值。 */
function tomlSectionString(
  text: string,
  sectionHeader: string,
  key: string,
): string | undefined {
  const lines = text.split("\n");
  const header = `[${sectionHeader}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return undefined;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*\[/.test(line)) break;
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`));
    if (match) return match[1];
  }
  return undefined;
}

/** 宿主 provider type / api 字段 → wire 映射；未知返回 undefined（不瞎猜）。 */
function wireOf(hint: string | undefined): WireProtocol | undefined {
  switch (hint) {
    case "kimi": // BOUNDARY-DEBT(harness): 宿主 A 的 provider type 取值
    case "openai":
    case "openai-completions":
      return "openai-chat";
    case "openai-responses":
    case "responses":
      return "openai-responses";
    case "anthropic":
    case "anthropic-messages":
      return "anthropic-messages";
    case "google-generative-ai":
    case "gemini": // BOUNDARY-DEBT(harness): 宿主 D 的 provider type 取值
      return "gemini-generate"; // BOUNDARY-DEBT(harness): 历史协议标识
    default:
      return undefined;
  }
}

/** 宿主 A：config.toml 的 default_model → models 段 → providers 段。 */
async function kimiChannel(home: string): Promise<HarnessChannelResult> {
  // BOUNDARY-DEBT(harness): 宿主 A 专用
  const path = join(home, ".kimi-code", "config.toml"); // BOUNDARY-DEBT(harness): 宿主 A 配置路径
  const text = await readText(path);
  if (text === undefined) {
    return { kind: "missing", reason: `宿主 A 未找到可读的 ${path}` };
  }
  const defaultModel = tomlTopLevelString(text, "default_model");
  if (!defaultModel) {
    return { kind: "missing", reason: `宿主 A ${path} 缺顶层 default_model` };
  }
  let provider = tomlSectionString(
    text,
    `models."${defaultModel}"`,
    "provider",
  );
  let model = tomlSectionString(text, `models."${defaultModel}"`, "model");
  if (!provider) {
    const prefix = defaultModel.split("/")[0] ?? "";
    provider = prefix;
    model = model ?? defaultModel.slice(prefix.length + 1);
  }
  const section =
    tomlSectionString(text, `providers."${provider}"`, "base_url") !== undefined
      ? `providers."${provider}"`
      : `providers."managed:${provider}"`;
  const baseUrl = tomlSectionString(text, section, "base_url");
  if (!baseUrl) {
    return {
      kind: "missing",
      reason: `宿主 A ${path} 中 default_model "${defaultModel}" 的 provider 段缺 base_url`,
    };
  }
  const wire =
    wireOf(tomlSectionString(text, section, "type")) ?? "openai-chat";
  return {
    kind: "resolved",
    channel: {
      wire,
      baseUrl,
      ...(model ? { model } : {}),
      source: `harness:a ${path}`,
    },
  };
}

/** 宿主 B：config.toml 的 model + 可选 model_providers；无自定义走 OpenAI 默认端点。 */
async function codexChannel(home: string): Promise<HarnessChannelResult> {
  // BOUNDARY-DEBT(harness): 宿主 B 专用
  const path = join(home, ".codex", "config.toml"); // BOUNDARY-DEBT(harness): 宿主 B 配置路径
  const text = await readText(path);
  if (text === undefined) {
    return { kind: "missing", reason: `宿主 B 未找到可读的 ${path}` };
  }
  const model = tomlTopLevelString(text, "model");
  if (!model) {
    return { kind: "missing", reason: `宿主 B ${path} 缺顶层 model` };
  }
  const providerName = tomlTopLevelString(text, "model_provider");
  const baseUrl = providerName
    ? (tomlSectionString(text, `model_providers.${providerName}`, "base_url") ??
      tomlSectionString(text, `model_providers."${providerName}"`, "base_url"))
    : undefined;
  if (providerName && !baseUrl) {
    return {
      kind: "missing",
      reason: `宿主 B ${path} 的 model_providers."${providerName}" 缺 base_url`,
    };
  }
  return {
    kind: "resolved",
    channel: {
      wire: "openai-responses",
      baseUrl: baseUrl ?? "https://api.openai.com/v1",
      model,
      source: `harness:b ${path}`,
    },
  };
}

/** 归一 baseUrl 的版本前缀：wire builder 只拼端点尾段（如 /messages），借来的 baseUrl 缺 /v1 时补上。 */
function ensureVersionPrefix(baseUrl: string, prefix: string): string {
  const stripped = baseUrl.replace(/\/+$/, "");
  return stripped.endsWith(prefix) ? stripped : `${stripped}${prefix}`;
}

/** 宿主 C：settings.json 的 model + env.ANTHROPIC_BASE_URL（归一补 /v1）。 */
async function claudeChannel(home: string): Promise<HarnessChannelResult> {
  // BOUNDARY-DEBT(harness): 宿主 C 专用
  const path = join(home, ".claude", "settings.json"); // BOUNDARY-DEBT(harness): 宿主 C 配置路径
  const json = await readJson(path);
  if (!json) {
    return { kind: "missing", reason: `宿主 C 未找到可读的 ${path}` };
  }
  const env = json.env as Record<string, unknown> | undefined;
  const baseUrl =
    typeof env?.ANTHROPIC_BASE_URL === "string" && env.ANTHROPIC_BASE_URL !== ""
      ? env.ANTHROPIC_BASE_URL
      : "https://api.anthropic.com";
  const model =
    typeof json.model === "string" && json.model !== ""
      ? json.model
      : undefined;
  return {
    kind: "resolved",
    channel: {
      wire: "anthropic-messages",
      baseUrl: ensureVersionPrefix(baseUrl, "/v1"),
      harnessBaseUrl: baseUrl.replace(/\/+$/, ""),
      ...(model ? { model } : {}),
      source: `harness:c ${path}`,
    },
  };
}

/** 宿主 D：无渠道概念——固定 Google 端点；model 取 settings.json（字符串或 model.name），可缺省。 */
async function geminiChannel(home: string): Promise<HarnessChannelResult> {
  // BOUNDARY-DEBT(harness): 宿主 D 专用
  const path = join(home, ".gemini", "settings.json"); // BOUNDARY-DEBT(harness): 宿主 D 配置路径
  const json = await readJson(path);
  const rawModel = json?.model;
  const model =
    typeof rawModel === "string" && rawModel !== ""
      ? rawModel
      : typeof (rawModel as Record<string, unknown> | undefined)?.name ===
          "string"
        ? ((rawModel as Record<string, unknown>).name as string)
        : undefined;
  return {
    kind: "resolved",
    channel: {
      wire: "gemini-generate", // BOUNDARY-DEBT(harness): 历史协议标识
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      ...(model ? { model } : {}),
      source: json
        ? `harness:d ${path}`
        : "harness:d 内置端点（无 settings.json）",
    },
  };
}

// BOUNDARY-DEBT(harness): 宿主 E 内置 provider 注册表快照（pi-ai 0.84.4 providers/data）；
// 仅收录 baseUrl 具体（非模板/非空）且 api 可映射框架 wire 的条目；models.json 条目恒优先；
// 宿主 E 若改为把内置 provider 落盘 models.json，本表即可整体回收。
const PI_BUILTIN_PROVIDERS: Record<string, { baseUrl: string; api: string }> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
  },
  "ant-ling": {
    baseUrl: "https://api.ant-ling.com/v1",
    api: "openai-completions",
  },
  baseten: {
    baseUrl: "https://inference.baseten.co/v1",
    api: "openai-completions",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    api: "openai-completions",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
  },
  fireworks: {
    baseUrl: "https://api.fireworks.ai/inference",
    api: "anthropic-messages",
  },
  "github-copilot": {
    baseUrl: "https://api.individual.githubcopilot.com",
    api: "anthropic-messages",
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    api: "openai-completions",
  },
  huggingface: {
    baseUrl: "https://router.huggingface.co/v1",
    api: "openai-completions",
  },
  // BOUNDARY-DEBT(harness): 宿主 E 内置 provider 条目（键名与 URL 命中禁词，逐行标记）
  "kimi-coding": {
    baseUrl: "https://api.kimi.com/coding", // BOUNDARY-DEBT(harness): 宿主 E 内置 provider 条目
    api: "anthropic-messages",
  },
  minimax: {
    baseUrl: "https://api.minimax.io/anthropic",
    api: "anthropic-messages",
  },
  "minimax-cn": {
    baseUrl: "https://api.minimaxi.com/anthropic",
    api: "anthropic-messages",
  },
  moonshotai: {
    baseUrl: "https://api.moonshot.ai/v1",
    api: "openai-completions",
  },
  "moonshotai-cn": {
    baseUrl: "https://api.moonshot.cn/v1",
    api: "openai-completions",
  },
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    api: "openai-completions",
  },
  openai: { baseUrl: "https://api.openai.com/v1", api: "openai-responses" },
  opencode: {
    baseUrl: "https://opencode.ai/zen",
    api: "anthropic-messages",
  },
  "opencode-go": {
    baseUrl: "https://opencode.ai/zen/go",
    api: "anthropic-messages",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
  },
  "qwen-token-plan": {
    baseUrl:
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    api: "openai-completions",
  },
  "qwen-token-plan-cn": {
    baseUrl:
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    api: "openai-completions",
  },
  "qwen-token-plan-individual": {
    baseUrl:
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    api: "openai-completions",
  },
  together: {
    baseUrl: "https://api.together.ai/v1",
    api: "openai-completions",
  },
  "vercel-ai-gateway": {
    baseUrl: "https://ai-gateway.vercel.sh",
    api: "anthropic-messages",
  },
  xai: { baseUrl: "https://api.x.ai/v1", api: "openai-responses" },
  xiaomi: {
    baseUrl: "https://api.xiaomimimo.com/v1",
    api: "openai-completions",
  },
  "xiaomi-token-plan-ams": {
    baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
    api: "openai-completions",
  },
  "xiaomi-token-plan-cn": {
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    api: "openai-completions",
  },
  "xiaomi-token-plan-sgp": {
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    api: "openai-completions",
  },
  zai: {
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    api: "openai-completions",
  },
  "zai-coding-cn": {
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    api: "openai-completions",
  },
};

/** 宿主 E：settings.json defaultProvider/defaultModel + models.json providers.<p>（缺条目回退内置表）；providerHint 指定借用目标 provider，缺省用 defaultProvider。 */
async function piChannel(
  home: string,
  providerHint?: string,
): Promise<HarnessChannelResult> {
  // BOUNDARY-DEBT(harness): 宿主 E 专用
  const settingsPath = join(home, ".pi", "agent", "settings.json"); // BOUNDARY-DEBT(harness): 宿主 E 配置路径
  const modelsPath = join(home, ".pi", "agent", "models.json"); // BOUNDARY-DEBT(harness): 宿主 E 配置路径
  const settings = await readJson(settingsPath);
  const defaultProvider =
    typeof settings?.defaultProvider === "string"
      ? settings.defaultProvider
      : undefined;
  const provider = providerHint ?? defaultProvider;
  if (!provider) {
    return {
      kind: "missing",
      reason: `宿主 E ${settingsPath} 缺 defaultProvider`,
    };
  }
  // hint 与 defaultProvider 不一致时，defaultModel 不保证属于该 provider，
  // 不静默猜值——不带 model，由 yaml 显式声明。
  const model =
    (providerHint === undefined || providerHint === defaultProvider) &&
    typeof settings?.defaultModel === "string"
      ? settings.defaultModel
      : undefined;
  const models = await readJson(modelsPath);
  const providers = models?.providers as Record<string, unknown> | undefined;
  let entry = providers?.[provider] as Record<string, unknown> | undefined;
  let fromBuiltin = false;
  if (entry && (typeof entry.baseUrl !== "string" || entry.baseUrl === "")) {
    // 用户自定义条目写坏了要显式报，不能被内置表掩盖（流量可能去了非预期端点）
    return {
      kind: "missing",
      reason: `宿主 E ${modelsPath} 的自定义 provider "${provider}" 缺 baseUrl`,
    };
  }
  if (!entry) {
    const builtin = PI_BUILTIN_PROVIDERS[provider];
    if (!builtin) {
      return {
        kind: "missing",
        reason: `宿主 E ${modelsPath} 无 provider "${provider}"，内置 provider 表亦无此条目`,
      };
    }
    entry = builtin;
    fromBuiltin = true;
  }
  const wire = wireOf(typeof entry.api === "string" ? entry.api : undefined);
  if (!wire) {
    return {
      kind: "missing",
      reason: `宿主 E provider "${provider}" 的 api "${String(entry.api)}" 无 wire 映射`,
    };
  }
  // anthropic-messages：宿主 E 的 baseUrl 约定不带 /v1（宿主运行时自己拼 /v1/messages），
  // 本框架约定 baseUrl 含版本前缀——归一补 /v1，原值留在 harnessBaseUrl（同宿主 C 模式）。
  const rawBaseUrl = (entry.baseUrl as string).replace(/\/+$/, "");
  const needsVersionPrefix =
    wire === "anthropic-messages" && !rawBaseUrl.endsWith("/v1");
  return {
    kind: "resolved",
    channel: {
      wire,
      baseUrl: needsVersionPrefix
        ? ensureVersionPrefix(rawBaseUrl, "/v1")
        : rawBaseUrl,
      provider,
      ...(needsVersionPrefix ? { harnessBaseUrl: rawBaseUrl } : {}),
      ...(model ? { model } : {}),
      source: fromBuiltin
        ? `harness:e ${settingsPath} + 内置 provider 表`
        : `harness:e ${settingsPath} + ${modelsPath}`,
    },
  };
}

/**
 * 按 carrier 借用宿主 CLI 的渠道配置（baseUrl/wire/model）；未探测过的 carrier 显式 missing。
 * 本函数不抛异常、不发起网络请求。
 */
export async function resolveHarnessChannel(
  carrier: string,
  options: HarnessChannelOptions = {},
): Promise<HarnessChannelResult> {
  const home = options.homeDir ?? homedir();
  switch (carrier) {
    case "kimi": // BOUNDARY-DEBT(harness): 宿主 A 映射
      return kimiChannel(home);
    case "codex": // BOUNDARY-DEBT(harness): 宿主 B 映射
      return codexChannel(home);
    case "claude": // BOUNDARY-DEBT(harness): 宿主 C 映射
      return claudeChannel(home);
    case "gemini": // BOUNDARY-DEBT(harness): 宿主 D 映射
      return geminiChannel(home);
    case "pi": // BOUNDARY-DEBT(harness): 宿主 E 映射
      return piChannel(home, options.provider);
    default:
      return {
        kind: "missing",
        reason: `carrier "${carrier}" 的宿主配置未探测/不支持借用`,
      };
  }
}
