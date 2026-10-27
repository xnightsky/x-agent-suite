# 可选 live 认证配置

> 状态：已实现。
>
> 本规格新增可选的 `.env.auth.yaml`，将模型/端点声明与实际凭据存储分离。关联与优先级借鉴 Pi，但不引入其 OAuth 处理器、命令执行或 ambient 自动探测。

## 1. 目的与不变量

- `.env.e2e.yaml` 继续声明 carrier、provider、model、baseUrl、wire 和 default。
- `.env.auth.yaml` 只声明 provider 凭据；文件缺失是正常状态。
- 模型配置加载与目标选择不依赖认证文件；实际解析凭据时才读取认证文件。
- 两文件默认通过区分大小写的精确 provider ID 关联；渠道可用 `auth.provider` 显式绑定另一个认证条目。不得按 carrier、model、baseUrl 或 wire 猜测。
- 来源不存在才进入下一级；来源存在但解析失败必须显式失败，不切换身份。
- 认证文件不进入 TargetTagCatalog，不自动生成或推断 `provider.auth.*` / `provider-model.auth.*`。
- 省略认证不绕过既有 TargetTags 和 live 安全门禁。

## 2. 配置文件

### 2.1 完整格式

```yaml
# .env.auth.yaml
version: 1

providers:
  provider-a:
    type: api_key
    apiKeyEnv: PROVIDER_A_API_KEY

  provider-b:
    type: api_key
    apiKey: "replace-with-your-secret"
```

`provider-a` 使用环境变量引用，是推荐形式；`provider-b` 的字面量仅用于兼容现有能力，文档不得鼓励提交或共享真实 secret。

内部逻辑类型：

```ts
interface LiveAuthConfig {
  readonly version: 1;
  readonly providers: Readonly<Record<string, LiveAuthEntry>>;
}

interface LiveAuthEntry {
  readonly type: "api_key";
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
}
```

每个条目必须满足：

1. `type` 必须为 `api_key`。
2. `apiKey` 与 `apiKeyEnv` 必须恰好出现一个。
3. 出现的字段必须是非空字符串；环境变量名只作为名称处理，不在加载 schema 时读取值。
4. 顶层与条目级未知字段、未知 `type`、重复 YAML key、非对象 providers 均属于配置错误。
5. 不允许 `baseUrl`、`wire`、`models`、`carriers`、`targetTags` 等第二份模型/能力配置。

v1 不支持 `type: oauth`、`!command`、secret manager 命令或通用 ambient 声明。未来 OAuth 必须由消费者插件提供处理器并另行扩展契约，不能只增加 JSON/YAML 字段。

### 2.2 与模型配置联动

```yaml
# .env.e2e.yaml
carriers:
  example-carrier:
    default:
      - provider: provider-a
        model: model-a
    providers:
      provider-a:
        baseUrl: https://provider.example.com/v1
        wire: openai-chat
        models: [model-a]
```

```yaml
# .env.auth.yaml
version: 1
providers:
  provider-a:
    type: api_key
    apiKeyEnv: PROVIDER_A_API_KEY
```

选中 `example-carrier/provider-a/model-a` 后，凭据解析器以 `channel.provider === "provider-a"` 查找 `providers["provider-a"]`，再从 `process.env.PROVIDER_A_API_KEY` 读取实际值。不得回写任一 YAML 文件。

同一 provider ID 被多个 carrier 使用时共享该条目。同服务需要多账号并行时，消费者必须声明不同 provider/profile ID；核心不引入账号枚举或具体 provider 知识。

### 2.3 可选 `auth.provider` 显式绑定

默认关联适合简单场景；需要让多个模型 provider/profile 复用同一认证条目时，在渠道 provider 上显式声明：

```yaml
# .env.e2e.yaml
carriers:
  example-carrier:
    default:
      - provider: provider-a-account-1
        model: model-a
    providers:
      provider-a-account-1:
        auth:
          provider: shared-provider-auth
        baseUrl: https://provider.example.com/v1
        wire: openai-chat
        models: [model-a]

      provider-a-account-2:
        auth:
          provider: shared-provider-auth
        baseUrl: https://provider.example.com/v1
        wire: openai-chat
        models: [model-a]
```

```yaml
# .env.auth.yaml
version: 1
providers:
  shared-provider-auth:
    type: api_key
    apiKeyEnv: SHARED_PROVIDER_API_KEY
```

内部模型配置增加通用声明 `auth?: { provider: string }`，其中 provider 必须是非空字符串；它只选择认证文件条目，不是 TargetTags 的 auth 标签，也不选择具体宿主或 OAuth handler。

- 未写 `auth.provider`：默认查询 `channel.provider`；该条目不存在时可继续回退内联凭据。
- 写了 `auth.provider`：只查询指定条目；进入认证文件层级后，文件或条目缺失均为配置错误，不回退内联凭据。
- `auth.provider` 不得与内联 `apiKey/apiKeyEnv/credential` 同时声明，避免一个渠道同时指定两套认证意图；该冲突在模型配置校验阶段显式报错。
- 运行时 env 覆盖仍优先；只有进入认证文件层级时才应用显式绑定。
- 显式绑定只复用认证条目，不复制或合并两个 provider 的模型、端点和 TargetTags。

## 3. 文件发现

新增环境变量 `E2E_AUTH_CONFIG_PATH`。发现顺序为高优先级在前：

1. `E2E_AUTH_CONFIG_PATH` 指向的显式文件；
2. 仓库根 `.env.auth.yaml`；
3. `~/.env.auth.yaml`。

规则：

- 命中第一个存在的文件即停止，不合并多个认证文件。
- 新文件没有历史路径，不增加 `~/.config/x-agent-suite/.env.auth.yaml`。
- 显式路径不存在或不可读是错误，不得降级到其他认证文件。
- 默认路径均不存在表示未配置独立认证，不是错误。
- 已选文件损坏或 schema 非法是错误，不得使用其他认证文件或保留陈旧秘密快照。
- `.env*` 现有 gitignore 规则覆盖新文件；文档仍推荐使用环境变量引用而非字面量。

## 4. 凭据来源与优先级

高优先级在前：

1. 当前调用的 `E2E_LIVE_<CARRIER>_API_KEY` / `E2E_LIVE_<CARRIER>_API_KEY_ENV` 环境覆盖；
2. 已选 `.env.auth.yaml` 中按默认同名 provider 或显式 `auth.provider` 选定的条目；
3. `.env.e2e.yaml` 渠道内联 `apiKey` / `apiKeyEnv` / `credential: harness`；
4. 无凭据。

`from: harness` 的既有隐含 `credential: harness` 仍属于第 3 级。代码显式 `new LiveBackend({ channel })` 继续旁路文件与环境发现，不得被认证文件或运行时环境覆盖。

实现必须保留“凭据字段来自运行时覆盖还是模型配置”的非秘密来源信息，不能仅根据合并后的 `LiveChannel` 猜优先级。诊断可以记录 `runtime` / `auth-file` / `model-config` / `harness` 等来源标签，但不得记录 secret。

### 4.1 缺失与失败矩阵

| 情况 | 结果 |
| --- | --- |
| 无运行时覆盖 | 查认证文件 |
| 默认认证文件均不存在 | 查内联凭据 |
| 默认关联且认证文件有效但无当前 provider 条目 | 查内联凭据 |
| 显式 `auth.provider` 已声明，但认证文件不存在或没有指定条目 | 返回配置错误，不回退内联凭据 |
| `auth.provider` 与任一内联凭据字段同时声明 | 模型配置校验报错，不进入凭据解析 |
| 当前 provider 无有效 ID | 不查询认证文件，继续使用内联凭据；内联凭据也不存在时返回现有 missing |
| 运行时来源已声明但值为空/缺失 | 返回 missing，不回退 |
| 匹配 auth 条目的环境变量为空/缺失 | 返回 missing，不回退 |
| auth 条目或文件 schema 非法 | 返回配置错误，不回退 |
| 内联 `credential: harness` 借用失败 | 保留现有错误，不回退到无凭据或其他身份 |
| 所有来源均不存在 | 不携带凭据；需要认证的端点在 sniff/请求阶段失败 |
| 已选凭据被上游拒绝 | 不因 401/403 自动换另一来源 |

凭据缺失沿用 `kind: "missing"`；文件读取、YAML 或 schema 错误必须显式抛出配置错误，不得伪装成 missing 触发 skip。诊断原因必须包含 provider 与非秘密来源，不得包含 `apiKey`、token、baseUrl 或实际环境变量值。

## 5. 加载时机与组件边界

- `loadLiveConfig()`、`resolveLiveTargets()` 和 `loadTargetTagCatalog()` 不读取认证文件。
- 新增独立的认证文件加载/校验模块，避免继续扩张已有配置解析文件；导出符号写中文 JSDoc。
- `resolveLiveCredential()` 或其明确的执行前包装层负责按第 4 节选择来源并解析实际 key。
- `LiveBackend.start()` 与 `sniffLiveChannel()` 必须走同一来源选择链，禁止一个支持认证文件、另一个绕过。
- 实际 secret 只在凭据解析阶段进入内存；日志、异常、报告和结构化诊断只保留非秘密来源标签。
- 字面量与环境变量解析出的实际值必须加入 `redactLiveSecrets` 的秘密集合，覆盖嵌套错误、响应载荷和跨行形式。
- 不自动读取 Pi 的 `auth.json`，不执行凭据命令，不自动刷新 OAuth，不默认借用真实宿主登录态。

## 6. 兼容与 TargetTags

- 不创建 `.env.auth.yaml` 时，现有配置结果和凭据来源不变。
- 现有内联 `apiKey/apiKeyEnv/credential: harness` 不废弃、不强制迁移。
- 用户新增匹配 auth 条目即显式选择新覆盖关系：auth 文件优先于内联凭据。
- `from:harness` 与代码显式 channel 的端点一致性、安全校验和 bypass 语义不变。
- 认证文件的 `type: api_key` 只描述凭据结构，不证明上游认证方式、账号权限或 live 策略。
- `provider.auth.*` / `provider-model.auth.*` 继续可选；消费者显式要求时仍按 TargetTags 缺失规则处理。

## 7. 配置文档维护范围

实现完成时必须同步，不得只改源码：

1. `docs/spec/llm-fixture.md`：完整 `.env.auth.yaml` schema、发现顺序、默认同名与 `auth.provider` 显式联动、来源优先级、失败矩阵和脱敏约束。
2. `docs/spec/suite-design.md`：环境变量表、私密配置区摘要和加载顺序。
3. `docs/spec/target-tags.md`：认证文件不进入 catalog、auth 标签保持可选且不得从凭据推断。
4. `README.md`：live 凭据阶梯与风险说明。
5. `docs/tutorial/modules.md`：新增公开加载/解析工具的用途（若导出）。
6. `docs/tutorial/recipes/live-guard.md` 与 `live-token-smoke.md`：零 token 配置示例及显式 token 车道使用方式。
7. `docs/spec/README.md`：登记本规格。
8. `CHANGELOG.md`：记录新增可选认证配置与优先级。

研究依据保留在 `docs/research/pi-models-auth-resolution.md`，不将 Pi 特定 provider 名、环境变量或协议写入 `packages/*/src/`。

## 8. 测试与验收

新行为先写失败测试，全部使用临时目录、合成 provider ID 和合成 secret，不读取真实 home 配置、不发起网络请求、零 token。

至少覆盖：

1. 无认证文件时模型加载与目标选择不变。
2. 完整 YAML 两种 API-key 形式解析及所有非法 schema。
3. 显式/repo/home 发现顺序、命中即停、显式路径缺失和损坏文件不回退。
4. provider 精确匹配、大小写差异、多 carrier 共享、无 provider ID，以及 `auth.provider` 复用、指定条目缺失和与内联凭据冲突。
5. runtime > auth-file > model-config 的优先级及代码显式 channel bypass。
6. 来源不存在时回退；已声明来源缺值、schema 错误、借用失败时不回退。
7. `LiveBackend.start()` 与 `sniffLiveChannel()` 使用一致来源。
8. auth 字面量和环境变量实际值在异常、嵌套 cause、响应载荷与跨行诊断中均脱敏。
9. TargetTagCatalog 不读取认证文件，auth 标签缺省行为不变。
10. 无 `.env.auth.yaml` 的既有测试全部保持通过。

验收命令：`pnpm boundary`、`pnpm typecheck`、`pnpm test`、`pnpm ittest`，最终运行 `pnpm check`。本变更不要求真实 token 测试；不得用 live 请求代替确定性单元/集成验证。

## 9. 非目标

- 通用 OAuth 存储、登录、刷新与写回。
- `!command` 或任意 secret manager 命令执行。
- 自动 provider 环境变量、云 ambient 或真实宿主认证发现。
- 多认证文件合并、账号轮换或 401 后自动切换身份。
- 移除或废弃现有 `.env.e2e.yaml` 内联凭据。
- 修改具体消费者配置或真实 `~/.env.e2e.yaml` / `~/.env.auth.yaml`。
