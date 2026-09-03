# @x-agent-suite/llm-fixture

LLM fixture 层：零 token 替代真实 LLM，或直连真实 provider 做 live 对照。

## 模块

- `fake-provider.ts` — `FakeProviderBackend`：本地 node:http 假端点，支持 `openai-chat` / `openai-responses` / `anthropic-messages` / `gemini-generate` 四种 wire 形态。
- `live.ts` — `LiveBackend`：直连配置区声明的真实 provider，提取 usage / 估算成本。
- `live-config.ts` — 私密配置区加载与解析（YAML / env 覆盖 / 宿主借用钩子）。
- `live-wires.ts` / `live-parse.ts` — 四种 wire 的请求构造与响应归一。
- `sniff-gate.ts` — live 开跑前的一轮最小真实调用闸。
- `factory.ts` — `createLlmBackend(mode, options)`。

## 设计纪律

- wire 协议标识为自由字符串，消费者注册 profile 时自行解释。
- 假端点按请求体中 tool result 的累计轮数取脚本轮次，不依赖全局计数器。
- baseUrl / apiKey 属私密信息；字面量、`apiKeyEnv` 与借用钩子解析出的凭证都必须经 `redactLiveSecrets` 脱敏。
- live parser 兼容 LF/CRLF SSE，并保留非流式响应中的多个工具调用。
