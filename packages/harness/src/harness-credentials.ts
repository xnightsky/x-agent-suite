/**
 * @module @x-agent-suite/harness/harness-credentials
 * 借用宿主 CLI 自己的登录态（live 配置 credential: harness）。
 * 每个 extractor 对应一种 CLI 的原生凭证存储，结构依据 2026-08-23 本机探测：
 * - 宿主 B ~/.codex/auth.json：OPENAI_API_KEY 优先，否则 tokens.access_token（JWT，取 exp） // BOUNDARY-DEBT(harness): 历史探测记录
 * - 宿主 C ~/.claude/settings.json env.ANTHROPIC_AUTH_TOKEN 优先，.credentials.json OAuth 兜底 // BOUNDARY-DEBT(harness): 历史探测记录
 * - 宿主 D ~/.gemini/oauth_creds.json：access_token + expiry_date // BOUNDARY-DEBT(harness): 历史探测记录
 * - 宿主 A ~/.kimi-code/credentials/kimi-code.json：access_token + expires_at // BOUNDARY-DEBT(harness): 历史探测记录
 * - 宿主 E ~/.pi/agent/auth.json：按 provider 取 type=api_key 的 key，或 OAuth access（查 expires） // BOUNDARY-DEBT(harness): 历史探测记录
 * 不变量：
 * - 只读不写；文件缺失 / 字段缺失 / token 过期 → 显式 missing + 可读原因，绝不抛异常；
 * - 返回值携带 apiKey 字面量，调用方任何日志必须经 redactLiveSecrets 脱敏；
 * - 借来的 OAuth token 可能与声明的 baseUrl 不兼容，兼容性由 sniff 门禁仲裁，本模块不判断。
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 借用结果：拿到凭证或显式 missing。 */
export type HarnessCredential =
  | {
      readonly kind: "resolved";
      /** 凭证字面量（私密，输出必须脱敏）。 */
      readonly apiKey: string;
      /** 来源描述（文件路径级，便于诊断，不含凭证值）。 */
      readonly source: string;
      /** 过期时间（epoch ms；仅 OAuth/JWT 类可得知）。 */
      readonly expiresAt?: number;
    }
  | { readonly kind: "missing"; readonly reason: string };

/** 提取选项（测试注入用；缺省取真实环境）。 */
export interface HarnessCredentialOptions {
  /** 用户 home 目录；缺省 os.homedir()。 */
  readonly homeDir?: string;
  /** 当前时刻（epoch ms）；缺省 Date.now()。 */
  readonly now?: number;
  /** 宿主 E 专用：auth.json 里的 provider 键名。 */
  readonly provider?: string;
}

/** 读取 JSON 文件；任何失败返回 undefined。 */
async function readJson(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 从 JWT payload 提取 exp（秒），不校验签名；失败返回 undefined。 */
function jwtExpSeconds(token: string): number | undefined {
  const segment = token.split(".")[1];
  if (!segment) return undefined;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8"),
    );
    const exp = (payload as Record<string, unknown>).exp;
    return typeof exp === "number" ? exp : undefined;
  } catch {
    return undefined;
  }
}

/** 宿主 B：~/.codex/auth.json。 // BOUNDARY-DEBT(harness): 历史探测记录 */
async function fromCodex(
  home: string,
  now: number,
): Promise<HarnessCredential> {
  // BOUNDARY-DEBT(harness): 宿主 B 专用
  const path = join(home, ".codex", "auth.json"); // BOUNDARY-DEBT(harness): 宿主 B 凭证路径
  const json = await readJson(path);
  if (!json) {
    return {
      kind: "missing",
      reason: `宿主 B 未找到可读的 ${path}（未登录或路径不同）`,
    };
  }
  if (typeof json.OPENAI_API_KEY === "string" && json.OPENAI_API_KEY !== "") {
    return {
      kind: "resolved",
      apiKey: json.OPENAI_API_KEY,
      source: `harness:b ${path} OPENAI_API_KEY`,
    };
  }
  const tokens = json.tokens as Record<string, unknown> | undefined;
  const access = tokens?.access_token;
  if (typeof access !== "string" || access === "") {
    return {
      kind: "missing",
      reason: `宿主 B ${path} 无 OPENAI_API_KEY 且 tokens.access_token 缺失`,
    };
  }
  const exp = jwtExpSeconds(access);
  if (exp !== undefined && exp * 1000 <= now) {
    return {
      kind: "missing",
      reason: `宿主 B access_token 已过期（${new Date(exp * 1000).toISOString()}），需重新登录刷新`,
    };
  }
  return {
    kind: "resolved",
    apiKey: access,
    source: `harness:b ${path} tokens.access_token（注意端点兼容性由 sniff 仲裁）`,
    ...(exp !== undefined ? { expiresAt: exp * 1000 } : {}),
  };
}

/** 宿主 C：settings.json env 优先，.credentials.json OAuth 兜底。 */
async function fromClaude(
  home: string,
  now: number,
): Promise<HarnessCredential> {
  // BOUNDARY-DEBT(harness): 宿主 C 专用
  const settingsPath = join(home, ".claude", "settings.json"); // BOUNDARY-DEBT(harness): 宿主 C 凭证路径
  const settings = await readJson(settingsPath);
  const env = settings?.env as Record<string, unknown> | undefined;
  const token = env?.ANTHROPIC_AUTH_TOKEN;
  if (typeof token === "string" && token !== "") {
    return {
      kind: "resolved",
      apiKey: token,
      source: `harness:c ${settingsPath} env.ANTHROPIC_AUTH_TOKEN`,
    };
  }
  const credPath = join(home, ".claude", ".credentials.json"); // BOUNDARY-DEBT(harness): 宿主 C OAuth 路径
  const cred = await readJson(credPath);
  const oauth = cred?.claudeAiOauth as Record<string, unknown> | undefined;
  const accessToken = oauth?.accessToken;
  if (typeof accessToken === "string" && accessToken !== "") {
    const expiresAt =
      typeof oauth?.expiresAt === "number" ? oauth.expiresAt : undefined;
    if (expiresAt !== undefined && expiresAt <= now) {
      return {
        kind: "missing",
        reason: `宿主 C OAuth accessToken 已过期（${new Date(expiresAt).toISOString()}）`,
      };
    }
    return {
      kind: "resolved",
      apiKey: accessToken,
      source: `harness:c ${credPath} claudeAiOauth.accessToken`,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
  }
  return {
    kind: "missing",
    reason: `宿主 C 无 settings env.ANTHROPIC_AUTH_TOKEN，且 ${credPath} 无可用 OAuth`,
  };
}

/** 宿主 D：~/.gemini/oauth_creds.json。 // BOUNDARY-DEBT(harness): 历史探测记录 */
async function fromGemini(
  home: string,
  now: number,
): Promise<HarnessCredential> {
  // BOUNDARY-DEBT(harness): 宿主 D 专用
  const path = join(home, ".gemini", "oauth_creds.json"); // BOUNDARY-DEBT(harness): 宿主 D 凭证路径
  const json = await readJson(path);
  if (!json) {
    return {
      kind: "missing",
      reason: `宿主 D 未找到 ${path}（未做 web 登录）`,
    };
  }
  const access = json.access_token;
  if (typeof access !== "string" || access === "") {
    return { kind: "missing", reason: `宿主 D ${path} 缺 access_token` };
  }
  const expiry =
    typeof json.expiry_date === "number" ? json.expiry_date : undefined;
  if (expiry !== undefined && expiry <= now) {
    return {
      kind: "missing",
      reason: `宿主 D access_token 已过期（${new Date(expiry).toISOString()}）`,
    };
  }
  return {
    kind: "resolved",
    apiKey: access,
    source: `harness:d ${path} access_token`,
    ...(expiry !== undefined ? { expiresAt: expiry } : {}),
  };
}

/** 宿主 A：~/.kimi-code/credentials/kimi-code.json（web 登录 OAuth，短有效期，CLI 自动刷新）。 // BOUNDARY-DEBT(harness): 历史探测记录 */
async function fromKimi(home: string, now: number): Promise<HarnessCredential> {
  // BOUNDARY-DEBT(harness): 宿主 A 专用
  const path = join(home, ".kimi-code", "credentials", "kimi-code.json"); // BOUNDARY-DEBT(harness): 宿主 A 凭证路径
  const json = await readJson(path);
  if (!json) {
    return {
      kind: "missing",
      reason: `宿主 A 未找到 ${path}（未做 web 登录）`,
    };
  }
  const access = json.access_token;
  if (typeof access !== "string" || access === "") {
    return { kind: "missing", reason: `宿主 A ${path} 缺 access_token` };
  }
  const rawExpiry =
    typeof json.expires_at === "number" ? json.expires_at : undefined;
  const expiresAt =
    rawExpiry !== undefined
      ? rawExpiry < 1e12
        ? rawExpiry * 1000
        : rawExpiry
      : undefined;
  if (expiresAt !== undefined && expiresAt <= now) {
    return {
      kind: "missing",
      reason: `宿主 A access_token 已过期（${new Date(expiresAt).toISOString()}），需先跑一次宿主 A CLI 刷新`,
    };
  }
  return {
    kind: "resolved",
    apiKey: access,
    source: `harness:a ${path} access_token`,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

/** 宿主 E：~/.pi/agent/auth.json 按 provider 取。 // BOUNDARY-DEBT(harness): 历史探测记录 */
async function fromPi(
  home: string,
  now: number,
  provider: string | undefined,
): Promise<HarnessCredential> {
  // BOUNDARY-DEBT(harness): 宿主 E 专用
  const path = join(home, ".pi", "agent", "auth.json"); // BOUNDARY-DEBT(harness): 宿主 E 凭证路径
  if (!provider) {
    return {
      kind: "missing",
      reason: `宿主 E 借用需在 live 配置里声明 provider（${path} 按 provider 键索引）`,
    };
  }
  const json = await readJson(path);
  if (!json) {
    return { kind: "missing", reason: `宿主 E 未找到可读的 ${path}` };
  }
  const entry = json[provider] as Record<string, unknown> | undefined;
  if (!entry) {
    return {
      kind: "missing",
      reason: `宿主 E ${path} 无 provider "${provider}" 的凭证`,
    };
  }
  if (
    entry.type === "api_key" &&
    typeof entry.key === "string" &&
    entry.key !== ""
  ) {
    return {
      kind: "resolved",
      apiKey: entry.key,
      source: `harness:e ${path} ${provider}.key`,
    };
  }
  if (typeof entry.access === "string" && entry.access !== "") {
    const expires =
      typeof entry.expires === "number" ? entry.expires : undefined;
    if (expires !== undefined && expires <= now) {
      return {
        kind: "missing",
        reason: `宿主 E ${provider} OAuth 已过期（${new Date(expires).toISOString()}）`,
      };
    }
    return {
      kind: "resolved",
      apiKey: entry.access,
      source: `harness:e ${path} ${provider}.access`,
      ...(expires !== undefined ? { expiresAt: expires } : {}),
    };
  }
  return {
    kind: "missing",
    reason: `宿主 E ${path} 中 ${provider} 条目无 key/access 字段`,
  };
}

/**
 * 按 carrier 借用宿主 CLI 的登录态；未探测过的 carrier 显式 missing。
 * 本函数不抛异常；返回值中的 apiKey 属私密信息。
 */
export async function resolveHarnessCredential(
  carrier: string,
  options: HarnessCredentialOptions = {},
): Promise<HarnessCredential> {
  const home = options.homeDir ?? homedir();
  const now = options.now ?? Date.now();
  switch (carrier) {
    case "codex": // BOUNDARY-DEBT(harness): 宿主 B 映射
      return fromCodex(home, now);
    case "claude": // BOUNDARY-DEBT(harness): 宿主 C 映射
      return fromClaude(home, now);
    case "gemini": // BOUNDARY-DEBT(harness): 宿主 D 映射
      return fromGemini(home, now);
    case "kimi": // BOUNDARY-DEBT(harness): 宿主 A 映射
      return fromKimi(home, now);
    case "pi": // BOUNDARY-DEBT(harness): 宿主 E 映射
      return fromPi(home, now, options.provider);
    default:
      return {
        kind: "missing",
        reason: `carrier "${carrier}" 的宿主凭证存储未探测/不支持借用`,
      };
  }
}
