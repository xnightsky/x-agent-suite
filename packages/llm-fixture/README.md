# @x-agent-suite/llm-fixture

LLM fixture 层：零 token 替代真实 LLM，或直连真实 provider 做 live 对照。

## 用途与边界

- 负责：本地假 provider、真实渠道解析与 live backend、wire 请求/响应归一、target-tags 决策、凭据脱敏。
- 不负责：具体宿主的启动方式（由 harness profile 负责）、判据与评分、场景编排。

## 模块

- `fake-provider.ts` — `FakeProviderBackend`：本地 node:http 假端点，支持 `openai-chat` / `openai-responses` / `anthropic-messages` / `gemini-generate` 四种 wire 形态。
- `live.ts` — `LiveBackend`：直连配置区声明的真实 provider，提取 usage / 估算成本。
- `live-config.ts` — 私密配置区加载与解析（YAML / env 覆盖 / 宿主借用钩子）。
- `live-wires.ts` / `live-parse.ts` — 四种 wire 的请求构造与响应归一。
- `sniff-gate.ts` — live 开跑前的一轮最小真实调用闸。
- `factory.ts` — `createLlmBackend(mode, options)`。

## 公开入口

入口为 [`src/index.ts`](./src/index.ts)：`FakeProviderBackend`、`LiveBackend`、`createLlmBackend`、`sniffLiveChannel`、live 配置/凭据加载（`loadLiveConfig`、`resolveLiveChannel`、`loadLiveAuthConfig` 等）、target-tags 决策（`decideLiveTarget`、`loadTargetTagCatalog` 等）、`buildLiveRequest` / `parseLiveResponse` 与 `redactLiveSecrets` 等脱敏工具。

## 最小示例

fixture 模式只使用本地假端点，零外网、零 token：

```ts
import { createLlmBackend } from "@x-agent-suite/llm-fixture";

const backend = createLlmBackend("fixture", {
  wire: "openai-chat",
  script: [{ text: "ok" }],
});
try {
  await backend.start(); // 本地假端点，返回 baseUrl / apiKey
  // ... 交给 harness driver 消费
} finally {
  await backend.stop();
}
```

`mode: "live"` 会真实调用 provider 并产生 **token 费用**，只能在获得显式授权后使用；默认路径一律 fixture。

## 设计纪律

- wire 协议标识为自由字符串，消费者注册 profile 时自行解释。
- 假端点按请求体中 tool result 的累计轮数取脚本轮次，不依赖全局计数器。
- baseUrl / apiKey 属私密信息；字面量、`apiKeyEnv` 与借用钩子解析出的凭证都必须经 `redactLiveSecrets` 脱敏。
- live parser 兼容 LF/CRLF SSE，并保留非流式响应中的多个工具调用。

## 依赖与边界

- 依赖：[`@x-agent-suite/contracts`](../contracts/README.md)（`LlmBackend` 等类型）、`yaml`（配置解析）。
- 被 [`@x-agent-suite/harness`](../harness/README.md) 与 `@x-agent-suite/recall` 依赖；本包不启动宿主 CLI。

## 分发形态

本包是 workspace 私有实现模块（`private: true`），不单独发布 npm。消费者使用核心聚合子路径 `@xnightsky/x-agent-suite/llm-fixture`；分发白名单与独立 PTY 制品的区别见 [打包与分发](../../docs/spec/packaging.md)。

## 命令（在仓库根执行）

```bash
pnpm --filter @x-agent-suite/llm-fixture test       # 包级单元测试
pnpm --filter @x-agent-suite/llm-fixture typecheck  # 包级类型检查
pnpm test                                           # 全仓单元测试（收口见 pnpm check）
```

## 文档

- [`docs/spec/llm-fixture.md`](../../docs/spec/llm-fixture.md)：fixture 与 live backend 契约。
- [`docs/spec/live-auth-config.md`](../../docs/spec/live-auth-config.md)：live 凭据文件格式与解析。
- [`docs/spec/target-tags.md`](../../docs/spec/target-tags.md)：target-tags 目录与 live 决策。
