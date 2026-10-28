/**
 * @module harness/provider-snapshot
 * 遗留宿主内置渠道快照；仅维护现有兼容数据，不扩展自动识别范围。
 * 不变量：所有领域穿透继续保留边界债务标记，原生配置可替代时回收。
 */
// BOUNDARY-DEBT(harness): 宿主 E 内置 provider 注册表快照（源自 pi-ai 0.84.4，已更新条目单独注明）；
// 仅收录 baseUrl 具体（非模板/非空）且 api 可映射框架 wire 的条目；models.json 条目恒优先；
// 宿主 E 若改为把内置 provider 落盘 models.json，本表即可整体回收。
/** 原生配置缺条目时使用的兼容快照；显式原生配置始终优先。 */
export const BUILTIN_PROVIDER_SNAPSHOT: Record<
  string,
  { baseUrl: string; api: string }
> = {
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
    baseUrl: "https://api.kimi.com/coding/v1", // BOUNDARY-DEBT(harness): 已按原生 1.4.0 核对；原生配置落盘后回收
    api: "openai-completions",
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
