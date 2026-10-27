# Live Auth Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增可选 `.env.auth.yaml`，支持默认同名 provider 与 `auth.provider` 显式绑定，并按 runtime > auth-file > model-config 解析凭据，同时完整维护配置文档。

**Architecture:** 独立的认证文件模块负责严格 YAML 校验和 explicit/repo/home 发现；`LiveChannel` 只携带非秘密的认证绑定与来源标记。执行前由 `resolveLiveCredential` 统一选择来源，`LiveBackend` 和 sniff 复用该链，模型加载与 TargetTags 不读取认证文件。

**Tech Stack:** TypeScript、Node.js test runner、YAML、pnpm。

**Spec:** `docs/spec/live-auth-config.md`

## Global Constraints

- 新行为先写失败测试；全部使用临时目录、合成 ID/secret，零网络、零 token。
- `packages/*/src/` 不出现具体被测系统、provider、环境变量或协议名；只使用通用 carrier/provider/model 概念。
- 不读取或修改真实 home 配置，不自动执行命令、刷新 OAuth 或探测 ambient。
- 文件读取、YAML/schema 错误显式失败；只有来源不存在才回退，来源存在但缺值不得切换身份。
- 所有导出符号写中文 JSDoc；单文件超过 500 行必须按职责拆分。
- 配置文档与代码同批完成；未经当前会话另行明确授权，不执行 commit、push 或其他远程写入。

## Review Focus

- 损坏 YAML 的原始错误可能带 secret 行：Task 1 测试诊断不得回显原文值。
- env 覆盖后重新校验可能丢失 runtime 来源：Task 2 测试 runtime 标记在 `resolveLiveChannel` 后仍保留。
- 显式 `auth.provider` 缺文件/条目可能误回退内联凭据：Task 3 测试必须抛配置错误。
- 代码显式 channel 可能误读 repo/home auth：Task 3/4 测试无 provenance 时保持 bypass。
- auth 字面量可能进入 backend/sniff 异常：Task 4 测试嵌套错误与响应诊断均脱敏。

---

### Task 1: 严格认证文件解析与发现

**Files:**
- Create: `packages/llm-fixture/src/live-auth-config.ts`
- Create: `packages/llm-fixture/tests/live-auth-config.test.ts`
- Modify: `packages/llm-fixture/src/index.ts`

**Interfaces:**
- Produces:
  - `LIVE_AUTH_CONFIG_PATH_ENV = "E2E_AUTH_CONFIG_PATH"`
  - `LIVE_AUTH_CONFIG_FILE = ".env.auth.yaml"`
  - `LiveAuthConfigError extends Error`
  - `LiveAuthEntry { type: "api_key"; apiKey?: string; apiKeyEnv?: string }`
  - `LiveAuthConfig { version: 1; providers: Readonly<Record<string, LiveAuthEntry>> }`
  - `parseLiveAuthConfig(text: string): LiveAuthConfig`
  - `loadLiveAuthConfig(options?: { env?: NodeJS.ProcessEnv; repoRoot?: string; homeDir?: string }): Promise<LiveAuthConfigLoad>`
  - `LiveAuthConfigLoad = { kind: "loaded"; source: "explicit-path" | "repo-local" | "home-dot"; path: string; config: LiveAuthConfig } | { kind: "not-configured" }`

- [ ] **Step 1: 写失败的 schema 与发现测试**
  - 接受 `apiKeyEnv` 和 `apiKey` 两种完整条目。
  - 拒绝错误 version、未知字段/type、空 provider/key 名、apiKey 与 apiKeyEnv 同时出现或同时缺失、重复 YAML key。
  - 验证 explicit > repo > home、命中即停、默认均缺失返回 not-configured。
  - 验证显式路径缺失、默认路径不可读、YAML/schema 错误抛 `LiveAuthConfigError`；错误不包含合成 secret 或 YAML 原文行。
- [ ] **Step 2: 运行 `pnpm exec tsx --test packages/llm-fixture/tests/live-auth-config.test.ts`，确认因模块/导出不存在而失败。**
- [ ] **Step 3: 实现 `live-auth-config.ts` 与导出。**
  - 默认路径 ENOENT 才继续；显式路径任何读取失败均抛错。
  - YAML 解析失败只保留路径与通用原因，不透传可能含 secret 的原文。
  - schema 错误只报告字段路径和约束，不回显字段值。
- [ ] **Step 4: 重跑 Task 1 测试并确认通过。**

### Task 2: 模型认证绑定与来源标记

**Files:**
- Modify: `packages/llm-fixture/src/live-types.ts`
- Modify: `packages/llm-fixture/src/live-channel.ts`
- Modify: `packages/llm-fixture/src/live-config.ts`
- Create: `packages/llm-fixture/tests/live-auth-channel.test.ts`
- Existing regression: `packages/llm-fixture/tests/live-config.test.ts`、`live-config-targets.test.ts`（不继续扩张已超 500 行文件）

**Interfaces:**
- Consumes: Task 1 不需要文件读取；本任务只建立声明。
- Produces:
  - `LiveChannel.auth?: { readonly provider: string }`
  - `LiveChannel.credentialSource?: "model-config" | "runtime"`（非秘密 provenance；未设置表示代码显式/legacy channel）
  - `validateChannel` 输出 `credentialSource: "model-config"`；`resolveLiveChannel` 在 API_KEY/API_KEY_ENV 覆盖时改为 `"runtime"`。

- [ ] **Step 1: 写失败的模型配置测试。**
  - 接受 `auth: { provider: "shared-auth" }` 并在 target 展开后保留。
  - 拒绝空绑定、未知 auth 字段，以及 auth.provider 与 apiKey/apiKeyEnv/credential 并存。
  - `from: harness` + auth.provider 不自动注入 credential:harness；无 auth 时原隐含借用不变。
  - 普通文件渠道标记 model-config；凭据 env 覆盖后标记 runtime，非凭据 env 覆盖不改变 model-config。
- [ ] **Step 2: 运行新测试文件，确认新断言失败。**
- [ ] **Step 3: 实现声明校验、隐含借用条件和 provenance 保留。**
  - `resolveLiveChannel` 在 validate 后按 `hasCredentialOverride` 设置 runtime，避免被校验重置。
  - 借用端点覆盖判断把 auth.provider 视为外部凭据意图，与现有显式 apiKey 路径一致。
- [ ] **Step 4: 重跑新测试及既有 live-config/live-config-targets 回归并确认通过。**

### Task 3: 统一凭据来源选择与显式绑定

**Files:**
- Modify: `packages/llm-fixture/src/live-types.ts`
- Modify: `packages/llm-fixture/src/live-credential.ts`
- Modify: `packages/llm-fixture/src/live-config.ts`
- Create: `packages/llm-fixture/tests/live-auth-credential.test.ts`

**Interfaces:**
- Consumes: Task 1 `loadLiveAuthConfig`；Task 2 `channel.auth` 与 `channel.credentialSource`。
- Produces:
  - `LiveCredentialOptions.repoRoot?: string`；继续使用已有 env/homeDir/hooks。
  - missing 结果增加可选 `required?: boolean`，供执行层区分“无凭据可继续”与“已选来源必须解析”。
  - resolved.source 使用非秘密标签：`runtime ...`、`auth file ...`、`env ...`、`config apiKey 字面量`。

- [ ] **Step 1: 写失败的来源优先级和绑定测试。**
  - runtime 直接解析，不读取 auth 文件；缺值返回 `required: true`。
  - model-config 默认按 channel.provider 查 auth；auth 命中优先于内联，条目不存在才回退内联。
  - auth.provider 可让两个 channel 复用同一认证条目；大小写不匹配不得命中。
  - 显式绑定缺文件/条目抛 `LiveAuthConfigError`；条目 env 缺值返回 required missing，均不回退内联。
  - 无 credentialSource 的代码显式 channel 不读取 auth 文件，保持原有 inline/harness 行为。
  - auth 文件损坏不得回退；无 provider ID 时只做内联解析。
- [ ] **Step 2: 运行 `pnpm exec tsx --test packages/llm-fixture/tests/live-auth-credential.test.ts`，确认失败。**
- [ ] **Step 3: 在 `resolveLiveCredential` 实现统一来源选择。**
  - runtime：仅解析合并后的运行时 key。
  - model-config：加载 auth，按显式引用或默认同名选择；未命中才走既有 inline/harness。
  - undefined provenance：直接走既有 inline/harness，完全 bypass auth。
  - auth 条目的字面量与环境值复用现有 resolved 结果结构，missing 标记 required。
- [ ] **Step 4: 重跑 Task 3 与既有 live-config 测试并确认通过。**

### Task 4: Backend、sniff 与脱敏集成

**Files:**
- Modify: `packages/llm-fixture/src/live.ts`
- Modify: `packages/llm-fixture/src/sniff-gate.ts`
- Create: `packages/llm-fixture/tests/live-auth-backend.test.ts`
- Create: `packages/llm-fixture/tests/live-auth-sniff.test.ts`

**Interfaces:**
- Consumes: Task 3 统一 resolver 和 required missing。
- Produces: `SniffOptions.repoRoot?: string` 与 `SniffOptions.homeDir?: string`，供隔离发现；`LiveBackend.start` 传递 config 的 repoRoot/homeDir/env。

- [ ] **Step 1: 写失败的执行链测试。**
  - 从临时 `.env.e2e.yaml` + `.env.auth.yaml` 启动 backend，请求使用 auth-file key。
  - runtime 覆盖优先于 auth；代码显式 channel bypass。
  - auth/runtime required missing 在 backend 返回显式未配置错误，sniff 返回 `{ ok:false, stage:"auth" }`，而不是发无 key 请求。
  - sniff 将 auth 文件/schema 错误收敛为脱敏的 auth 失败，不抛裸错。
  - auth 字面量与环境解析值在嵌套 cause、transport 异常和响应载荷中脱敏。
- [ ] **Step 2: 运行两个测试文件，确认新断言失败。**
- [ ] **Step 3: 实现选项透传、required missing 处理与 sniff 解析异常门禁。**
  - backend/sniff 仅在 legacy 未声明凭据时允许空 key；已选 runtime/auth 来源失败不得继续请求。
  - 不改变既有 harness missing 处理与 401/403 不换身份规则。
- [ ] **Step 4: 重跑新测试及既有 live-backend、sniff-gate、redact、live-signal 回归并确认通过。**

### Task 5: 配置文档与全量验收

**Files:**
- Modify: `docs/spec/llm-fixture.md`
- Modify: `docs/spec/suite-design.md`
- Modify: `docs/spec/target-tags.md`
- Modify: `docs/spec/live-auth-config.md`（实施后状态与最终接口）
- Modify: `docs/spec/README.md`
- Modify: `docs/tutorial/modules.md`
- Modify: `docs/tutorial/recipes/live-guard.md`
- Modify: `docs/tutorial/recipes/live-token-smoke.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Existing research: `docs/research/pi-models-auth-resolution.md`

**Interfaces:**
- Consumes: Tasks 1–4 的最终公开符号和行为。
- Produces: 用户可复制的完整 `.env.e2e.yaml` / `.env.auth.yaml` 配置文档，包含默认同名、auth.provider、优先级、失败矩阵和安全边界。

- [ ] **Step 1: 更新配置参考与教程。**
  - 主配置文档必须包含完整 YAML，不得只写字段名或链接到研究文档。
  - 明确 auth 文件可选、模型加载独立、TargetTags 不读取 auth、v1 不支持 OAuth/命令/ambient。
  - token 教程继续保持显式授权和零默认 token；普通示例只用合成值。
- [ ] **Step 2: 运行 `git diff --check`，并搜索文档确认 `E2E_AUTH_CONFIG_PATH`、`auth.provider`、完整 schema、优先级和失败语义均已覆盖。**
- [ ] **Step 3: 运行 `pnpm boundary`、`pnpm typecheck`、`pnpm test`、`pnpm ittest`，分别确认通过。**
- [ ] **Step 4: 最终运行 `pnpm check`，检查工作区只包含本需求文件，汇报已验证项、未验证项、剩余风险和注释收口范围；不执行 commit。**
